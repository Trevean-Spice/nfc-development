/**
 * The batch runner.
 *
 * Rules it keeps, in order of how expensive breaking them would be:
 *
 *   1. No unit is ever silently skipped. Every sequence number from 1 to the target
 *      appears in the summary with an outcome, and a run whose outcome list is not
 *      complete exits non zero and says which numbers are missing.
 *   2. Nothing is recorded as protected that was not verified first.
 *   3. Every unit is journalled and flushed to disk before the operator is asked for
 *      the next tag, so an interruption costs the tag in hand and nothing else.
 *   4. A resumed run continues the same journal, against the same code and the same
 *      redirect table. A mismatch is refused rather than merged.
 *   5. A resumed run reads a journal whose every line still matches its own digest.
 *      A forged or corrupted line is refused rather than counted as a unit done.
 */

import { hostname, userInfo } from 'node:os';
import { randomUUID } from 'node:crypto';
import { ChipError, asChipError } from '../chip/errors.js';
import type { TagPassword } from '../chip/password.js';
import type { CcPolicy } from '../chip/st25tv02kc.js';
import type { RedirectTable } from '../table/redirect-table.js';
import type { TagTransport } from '../transport/transport.js';
import {
  Journal,
  readJournal,
  resumeState,
  type EndRecord,
  type ParsedJournal,
  type RunHeaderRecord,
  type UnitRecord,
} from './journal.js';
import { JOURNAL_FORMAT } from './journal.js';
import { UnitSession, planEncoding } from './unit.js';

export type BatchEvent =
  | { readonly type: 'run-start'; readonly header: RunHeaderRecord; readonly resuming: boolean; readonly remaining: number }
  | { readonly type: 'unit-start'; readonly seq: number; readonly total: number; readonly attempt: number }
  | { readonly type: 'unit-done'; readonly record: UnitRecord }
  | { readonly type: 'unit-retry'; readonly seq: number; readonly attempt: number; readonly error: ChipError }
  | { readonly type: 'run-end'; readonly summary: BatchSummary };

export interface BatchOptions {
  readonly table: RedirectTable;
  readonly code: string;
  readonly count: number;
  readonly journalPath: string;
  readonly transport: TagTransport;
  readonly dryRun: boolean;
  readonly protect: boolean;
  readonly currentPassword?: TagPassword | undefined;
  readonly newPassword?: TagPassword | undefined;
  /** Presented before writing, so tags protected by an earlier run can be rewritten. */
  readonly unlockPassword?: TagPassword | undefined;
  readonly ccPolicy?: CcPolicy;
  readonly verifyAfterPowerCycle?: boolean;
  readonly attemptsPerUnit?: number;
  readonly maxFailures?: number;
  readonly tagTimeoutMs?: number;
  readonly operator?: string;
  readonly toolVersion: string;
  /** Called before each unit. The interactive CLI waits for the operator here. */
  readonly beforeUnit?: (seq: number, total: number) => Promise<void>;
  readonly onEvent?: (event: BatchEvent) => void;
  /** Polled between units. Set by the SIGINT handler. */
  readonly shouldStop?: () => boolean;
  readonly now?: () => Date;
}

export type SeqOutcome = 'verified' | 'protected' | 'failed' | 'planned' | 'not-attempted';

export interface BatchSummary {
  readonly runId: string;
  readonly code: string;
  readonly blendName: string;
  readonly uri: string;
  readonly targetCount: number;
  readonly journalPath: string;
  readonly outcomeBySeq: ReadonlyMap<number, SeqOutcome>;
  readonly succeeded: readonly number[];
  readonly failed: readonly number[];
  readonly planned: readonly number[];
  readonly notAttempted: readonly number[];
  readonly elapsedMs: number;
  readonly interrupted: boolean;
  readonly aborted: boolean;
  /**
   * The unit the run stopped at because its tag may be locked, or holds a password 1 nobody
   * knows (review finding N4), or null. The run never moves on to the next unit after one,
   * because with --no-prompt the next unit would start on that same tag.
   */
  readonly stoppedAtUnsafeUnit: number | null;
  /** True only when every sequence number reached a successful terminal outcome. */
  readonly complete: boolean;
  readonly dryRun: boolean;
  readonly transport: string;
  readonly transportIsHardware: boolean;
}

/**
 * A resume reads its own record of which physical tags were written. If that record cannot
 * be trusted line by line, neither can the answer to "which units are already done", and
 * getting that answer wrong on a protected run means presenting the factory password to a
 * tag this run already locked, or leaving a real tag unwritten and calling the batch
 * complete.
 *
 * So: hard fail, not downgrade. A record whose digest does not match its contents is not a
 * unit whose outcome is in doubt, it is a line this tool did not write, and there is no
 * safe way to guess which of the two it is from inside the file. The remedy is deliberately
 * not "repair the journal": the run has physical evidence on the bench and in the tray, and
 * a fresh journal against the tags that are actually left is the recoverable path.
 *
 * badLines are refused for the same reason. They were surfaced by `chip-cli status` and by
 * nothing else, so a resume against a partially corrupted journal used to proceed without a
 * word. truncatedTail is not refused: an incomplete final line is precisely what an
 * interrupted write leaves, it is the case this journal was designed to survive, and the
 * unit it belonged to is simply not counted as done.
 */
function refuseDamagedJournal(parsed: ParsedJournal, path: string): void {
  if (parsed.digestFailures.length > 0) {
    const first = parsed.digestFailures[0];
    const detail = parsed.digestFailures
      .map((failure) => `line ${failure.line} (${failure.kind}${failure.seq === null ? '' : ` seq ${failure.seq}`}): ${failure.reason}`)
      .join('; ');
    throw new ChipError(
      'JOURNAL_CORRUPT',
      `${parsed.digestFailures.length} record(s) in the journal at ${path} do not match their own digest: ${detail}.`,
      'Do not resume this file. Every record carries a digest of its own contents, so a mismatch means the line was edited or damaged after it was written, and the list of units already done cannot be trusted. Count the tags physically written, then start a new run into a new journal file for the units that are left.',
      { path, failures: parsed.digestFailures.length, firstLine: first?.line ?? 0 },
    );
  }
  if (parsed.badLines > 0) {
    throw new ChipError(
      'JOURNAL_CORRUPT',
      `The journal at ${path} has ${parsed.badLines} unreadable line(s).`,
      'Do not resume this file. Run "chip-cli status --journal <path>" to see what is readable, count the tags physically written, then start a new run into a new journal file for the units that are left.',
      { path, badLines: parsed.badLines },
    );
  }
}

function mismatch(field: string, wanted: string, found: string, path: string): ChipError {
  return new ChipError(
    'JOURNAL_MISMATCH',
    `The journal at ${path} was started with ${field} "${found}" and this run asks for "${wanted}".`,
    'Resume the run it belongs to, or start a new run into a new journal file. Do not mix two runs in one file.',
    { field, wanted, found, path },
  );
}

export async function runBatch(options: BatchOptions): Promise<BatchSummary> {
  const {
    table,
    code,
    count,
    journalPath,
    transport,
    dryRun,
    protect,
    toolVersion,
  } = options;

  const now = options.now ?? (() => new Date());
  const emit = options.onEvent ?? (() => undefined);
  const attemptsPerUnit = Math.max(1, options.attemptsPerUnit ?? 2);
  const maxFailures = options.maxFailures ?? 10;

  if (!Number.isInteger(count) || count < 1) {
    throw new ChipError('USAGE', `A batch count must be a whole number of at least 1. Got "${count}".`, 'Pass --count with a whole number.', {
      count,
    });
  }

  const { entry, uri } = table.uriFor(code);

  if (protect && (options.currentPassword === undefined || options.newPassword === undefined)) {
    throw new ChipError(
      'PASSWORD_MISSING',
      'Write protection was requested without both a current and a new password.',
      'Supply --password-env or --password-file. The current password defaults to the factory sixteen zeros unless --current-password-env is given.',
      {},
    );
  }

  // Fail before a single tag is touched if the URI will not fit. On this part it
  // always fits, and the check costs nothing.
  planEncoding(uri);

  const journal = new Journal(journalPath);
  const resuming = Journal.exists(journalPath);

  let header: RunHeaderRecord;
  let alreadyDone: readonly number[] = [];
  let remaining: number[] = [];
  let attemptsBySeq: ReadonlyMap<number, number> = new Map();

  if (resuming) {
    const parsed = readJournal(journalPath);
    refuseDamagedJournal(parsed, journalPath);
    const existing = parsed.header;
    if (existing.code !== entry.code) throw mismatch('code', entry.code, existing.code, journalPath);
    if (existing.targetCount !== count) throw mismatch('target count', String(count), String(existing.targetCount), journalPath);
    if (existing.tableDigest !== table.digest) throw mismatch('redirect table digest', table.digest, existing.tableDigest, journalPath);
    if (existing.uri !== uri) throw mismatch('URI', uri, existing.uri, journalPath);
    if (existing.dryRun !== dryRun) {
      throw mismatch('dry run', String(dryRun), String(existing.dryRun), journalPath);
    }
    if (existing.protectRequested !== protect) {
      throw mismatch('write protection', String(protect), String(existing.protectRequested), journalPath);
    }
    // A run begun on real silicon must not be finished on the simulator, or the
    // other way round. Without this check the default transport, which is the
    // simulator, silently completes the remaining units of a hardware batch: the
    // journal then says 500 tags were written and encoded, and the tags on the
    // bench after unit 312 were never touched. Compared on isHardware rather than
    // on the transport name, so swapping one reader for another mid run is still
    // allowed, which is a real thing to have to do and is not a safety problem.
    if (existing.transportIsHardware !== transport.isHardware) {
      throw mismatch(
        'transport kind',
        transport.isHardware ? 'a physical reader' : 'the simulator',
        existing.transportIsHardware ? 'a physical reader' : 'the simulator',
        journalPath,
      );
    }
    const state = resumeState(parsed, count);
    header = existing;
    alreadyDone = state.done;
    remaining = [...state.remaining];
    attemptsBySeq = state.attemptsBySeq;
  } else {
    header = journal.append<RunHeaderRecord>({
      kind: 'run',
      format: JOURNAL_FORMAT,
      runId: randomUUID(),
      startedAt: now().toISOString(),
      toolVersion,
      code: entry.code,
      blendName: entry.blendName,
      uri,
      targetCount: count,
      tablePath: table.path,
      tableDigest: table.digest,
      tableVersion: table.version,
      transport: transport.name,
      transportIsHardware: transport.isHardware,
      protectRequested: protect,
      passwordFingerprint: options.newPassword?.fingerprint() ?? null,
      operator: options.operator ?? safeUser(),
      host: safeHost(),
      dryRun,
    });
    remaining = Array.from({ length: count }, (_, i) => i + 1);
  }

  emit({ type: 'run-start', header, resuming, remaining: remaining.length });

  const outcomeBySeq = new Map<number, SeqOutcome>();
  for (const seq of alreadyDone) outcomeBySeq.set(seq, 'verified');

  const startedAtMs = Date.now();
  let failures = 0;
  let interrupted = false;
  let aborted = false;
  let stoppedAtUnsafeUnit: number | null = null;

  if (!dryRun) await transport.open();

  try {
    for (const seq of remaining) {
      if (options.shouldStop?.() === true) {
        interrupted = true;
        break;
      }
      if (failures >= maxFailures) {
        aborted = true;
        break;
      }

      await options.beforeUnit?.(seq, count);

      const baseAttempt = attemptsBySeq.get(seq) ?? 0;
      let record: UnitRecord | null = null;
      let stopRun = false;

      for (let tryIndex = 0; tryIndex < attemptsPerUnit; tryIndex += 1) {
        const attempt = baseAttempt + tryIndex + 1;
        emit({ type: 'unit-start', seq, total: count, attempt });
        const { record: result, retryForbidden, stopRun: unsafe } = await runOneUnit({ ...options, uri, entryCode: entry.code, seq, attempt, now });
        stopRun = unsafe;
        // A unit that failed after its opcode probe passed, or after an irreversible
        // protection command started, is never retried automatically: the tag may already
        // be locked, its remedy says not to retry, and the retry would start on whatever
        // is on the reader without asking (review finding F7).
        if (result.outcome !== 'failed' || tryIndex === attemptsPerUnit - 1 || retryForbidden) {
          record = journal.append<UnitRecord>(result);
          break;
        }
        // Not the last attempt: record the failure and try the same tag once more.
        journal.append<UnitRecord>(result);
        emit({
          type: 'unit-retry',
          seq,
          attempt,
          error: new ChipError(
            (result.error?.code ?? 'WRITE_FAILED') as ChipError['code'],
            result.error?.message ?? 'unknown failure',
            result.error?.remedy ?? '',
            {},
          ),
        });
        if (!dryRun) await transport.releaseTag();
      }

      if (record === null) {
        throw new ChipError('BATCH_INCOMPLETE', `Unit ${seq} produced no record.`, 'This is a bug in the tool. Report it.', { seq });
      }

      outcomeBySeq.set(seq, record.outcome);
      if (record.outcome === 'failed') failures += 1;
      emit({ type: 'unit-done', record });

      if (!dryRun) await transport.completeUnit();
      if (stopRun) {
        stoppedAtUnsafeUnit = seq;
        aborted = true;
        break;
      }
    }
  } finally {
    if (!dryRun) {
      try {
        await transport.close();
      } catch {
        // Closing a transport that never opened is not a batch failure.
      }
    }
  }

  for (let seq = 1; seq <= count; seq += 1) {
    if (!outcomeBySeq.has(seq)) outcomeBySeq.set(seq, 'not-attempted');
  }

  const succeeded: number[] = [];
  const failed: number[] = [];
  const planned: number[] = [];
  const notAttempted: number[] = [];
  for (let seq = 1; seq <= count; seq += 1) {
    switch (outcomeBySeq.get(seq)) {
      case 'verified':
      case 'protected':
        succeeded.push(seq);
        break;
      case 'planned':
        planned.push(seq);
        break;
      case 'failed':
        failed.push(seq);
        break;
      default:
        notAttempted.push(seq);
    }
  }

  const complete = dryRun ? planned.length === count : succeeded.length === count;

  const reason: EndRecord['reason'] = interrupted ? 'interrupted' : aborted ? 'aborted' : 'completed';
  journal.append<EndRecord>({
    kind: 'end',
    at: now().toISOString(),
    reason,
    note: stoppedAtUnsafeUnit !== null
      ? `stopped at unit ${stoppedAtUnsafeUnit}: its tag may be locked or holds an unknown password 1, so the run did not go on to the next unit`
      : aborted
      ? `stopped after ${failures} failures, the limit is ${maxFailures}`
      : interrupted
        ? 'stopped on operator interrupt'
        : `${succeeded.length + planned.length} of ${count} units reached a successful outcome`,
  });
  journal.close();

  const summary: BatchSummary = {
    runId: header.runId,
    code: entry.code,
    blendName: entry.blendName,
    uri,
    targetCount: count,
    journalPath,
    outcomeBySeq,
    succeeded,
    failed,
    planned,
    notAttempted,
    elapsedMs: Date.now() - startedAtMs,
    interrupted,
    aborted,
    stoppedAtUnsafeUnit,
    complete,
    dryRun,
    transport: transport.name,
    transportIsHardware: transport.isHardware,
  };

  emit({ type: 'run-end', summary });
  return summary;
}

interface RunOneUnitOptions extends BatchOptions {
  readonly uri: string;
  readonly entryCode: string;
  readonly seq: number;
  readonly attempt: number;
  readonly now: () => Date;
}

async function runOneUnit(options: RunOneUnitOptions): Promise<{ record: Omit<UnitRecord, 'digest'>; retryForbidden: boolean; stopRun: boolean }> {
  const started = Date.now();
  const at = options.now().toISOString();

  if (options.dryRun) {
    // Zero transport calls. Nothing is selected, nothing is written, nothing is
    // read and nothing is protected. A test asserts exactly that.
    const plan = planEncoding(options.uri);
    const record: Omit<UnitRecord, 'digest'> = {
      kind: 'unit',
      seq: options.seq,
      attempt: options.attempt,
      at,
      code: options.entryCode,
      uri: options.uri,
      outcome: 'planned',
      uid: null,
      phaseReached: 'planned',
      blocksWritten: plan.summary.blocksToWrite,
      areaBytesUsed: plan.summary.tlvBytes,
      areaBytesFree: plan.summary.areaBytesFree,
      ccAction: 'none',
      identifierCode: plan.summary.identifierCode,
      readBackHex: null,
      verifiedAt: null,
      powerCycled: false,
      protection: null,
      error: null,
      durationMs: Date.now() - started,
    };
    return { record, retryForbidden: false, stopRun: false };
  }

  const session = new UnitSession({
    transport: options.transport,
    uri: options.uri,
    code: options.entryCode,
    ccPolicy: options.ccPolicy ?? 'preserve',
    tagTimeoutMs: options.tagTimeoutMs ?? 10_000,
    verifyAfterPowerCycle: options.verifyAfterPowerCycle ?? false,
    unlockPassword: options.unlockPassword ?? (options.protect ? options.currentPassword : undefined),
    now: options.now,
  });

  const base = {
    kind: 'unit' as const,
    seq: options.seq,
    attempt: options.attempt,
    at,
    code: options.entryCode,
    uri: options.uri,
  };

  try {
    const identity = await session.selectTag();
    const plan = await session.write();
    const receipt = await session.verify();

    let protection: UnitRecord['protection'] = null;
    if (options.protect) {
      const current = options.currentPassword;
      const next = options.newPassword;
      if (current === undefined || next === undefined) {
        throw new ChipError('PASSWORD_MISSING', 'No password was available at the protect step.', 'This is a bug in the tool. Report it.', {});
      }
      const outcome = await session.protect(receipt, { currentPassword: current, newPassword: next });
      protection = {
        applied: outcome.applied,
        area: outcome.area,
        passwordNumber: outcome.passwordNumber,
        passwordFingerprint: outcome.passwordFingerprint,
        passwordChanged: outcome.passwordChanged,
        refusalProven: outcome.refusalProven,
        unlockProven: outcome.unlockProven,
      };
    }

    const record: Omit<UnitRecord, 'digest'> = {
      ...base,
      outcome: protection === null ? 'verified' : 'protected',
      uid: identity.uid,
      phaseReached: session.phase,
      blocksWritten: plan.blocksWritten,
      areaBytesUsed: plan.areaBytesUsed,
      areaBytesFree: plan.areaBytesFree,
      ccAction: plan.ccAction,
      identifierCode: planEncoding(options.uri).summary.identifierCode,
      readBackHex: receipt.readBackHex,
      verifiedAt: receipt.verifiedAt,
      powerCycled: receipt.powerCycled,
      protection,
      error: null,
      durationMs: Date.now() - started,
    };
    return { record, retryForbidden: false, stopRun: false };
  } catch (cause) {
    const error = asChipError(cause, 'WRITE_FAILED', 'Set this tag aside, label it, and continue with the next one.');
    const record: Omit<UnitRecord, 'digest'> = {
      ...base,
      outcome: 'failed',
      uid: session.identity?.uid ?? null,
      phaseReached: session.phase,
      blocksWritten: session.plan?.blocksWritten ?? 0,
      areaBytesUsed: session.plan?.areaBytesUsed ?? 0,
      areaBytesFree: session.plan?.areaBytesFree ?? 0,
      ccAction: session.plan?.ccAction ?? 'none',
      identifierCode: -1,
      readBackHex: null,
      verifiedAt: null,
      powerCycled: false,
      protection: null,
      error: { code: error.code, message: error.message, remedy: error.remedy },
      durationMs: Date.now() - started,
    };
    // Review finding N4: a tag that may be locked, or whose password 1 is unknown, stops the
    // run. Either can only come from an irreversible frame that reached the tag.
    const stopRun = error.detail['mayBeLocked'] === true || error.detail['passwordUnknown'] === true;
    return { record, retryForbidden: session.retryForbidden || stopRun, stopRun };
  }
}

function safeUser(): string {
  try {
    return userInfo().username;
  } catch {
    return 'unknown';
  }
}

function safeHost(): string {
  try {
    return hostname();
  } catch {
    return 'unknown';
  }
}
