/**
 * The batch journal: one line of JSON per event, appended and flushed to disk
 * before the next tag is touched.
 *
 * This is the artifact that turns "which tags carry which code" from a memory into
 * a file. It is also what makes a batch resumable, so an interruption at unit 312
 * of 500 costs the current tag and nothing else.
 *
 * Three properties it has to have, and how each is obtained:
 *
 *   Durable      Every record is written and fsync'd before the operator is told to
 *                present the next tag. A power cut cannot lose a record for a tag
 *                that has already been written.
 *   Append only  Nothing is ever rewritten. A resumed run appends, and the history
 *                of a retried unit stays visible.
 *   Self checked Each record carries a digest of its own contents, and the run
 *                header carries the redirect table digest. Resuming a journal
 *                against a different table, or a different code, is refused rather
 *                than merged.
 *
 * On the third of those: the digest is now RECOMPUTED AND COMPARED on every line
 * readJournal parses, and runBatch refuses to resume a journal with any failure in
 * it. It used to be computed on the way in and never read back, which meant two
 * lines copied from unit 1 with the seq changed and the digest left alone were
 * accepted as done, and a three unit run resumed to "complete" with zero tags
 * touched. That does not need malice: any corruption leaving a line parseable as
 * JSON with a plausible seq and outcome does it, and a journal is a plain text file
 * an operator can open.
 *
 * A truncated final line, which is what a crash mid write looks like, is reported
 * and ignored rather than treated as corruption of the whole file. That is the one
 * damaged line the journal is designed to expect, and it is excluded from the
 * digest check because it was never finished being written.
 */

import { createHash } from 'node:crypto';
import { closeSync, existsSync, fstatSync, fsyncSync, openSync, readFileSync, writeSync } from 'node:fs';
import { ChipError } from '../chip/errors.js';

export const JOURNAL_FORMAT = 'trevean.chip-cli.journal/1';

export interface RunHeaderRecord {
  readonly kind: 'run';
  readonly format: typeof JOURNAL_FORMAT;
  readonly runId: string;
  readonly startedAt: string;
  readonly toolVersion: string;
  readonly code: string;
  readonly blendName: string;
  readonly uri: string;
  readonly targetCount: number;
  readonly tablePath: string;
  readonly tableDigest: string;
  readonly tableVersion: number;
  readonly transport: string;
  readonly transportIsHardware: boolean;
  readonly protectRequested: boolean;
  /** Fingerprint only. The password itself never reaches this file. */
  readonly passwordFingerprint: string | null;
  readonly operator: string;
  readonly host: string;
  readonly dryRun: boolean;
  readonly digest?: string;
}

export interface UnitRecord {
  readonly kind: 'unit';
  readonly seq: number;
  readonly attempt: number;
  readonly at: string;
  readonly code: string;
  readonly uri: string;
  readonly outcome: 'planned' | 'verified' | 'protected' | 'failed';
  readonly uid: string | null;
  readonly phaseReached: string;
  readonly blocksWritten: number;
  readonly areaBytesUsed: number;
  readonly areaBytesFree: number;
  readonly ccAction: string;
  readonly identifierCode: number;
  readonly readBackHex: string | null;
  readonly verifiedAt: string | null;
  readonly powerCycled: boolean;
  readonly protection: {
    readonly applied: boolean;
    readonly area: number;
    readonly passwordNumber: number;
    readonly passwordFingerprint: string;
    readonly passwordChanged: boolean;
    readonly refusalProven: boolean;
    /** Since Monday 26 October 2026: the recorded password opened the tag after protection. Absent in older journals. */
    readonly unlockProven?: boolean;
  } | null;
  readonly error: { readonly code: string; readonly message: string; readonly remedy: string } | null;
  readonly durationMs: number;
  readonly digest?: string;
}

export interface EndRecord {
  readonly kind: 'end';
  readonly at: string;
  readonly reason: 'completed' | 'interrupted' | 'aborted';
  readonly note: string;
  readonly digest?: string;
}

export type JournalRecord = RunHeaderRecord | UnitRecord | EndRecord;

/**
 * Canonical JSON: object keys sorted at every level, so the digest of a record does
 * not depend on the order the fields happened to be written in. A plain
 * JSON.stringify with a replacer array would only sort the top level and would
 * silently drop nested fields from the digest, which is worse than no digest.
 */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

function digestOf(record: unknown): string {
  return createHash('sha256').update(canonicalJson(record)).digest('hex').slice(0, 12);
}

/**
 * Recomputes a record's digest and compares it with the one stored on the line.
 *
 * A record with no digest at all returns false rather than true. Every line this tool has
 * ever written carries one, because Journal.append computes it on the way to disk and the
 * format string has not changed, so a line without a digest is a line this tool did not
 * write. There is no pre check era of journals to be lenient towards, which is what made
 * "hard fail" the answer rather than "downgrade the unit to not done".
 */
export function verifyRecordDigest(record: JournalRecord): boolean {
  const { digest, ...rest } = record as JournalRecord & { digest?: string };
  if (digest === undefined) return false;
  return digestOf(rest) === digest;
}

export class Journal {
  readonly path: string;
  #fd: number | null = null;

  constructor(path: string) {
    this.path = path;
  }

  static exists(path: string): boolean {
    return existsSync(path);
  }

  open(): void {
    if (this.#fd !== null) return;
    try {
      this.#fd = openSync(this.path, 'a');
    } catch (cause) {
      throw new ChipError(
        'JOURNAL_CORRUPT',
        `The batch journal at ${this.path} could not be opened for appending.`,
        'Check the folder exists and that the operator account can write to it.',
        { path: this.path, cause: cause instanceof Error ? cause.message : String(cause) },
      );
    }
  }

  close(): void {
    if (this.#fd === null) return;
    closeSync(this.#fd);
    this.#fd = null;
  }

  /** Appends a record and flushes it to disk before returning. */
  append<T extends JournalRecord>(record: Omit<T, 'digest'>): T {
    this.open();
    const fd = this.#fd;
    if (fd === null) throw new ChipError('JOURNAL_CORRUPT', 'The journal is not open.', 'This is a bug in the tool.', {});

    const withDigest = { ...record, digest: digestOf(record) } as T;
    const line = `${JSON.stringify(withDigest)}\n`;
    writeSync(fd, line);
    // The whole point of the journal is that it survives the thing that stopped the
    // run. Buffered is not good enough.
    fsyncSync(fd);
    return withDigest;
  }

  sizeBytes(): number {
    if (this.#fd === null) return existsSync(this.path) ? readFileSync(this.path).length : 0;
    return fstatSync(this.#fd).size;
  }
}

/**
 * A line whose stored digest does not match its own contents.
 *
 * Reported rather than thrown from readJournal, so `chip-cli status` can still tell an
 * operator what is in a damaged file. runBatch refuses to resume on any of these.
 */
export interface DigestFailure {
  /** One based line number in the file, so it can be pointed at directly. */
  readonly line: number;
  readonly kind: string;
  /** The sequence number the line claims, for a unit record. Null on a header or an end. */
  readonly seq: number | null;
  readonly reason: 'no digest' | 'digest does not match contents';
}

export interface ParsedJournal {
  readonly header: RunHeaderRecord;
  readonly units: readonly UnitRecord[];
  readonly ends: readonly EndRecord[];
  /** True when the last line was incomplete, which is what a crash mid write leaves. */
  readonly truncatedTail: boolean;
  readonly badLines: number;
  /**
   * Lines that parsed as JSON and failed their own digest. Distinct from badLines, which
   * are lines that did not parse at all: a forged or corrupted record is well formed JSON
   * with a plausible seq and outcome, which is exactly why it needs its own check.
   */
  readonly digestFailures: readonly DigestFailure[];
}

export function readJournal(path: string): ParsedJournal {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (cause) {
    throw new ChipError(
      'JOURNAL_CORRUPT',
      `The batch journal at ${path} could not be read.`,
      'Check the path.',
      { path, cause: cause instanceof Error ? cause.message : String(cause) },
    );
  }

  const lines = raw.split('\n');
  const truncatedTail = raw.length > 0 && !raw.endsWith('\n');
  const usable = truncatedTail ? lines.slice(0, -1) : lines;

  let header: RunHeaderRecord | null = null;
  const units: UnitRecord[] = [];
  const ends: EndRecord[] = [];
  const digestFailures: DigestFailure[] = [];
  let badLines = 0;

  for (let index = 0; index < usable.length; index += 1) {
    const line = usable[index] as string;
    if (line.trim().length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      badLines += 1;
      continue;
    }
    if (typeof parsed !== 'object' || parsed === null) {
      badLines += 1;
      continue;
    }
    const record = parsed as JournalRecord;
    // The digest is checked on every parseable record, here, once, so that everything
    // downstream is looking at lines this tool wrote rather than at lines that merely
    // parse. It was computed on the way in and stored on the line from the first version
    // of this file; it was simply never read back, which made the "self checked" property
    // in the header above a description of a field rather than of a check.
    if (!verifyRecordDigest(record)) {
      digestFailures.push({
        line: index + 1,
        kind: typeof record.kind === 'string' ? record.kind : 'unknown',
        seq: record.kind === 'unit' && typeof record.seq === 'number' ? record.seq : null,
        reason: (record as { digest?: string }).digest === undefined ? 'no digest' : 'digest does not match contents',
      });
    }
    if (record.kind === 'run') header ??= record;
    else if (record.kind === 'unit') units.push(record);
    else if (record.kind === 'end') ends.push(record);
    else badLines += 1;
  }

  if (header === null) {
    throw new ChipError(
      'JOURNAL_CORRUPT',
      `The batch journal at ${path} has no run header.`,
      'This file is not a chip-cli batch journal, or its first line was lost. Start a new run into a new file rather than repairing this one.',
      { path, badLines },
    );
  }
  if (header.format !== JOURNAL_FORMAT) {
    throw new ChipError(
      'JOURNAL_CORRUPT',
      `The batch journal at ${path} is format "${String(header.format)}", and this tool writes "${JOURNAL_FORMAT}".`,
      'Start a new run into a new file.',
      { path },
    );
  }

  return { header, units, ends, truncatedTail, badLines, digestFailures };
}

/**
 * What still has to be done in a resumed run.
 *
 * A unit counts as done only when its most recent attempt succeeded. A unit that
 * failed is put back in the queue, because a failed unit means a tag that was set
 * aside and has to be replaced. Nothing is ever dropped silently: every sequence
 * number from 1 to the target appears in exactly one of the two lists.
 */
export interface ResumeState {
  readonly done: readonly number[];
  readonly remaining: readonly number[];
  readonly attemptsBySeq: ReadonlyMap<number, number>;
  readonly previouslyFailed: readonly number[];
}

export function resumeState(journal: ParsedJournal, targetCount: number): ResumeState {
  const latest = new Map<number, UnitRecord>();
  const attempts = new Map<number, number>();
  for (const unit of journal.units) {
    latest.set(unit.seq, unit);
    attempts.set(unit.seq, Math.max(attempts.get(unit.seq) ?? 0, unit.attempt));
  }

  const done: number[] = [];
  const remaining: number[] = [];
  const previouslyFailed: number[] = [];

  for (let seq = 1; seq <= targetCount; seq += 1) {
    const record = latest.get(seq);
    if (record !== undefined && (record.outcome === 'verified' || record.outcome === 'protected')) {
      done.push(seq);
    } else {
      remaining.push(seq);
      if (record !== undefined && record.outcome === 'failed') previouslyFailed.push(seq);
    }
  }

  return { done, remaining, attemptsBySeq: attempts, previouslyFailed };
}
