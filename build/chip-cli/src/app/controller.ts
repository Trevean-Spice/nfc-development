/**
 * The Tag Tool's state machine: one reader, one tag at a time, many tags in a row.
 *
 *   starting  ->  reader not found  <->  waiting for a tag  ->  tag seen  ->  writing
 *                                              ^       |                         |
 *                                              |  tag not ready,      written, or error
 *                                              |  retrying                       |
 *                                              +------- tag taken off -----------+
 *
 * One loop owns the transport. It opens the reader (retrying until one appears),
 * polls for a tag, notices it leave, and runs a write when asked. Nothing else
 * touches the transport, so a write can never overlap a poll.
 *
 * Rules it keeps, all of them borrowed from the batch runner rather than invented:
 *
 *   1. Every unit goes through UnitSession select, write and verify, unchanged.
 *      "Written" on the page means the tag was read back and decoded to the URL.
 *   2. Every attempt is journalled and flushed to disk before the next tag is
 *      looked at, in the batch journal format, one file per product code per
 *      session. Two attempts per tag, as the batch does by default.
 *   3. Nothing here protects a tag. There is no password anywhere in this file,
 *      UnitSession.protect is never called, and the transport is wrapped in
 *      WriteOnlyTransport, which refuses the password and protection commands.
 *
 * And two of its own, both about not writing a tag nobody asked for:
 *
 *   4. A tag is taken off only after it has been missing for `removalPolls` polls
 *      in a row, so a reader that blinks does not make one tag look like two.
 *   5. Automatic mode never writes the same UID twice in a row. A written tag left
 *      on the reader, or put back on it, waits for the Write button.
 */

import { mkdirSync, existsSync } from 'node:fs';
import { hostname, userInfo } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ChipError, asChipError } from '../chip/errors.js';
import { CC_BYTES, PART } from '../chip/st25tv02kc.js';
import { decodeUriMessage } from '../ndef/decode.js';
import { unwrapNdefTlv } from '../ndef/tlv.js';
import { fromHex } from '../util/hex.js';
import type { RedirectTable, TagCodeEntry } from '../table/redirect-table.js';
import type { TagIdentity, TagTransport } from '../transport/transport.js';
import { Journal, JOURNAL_FORMAT, type EndRecord, type RunHeaderRecord, type UnitRecord } from '../workflow/journal.js';
import { UnitSession, planEncoding } from '../workflow/unit.js';
import { WriteOnlyTransport } from './write-only.js';

export type Phase = 'starting' | 'reader-not-found' | 'waiting-for-tag' | 'tag-not-ready' | 'tag-seen' | 'writing' | 'written' | 'error';

export type NoticeKind = 'reader-ready' | 'tag-seen' | 'written' | 'error';

export interface Notice {
  readonly id: number;
  readonly kind: NoticeKind;
  readonly title: string;
  readonly body: string;
  readonly at: string;
}

export interface PlainError {
  readonly code: string;
  readonly message: string;
  readonly remedy: string;
}

export interface RecentUnit {
  readonly at: string;
  readonly seq: number;
  readonly attempt: number;
  readonly code: string;
  readonly blendName: string;
  readonly uid: string | null;
  readonly outcome: 'verified' | 'failed';
  readonly url: string | null;
  readonly error: PlainError | null;
}

export interface Snapshot {
  readonly app: 'trevean-tag-tool';
  readonly version: string;
  readonly phase: Phase;
  readonly transport: string;
  readonly isHardware: boolean;
  readonly simulator: { readonly readerConnected: boolean; readonly tagPresent: boolean } | null;
  readonly readerName: string | null;
  readonly uid: string | null;
  /** The code being written, or just written. */
  readonly code: string | null;
  readonly blendName: string | null;
  /** The URL read back off the tag and decoded. Only set once verified. */
  readonly url: string | null;
  readonly error: PlainError | null;
  /**
   * Why the Tag Tool believes another program is reading the tags (GoToTags, usually), or
   * null. The page then shows ANOTHER_PROGRAM_ADVICE instead of a generic error. Cleared
   * by the next tag that reads properly.
   */
  readonly anotherProgram: string | null;
  /** True when the tag on the reader is the one most recently attempted. */
  readonly tagAlreadyAttempted: boolean;
  readonly auto: { readonly enabled: boolean; readonly code: string | null; readonly blendName: string | null };
  /**
   * Tags written and verified this session: distinct UIDs, so a tag written twice
   * counts once. A tag whose latest write failed is not counted until it is written
   * and verified again. `recent` has a row for every write.
   */
  readonly writtenCount: number;
  readonly failedAttempts: number;
  readonly recent: readonly RecentUnit[];
  readonly journals: readonly string[];
  readonly notices: readonly Notice[];
}

export interface ControllerOptions {
  readonly transport: TagTransport;
  readonly table: RedirectTable;
  /** Folder the journals go in. Created if missing. */
  readonly journalDir: string;
  readonly toolVersion: string;
  /** The reader's own name, once open. The PC/SC transport knows it; the interface does not. */
  readonly readerName?: () => string | null;
  /** Simulator state for the page, when the transport is the bench simulator. */
  readonly simulatorState?: () => { readerConnected: boolean; tagPresent: boolean };
  /** How long one poll waits for a tag. */
  readonly pollMs?: number;
  /** Pause between polls while a tag sits on the reader. */
  readonly idleMs?: number;
  /** Pause between attempts to open a reader that is not there. */
  readonly reopenMs?: number;
  /**
   * First pause after a tag that is on the reader but not ready to be read. It doubles each
   * time in a row, up to eight times this, and the reader stays open throughout.
   */
  readonly notReadyMs?: number;
  /** Polls in a row a tag has to be missing for before it counts as taken off. */
  readonly removalPolls?: number;
  /** Attempts per Write press before the unit is recorded failed. The batch default is 2. */
  readonly attemptsPerWrite?: number;
  readonly tagTimeoutMs?: number;
  readonly operator?: string;
  readonly now?: () => Date;
  readonly log?: (line: string) => void;
}

interface CodeJournal {
  readonly journal: Journal;
  readonly path: string;
  nextSeq: number;
  attempt: number;
  verified: number;
  failed: number;
}

interface PendingWrite {
  readonly code: string;
  readonly automatic: boolean;
}

const MAX_NOTICES = 12;

/**
 * What the page says when another program is reading the tags. The page has the same
 * sentence (page.js), because it also says it on its own when it sees a tag's ID typed in.
 */
export const ANOTHER_PROGRAM_ADVICE =
  'Another program is reading the tags and typing their ID (usually GoToTags). Exit it from the icon near the clock (right click, Exit), or end it in Task Manager, then try again.';

/** A refusal the page should show as it is, with the HTTP status that fits it. */
export class AppRefusal extends Error {
  constructor(
    readonly status: number,
    readonly error: PlainError,
  ) {
    super(error.message);
  }
}

function plain(error: ChipError): PlainError {
  return { code: error.code, message: error.message, remedy: error.remedy };
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

export class TagToolController {
  readonly #transport: WriteOnlyTransport;
  readonly #table: RedirectTable;
  readonly #options: ControllerOptions;
  readonly #now: () => Date;
  readonly #log: (line: string) => void;
  readonly #listeners = new Set<(snapshot: Snapshot) => void>();
  readonly #journals = new Map<string, CodeJournal>();

  #phase: Phase = 'starting';
  #readerName: string | null = null;
  #uid: string | null = null;
  #code: string | null = null;
  #blendName: string | null = null;
  #url: string | null = null;
  #error: PlainError | null = null;
  #anotherProgram: string | null = null;
  #auto: { enabled: boolean; code: string | null; blendName: string | null } = { enabled: false, code: null, blendName: null };
  /** UIDs whose latest write this session was verified. */
  readonly #verifiedUids = new Set<string>();
  /** Verified writes to tags that reported no UID. They cannot be told apart, so each counts. */
  #verifiedWithoutUid = 0;
  #failedAttempts = 0;
  #recent: RecentUnit[] = [];
  #notices: Notice[] = [];
  #noticeId = 0;

  #open = false;
  /** The tag the loop believes is on the reader. `bad` when it could not be identified as writable. */
  #present: { uid: string | null; bad: boolean } | null = null;
  #absentStreak = 0;
  /** Polls in a row where a tag was there but could not be read. */
  #unreadableStreak = 0;
  /** Polls in a row where a tag was there but not ready (TAG_ABSENT, case TAG_NOT_READY). */
  #notReadyStreak = 0;
  /** Reader trouble in a row, each one reopened. The second and later wait before polling again. */
  #troubleStreak = 0;
  #lastAttemptUid: string | null = null;
  #pending: PendingWrite | null = null;
  #stopping = false;
  #loop: Promise<void> | null = null;
  #wake: (() => void) | null = null;

  constructor(options: ControllerOptions) {
    this.#options = options;
    this.#transport = new WriteOnlyTransport(options.transport);
    this.#table = options.table;
    this.#now = options.now ?? (() => new Date());
    this.#log = options.log ?? (() => undefined);
  }

  /* ------------------------------------------------------------------------ */
  /* Public surface, used by the HTTP server and the tests                      */
  /* ------------------------------------------------------------------------ */

  start(): void {
    if (this.#loop !== null) return;
    this.#loop = this.run().catch((cause) => {
      // The loop catches everything it expects. Reaching here is a bug, and it is
      // shown rather than leaving the page frozen on its last state.
      const error = asChipError(cause, 'TRANSPORT_UNAVAILABLE', 'This is a bug in the Tag Tool. Close it and start it again, then report it.');
      this.#log(`The Tag Tool stopped unexpectedly: ${error.message}`);
      this.update({ phase: 'error', error: plain(error) });
      this.notice('error', 'The Tag Tool stopped', error.message);
    });
  }

  async stop(): Promise<void> {
    this.#stopping = true;
    this.#wake?.();
    await this.#loop;
    for (const entry of this.#journals.values()) {
      try {
        entry.journal.append<EndRecord>({
          kind: 'end',
          at: this.#now().toISOString(),
          reason: 'completed',
          note: `Tag Tool closed: ${entry.verified} unit(s) verified, ${entry.failed} failed attempt(s)`,
        });
        entry.journal.close();
      } catch {
        // A journal that cannot take its closing line still holds every unit record.
      }
    }
    if (this.#open) {
      await this.#transport.close().catch(() => undefined);
      this.#open = false;
    }
  }

  subscribe(listener: (snapshot: Snapshot) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** The codes the page offers, straight from the redirect table. */
  codes(): { code: string; blendName: string; url: string | null; encodable: boolean; status: string }[] {
    return this.#table.entries().map((entry) => ({
      code: entry.code,
      blendName: entry.blendName,
      url: entry.ndefUri,
      encodable: entry.ndefUri !== null,
      status: entry.status,
    }));
  }

  snapshot(): Snapshot {
    return {
      app: 'trevean-tag-tool',
      version: this.#options.toolVersion,
      phase: this.#phase,
      transport: this.#transport.name,
      isHardware: this.#transport.isHardware,
      simulator: this.#options.simulatorState?.() ?? null,
      readerName: this.#readerName,
      uid: this.#uid,
      code: this.#code,
      blendName: this.#blendName,
      url: this.#url,
      error: this.#error,
      anotherProgram: this.#anotherProgram,
      tagAlreadyAttempted: this.#present !== null && this.#present.uid !== null && this.#present.uid === this.#lastAttemptUid,
      auto: { ...this.#auto },
      writtenCount: this.writtenCount(),
      failedAttempts: this.#failedAttempts,
      recent: [...this.#recent],
      journals: [...this.#journals.values()].map((j) => j.path),
      notices: [...this.#notices],
    };
  }

  /**
   * The transport every unit goes through, as the loop holds it: wrapped, so the
   * password and protection commands are refused. Read by a test, so dropping the
   * wrapper fails a test rather than going unnoticed.
   */
  get transport(): WriteOnlyTransport {
    return this.#transport;
  }

  /**
   * Asks for the tag on the reader to be written with `code`.
   * Refuses, with something to show the operator, when that cannot happen now.
   */
  requestWrite(code: string): void {
    const entry = this.resolve(code);
    if (this.#pending !== null || this.#phase === 'writing') {
      throw new AppRefusal(409, {
        code: 'BUSY',
        message: 'A tag is being written already.',
        remedy: 'Wait for it to finish, then try again.',
      });
    }
    if (!this.#open) {
      throw new AppRefusal(409, {
        code: 'TRANSPORT_UNAVAILABLE',
        message: 'There is no reader to write with.',
        remedy: 'Plug the reader in. The page changes to "Reader ready" when it is found.',
      });
    }
    if (this.#phase === 'tag-not-ready') {
      throw new AppRefusal(409, {
        code: 'TAG_ABSENT',
        message: 'The tag on the reader is not ready yet.',
        remedy: 'Wait for "Tag seen", then press Write. If it does not come, lift the tag and lay it flat and still in the centre of the reader.',
      });
    }
    if (this.#present === null || this.#present.bad) {
      throw new AppRefusal(409, {
        code: 'TAG_ABSENT',
        message: this.#present === null ? 'There is no tag on the reader.' : 'The tag on the reader is not one this tool can write.',
        remedy: 'Put one blank tag flat on the reader, then press Write.',
      });
    }
    this.#pending = { code: entry.code, automatic: false };
    this.#wake?.();
  }

  /** Turns "write this code to every new tag" on or off. */
  setAuto(enabled: boolean, code: string | null): void {
    if (!enabled) {
      this.#auto = { enabled: false, code: null, blendName: null };
      this.#log('Automatic writing off.');
      this.emit();
      return;
    }
    if (code === null) {
      throw new AppRefusal(400, {
        code: 'CODE_UNKNOWN',
        message: 'Automatic writing needs a product code.',
        remedy: 'Choose the product code first, then tick the box.',
      });
    }
    const entry = this.resolve(code);
    this.#auto = { enabled: true, code: entry.code, blendName: entry.blendName };
    this.#log(`Automatic writing on: ${entry.code} (${entry.blendName}) to every new tag.`);
    // A fresh tag already sitting on the reader is "a new tag" too.
    if (this.#phase === 'tag-seen' && this.#present !== null && !this.#present.bad && !this.alreadyAttempted(this.#present.uid)) {
      if (this.#pending === null) this.#pending = { code: entry.code, automatic: true };
      this.#wake?.();
    }
    this.emit();
  }

  /* ------------------------------------------------------------------------ */
  /* The loop                                                                   */
  /* ------------------------------------------------------------------------ */

  private async run(): Promise<void> {
    const reopenMs = this.#options.reopenMs ?? 2000;
    while (!this.#stopping) {
      if (!this.#open) {
        await this.tryOpen();
        if (!this.#open) await this.sleep(reopenMs);
        continue;
      }
      const pending = this.#pending;
      if (pending !== null) {
        this.#pending = null;
        await this.write(pending);
        continue;
      }
      await this.poll();
    }
  }

  private async tryOpen(): Promise<void> {
    try {
      await this.#transport.open();
    } catch (cause) {
      const error = asChipError(cause, 'TRANSPORT_UNAVAILABLE', 'Check the reader is plugged in, then wait a few seconds.');
      const news = this.#phase !== 'reader-not-found';
      this.update({ phase: 'reader-not-found', readerName: null, uid: null, error: plain(error), url: null, code: null, blendName: null });
      if (news) {
        this.#log(`Reader not found: ${error.message}`);
        this.notice('error', 'Reader not found', error.message);
      }
      return;
    }
    this.#open = true;
    this.#present = null;
    this.#absentStreak = 0;
    this.#anotherProgram = null;
    const name = this.#options.readerName?.() ?? this.#transport.name;
    this.#log(`Reader ready: ${name}`);
    this.update({ phase: 'waiting-for-tag', readerName: name, uid: null, error: null, url: null, code: null, blendName: null });
    this.notice('reader-ready', 'Reader ready', name);
  }

  private async poll(): Promise<void> {
    const pollMs = this.#options.pollMs ?? 400;
    const idleMs = this.#options.idleMs ?? 300;
    let identity: TagIdentity;
    try {
      identity = await this.#transport.waitForTag(pollMs);
    } catch (cause) {
      const error = asChipError(cause, 'TAG_ABSENT', 'Put one tag flat on the reader.');
      // A transport may say which kind of TAG_ABSENT it is. Only "no tag" means no tag:
      // a reader that went away is reader trouble, a tag that is there but not ready is
      // retried with the reader left open, and a tag that is there but will not answer is
      // shown, once it has failed to answer twice in a row.
      const absentCase = error.code === 'TAG_ABSENT' ? error.detail.case : undefined;
      if (error.code === 'TRANSPORT_UNAVAILABLE' || absentCase === 'READER_GONE') {
        this.#unreadableStreak = 0;
        this.#notReadyStreak = 0;
        await this.onReaderTrouble(error);
        return;
      }
      this.#troubleStreak = 0;
      if (absentCase === 'TAG_NOT_READY') {
        this.#unreadableStreak = 0;
        await this.release('leave');
        await this.onNotReady(error);
        return;
      }
      this.#notReadyStreak = 0;
      if (error.code === 'TAG_ABSENT' && (absentCase === undefined || absentCase === 'NO_TAG')) {
        this.#unreadableStreak = 0;
        this.onAbsent();
        return;
      }
      if (error.code === 'TAG_ABSENT') {
        await this.release('leave');
        this.#unreadableStreak += 1;
        // A connect refused because another program holds the tag is shown at once, as that.
        const elsewhere = typeof error.detail.otherProgram === 'string' ? error.detail.otherProgram : null;
        if (elsewhere !== null) {
          this.suspectAnotherProgram(`The reader reported the tag in use by another program (${elsewhere}).`);
          this.onBadTag(error, 'Another program is reading the tags');
        } else if (this.#unreadableStreak >= (this.#options.removalPolls ?? 2)) this.onBadTag(error, 'The reader cannot read the tag');
        await this.sleep(idleMs);
        return;
      }
      this.#unreadableStreak = 0;
      // Something is in the field and it is not a tag this tool writes.
      await this.release('leave');
      this.onBadTag(error);
      await this.sleep(idleMs);
      return;
    }
    // Detection only. The tag is selected again, from scratch, when it is written.
    await this.release('leave');
    this.clearAnotherProgram();
    this.#unreadableStreak = 0;
    this.#notReadyStreak = 0;
    this.#troubleStreak = 0;
    const bytes = identity.blockCount * identity.blockSizeBytes;
    if (bytes !== PART.totalBytes) {
      // The same size check UnitSession.selectTag makes, made here as well so a tag
      // it would refuse is shown as the wrong kind before anyone presses Write.
      this.onBadTag(
        new ChipError(
          'TAG_NOT_ST25TV02KC',
          `The tag reports ${identity.blockCount} blocks of ${identity.blockSizeBytes} bytes, which is ${bytes} bytes. An ${PART.partNumber} is ${PART.totalBytes} bytes in ${PART.blockCount} blocks of ${PART.blockSizeBytes}.`,
          'This is not the part this tool writes. Check which tags are in front of you. Do not write it.',
          { blockCount: identity.blockCount, blockSizeBytes: identity.blockSizeBytes, reportedPart: identity.partNumber },
        ),
      );
      await this.sleep(idleMs);
      return;
    }
    this.onPresent(identity);
    await this.sleep(idleMs);
  }

  private onPresent(identity: TagIdentity): void {
    this.#absentStreak = 0;
    const uid = identity.uid;
    const present = this.#present;
    if (present !== null && !present.bad && present.uid === uid) return;

    this.#present = { uid, bad: false };
    this.#log(`Tag seen: ${uid ?? 'UID not reported'}`);
    this.update({ phase: 'tag-seen', uid, error: null, url: null, code: null, blendName: null });
    this.notice('tag-seen', 'Tag seen', `UID ${uid ?? 'not reported'}`);

    if (this.#auto.enabled && this.#auto.code !== null && !this.alreadyAttempted(uid) && this.#pending === null) {
      this.#pending = { code: this.#auto.code, automatic: true };
    }
  }

  /**
   * A tag is on the reader and was not ready to be read: the transport connected, then
   * found no tag, and already tried again itself. Not reader trouble, so the reader stays
   * open, and the next poll waits longer each time this repeats.
   *
   * A tag already seen and still sitting there is given one of these quietly, the way one
   * missed poll is: after a write the tag has just been powered down, and the reader may
   * still be bringing it back up.
   *
   * Twice in a row, each after the transport's own three tries, or once with the reader
   * reporting the tag in use, is another program reading the tags: GoToTags on Dan's
   * machine, seen typing each tag's UID on his screen recording, 26 October 2026.
   */
  private async onNotReady(error: ChipError): Promise<void> {
    this.#notReadyStreak += 1;
    const base = this.#options.notReadyMs ?? 500;
    const pause = Math.min(base * 2 ** (this.#notReadyStreak - 1), base * 8);
    const holding = this.#present !== null && !this.#present.bad;
    const elsewhere = typeof error.detail.otherProgram === 'string' ? error.detail.otherProgram : null;
    if (elsewhere !== null) {
      this.suspectAnotherProgram(`The reader reported the tag in use by another program (${elsewhere}).`);
    } else if (this.#notReadyStreak >= 2) {
      this.suspectAnotherProgram(`The tag was not ready ${this.#notReadyStreak} times in a row, each after three tries.`);
    }
    if (!holding || elsewhere !== null || this.#notReadyStreak >= (this.#options.removalPolls ?? 2)) {
      this.#present = null;
      this.#absentStreak = 0;
      this.update({ phase: 'tag-not-ready', uid: null, error: plain(error), url: null, code: null, blendName: null });
    }
    this.#log(`Tag not ready, retrying in ${pause / 1000} s: ${error.message}`);
    await this.sleep(pause);
  }

  /**
   * Another program is reading the tags. Logged once until a tag reads properly. The page
   * shows ANOTHER_PROGRAM_ADVICE in its own banner, and raises the desktop notification
   * for it, the same one it raises when it sees a tag's ID typed in.
   */
  private suspectAnotherProgram(reason: string): void {
    if (this.#anotherProgram !== null) return;
    this.#anotherProgram = reason;
    this.#log(`Another program is reading the tags (usually GoToTags): ${reason}`);
    this.emit();
  }

  private clearAnotherProgram(): void {
    if (this.#anotherProgram === null) return;
    this.#anotherProgram = null;
    this.#log('The tag read properly. Nothing else is reading the tags now.');
    this.emit();
  }

  /** `title` is for the notification, when the error code's own plain words would mislead. */
  private onBadTag(error: ChipError, title: string = error.code): void {
    this.#absentStreak = 0;
    const present = this.#present;
    if (present !== null && present.bad && this.#error?.code === error.code) return;
    this.#present = { uid: null, bad: true };
    this.#log(`Tag on the reader cannot be written: ${error.code}: ${error.message}`);
    this.update({ phase: 'error', uid: null, error: plain(error), url: null, code: null, blendName: null });
    this.notice('error', title, error.message);
  }

  private onAbsent(): void {
    this.#absentStreak += 1;
    const removalPolls = this.#options.removalPolls ?? 2;
    if (this.#present !== null && this.#absentStreak >= removalPolls) {
      this.#present = null;
      this.#log('Tag taken off. Waiting for the next tag.');
      this.update({ phase: 'waiting-for-tag', uid: null, error: null, url: null, code: null, blendName: null });
    } else if (this.#present === null && this.#phase !== 'waiting-for-tag') {
      this.update({ phase: 'waiting-for-tag', uid: null, error: null, url: null, code: null, blendName: null });
    }
  }

  /**
   * The reader stopped answering. Close it and open it again straight away: it is not
   * worth a notification. Only if it will not open again is the reader reported missing.
   * If it is trouble again on the very next poll, reopening at once is not helping, so
   * each repeat waits longer before the next poll, up to four times `reopenMs`.
   */
  private async onReaderTrouble(error: ChipError): Promise<void> {
    this.#troubleStreak += 1;
    this.#log(`Reader trouble, reconnecting: ${error.message}`);
    await this.#transport.close().catch(() => undefined);
    this.#open = false;
    try {
      await this.#transport.open();
      this.#open = true;
      this.#present = null;
      this.#absentStreak = 0;
      if (this.#phase !== 'waiting-for-tag') {
        this.update({ phase: 'waiting-for-tag', uid: null, error: null, url: null, code: null, blendName: null });
      }
      if (this.#troubleStreak >= 2) {
        const reopenMs = this.#options.reopenMs ?? 2000;
        await this.sleep(Math.min(reopenMs * 2 ** (this.#troubleStreak - 2), reopenMs * 4));
      }
    } catch (cause) {
      const again = asChipError(cause, 'TRANSPORT_UNAVAILABLE', 'Check the reader is plugged in.');
      this.#log(`Reader not found: ${again.message}`);
      this.update({ phase: 'reader-not-found', readerName: null, uid: null, error: plain(again), url: null, code: null, blendName: null });
      this.notice('error', 'Reader not found', again.message);
    }
  }

  /* ------------------------------------------------------------------------ */
  /* Writing one tag                                                            */
  /* ------------------------------------------------------------------------ */

  private async write(request: PendingWrite): Promise<void> {
    if (request.automatic && !this.#auto.enabled) return;
    if (this.#present === null || this.#present.bad) {
      // The tag left between the press and the write. Nothing to do and nothing written.
      this.#log('Write skipped: the tag was taken off before it could be written.');
      return;
    }
    let resolved: { entry: TagCodeEntry; uri: string };
    try {
      resolved = this.#table.uriFor(request.code);
    } catch (cause) {
      const error = asChipError(cause, 'CODE_UNKNOWN', 'Choose a code from the list.');
      this.update({ phase: 'error', error: plain(error) });
      this.notice('error', error.code, error.message);
      return;
    }
    const { entry, uri } = resolved;

    this.#log(`Writing ${entry.code} (${entry.blendName}) to tag ${this.#present.uid ?? 'with no UID'}${request.automatic ? ', automatically' : ''}.`);
    this.update({ phase: 'writing', code: entry.code, blendName: entry.blendName, url: null, error: null });

    let journal: CodeJournal;
    try {
      journal = this.journalFor(entry, uri);
    } catch (cause) {
      const error = asChipError(cause, 'JOURNAL_CORRUPT', 'Check the runs folder can be written to.');
      this.update({ phase: 'error', error: plain(error) });
      this.notice('error', error.code, error.message);
      return;
    }

    const attempts = Math.max(1, this.#options.attemptsPerWrite ?? 2);
    let record: UnitRecord | null = null;
    for (let tryIndex = 0; tryIndex < attempts; tryIndex += 1) {
      journal.attempt += 1;
      const result = await this.writeOne(entry, uri, journal.nextSeq, journal.attempt);
      try {
        record = journal.journal.append<UnitRecord>(result);
      } catch (cause) {
        const error = asChipError(cause, 'JOURNAL_CORRUPT', 'Check the runs folder can be written to. Set this tag aside until it is recorded.');
        await this.release();
        this.update({ phase: 'error', error: plain(error) });
        this.notice('error', error.code, error.message);
        return;
      }
      this.remember(record, entry);
      if (record.outcome !== 'failed') break;
      if (tryIndex < attempts - 1) {
        this.#log(`Attempt ${record.attempt} failed (${record.error?.code ?? 'unknown'}), trying the same tag once more.`);
        await this.release();
      }
    }
    // As the batch does: the unit is finished, recorded, and the reader let go of it.
    await this.#transport.completeUnit().catch(() => undefined);

    if (record === null) return;
    this.#lastAttemptUid = record.uid;
    if (record.uid !== null) this.#present = { uid: record.uid, bad: false };

    if (record.outcome === 'verified') {
      journal.nextSeq += 1;
      journal.attempt = 0;
      journal.verified += 1;
      if (record.uid === null) this.#verifiedWithoutUid += 1;
      else this.#verifiedUids.add(record.uid);
      const url = this.decodedUrl(record);
      const tally = this.tally();
      this.#log(`Written and verified: ${entry.code} on ${record.uid ?? 'tag'}, reads back ${url}. ${tally}.`);
      this.update({ phase: 'written', uid: record.uid, url, error: null });
      this.notice('written', `Written: ${entry.code} ${entry.blendName}`, `Verified, reads back ${url}. ${tally} this session. Take it off and put the next tag on.`);
    } else {
      journal.failed += 1;
      // What was verified on this tag before may not be on it now.
      if (record.uid !== null) this.#verifiedUids.delete(record.uid);
      const error: PlainError = record.error ?? { code: 'WRITE_FAILED', message: 'The write failed.', remedy: 'Set this tag aside.' };
      this.#log(`Failed: ${error.code}: ${error.message}`);
      this.update({ phase: 'error', uid: record.uid ?? this.#uid, url: null, error });
      this.notice('error', error.code, error.message);
    }
  }

  /** One attempt, through UnitSession, recorded in the same shape the batch records. */
  private async writeOne(entry: TagCodeEntry, uri: string, seq: number, attempt: number): Promise<Omit<UnitRecord, 'digest'>> {
    const started = Date.now();
    const base = {
      kind: 'unit' as const,
      seq,
      attempt,
      at: this.#now().toISOString(),
      code: entry.code,
      uri,
    };
    const session = new UnitSession({
      transport: this.#transport,
      uri,
      code: entry.code,
      ccPolicy: 'preserve',
      tagTimeoutMs: this.#options.tagTimeoutMs ?? 3000,
      verifyAfterPowerCycle: false,
      now: this.#now,
    });
    try {
      const identity = await session.selectTag();
      if (identity.uid !== null) this.update({ uid: identity.uid });
      const plan = await session.write();
      const receipt = await session.verify();
      return {
        ...base,
        outcome: 'verified',
        uid: identity.uid,
        phaseReached: session.phase,
        blocksWritten: plan.blocksWritten,
        areaBytesUsed: plan.areaBytesUsed,
        areaBytesFree: plan.areaBytesFree,
        ccAction: plan.ccAction,
        identifierCode: planEncoding(uri).summary.identifierCode,
        readBackHex: receipt.readBackHex,
        verifiedAt: receipt.verifiedAt,
        powerCycled: receipt.powerCycled,
        protection: null,
        error: null,
        durationMs: Date.now() - started,
      };
    } catch (cause) {
      const error = asChipError(cause, 'WRITE_FAILED', 'Set this tag aside, label it, and continue with the next one.');
      return {
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
    }
  }

  /**
   * The URL as decoded off the tag, from the bytes the verify step read back. A
   * verified record exists only when UnitSession found it equal to the intended URI,
   * so this decodes again for the page rather than echoing what was asked for.
   */
  private decodedUrl(record: UnitRecord): string {
    if (record.readBackHex === null) return record.uri;
    try {
      return decodeUriMessage(unwrapNdefTlv(fromHex(record.readBackHex).subarray(CC_BYTES))).uri;
    } catch {
      return record.uri;
    }
  }

  /** One journal per product code for this session, header written on first use. */
  private journalFor(entry: TagCodeEntry, uri: string): CodeJournal {
    const existing = this.#journals.get(entry.code);
    if (existing !== undefined) return existing;

    mkdirSync(this.#options.journalDir, { recursive: true });
    const startedAt = this.#now().toISOString();
    const stamp = startedAt.replace(/[:.]/g, '-');
    let path = join(this.#options.journalDir, `tag-tool-${stamp}-${entry.code}.jsonl`);
    for (let n = 2; existsSync(path); n += 1) {
      path = join(this.#options.journalDir, `tag-tool-${stamp}-${entry.code}-${n}.jsonl`);
    }

    const journal = new Journal(path);
    journal.append<RunHeaderRecord>({
      kind: 'run',
      format: JOURNAL_FORMAT,
      runId: randomUUID(),
      startedAt,
      toolVersion: this.#options.toolVersion,
      code: entry.code,
      blendName: entry.blendName,
      uri,
      // Open ended: the Tag Tool writes until the operator stops, so there is no target.
      targetCount: 0,
      tablePath: this.#table.path,
      tableDigest: this.#table.digest,
      tableVersion: this.#table.version,
      transport: this.#transport.name,
      transportIsHardware: this.#transport.isHardware,
      protectRequested: false,
      passwordFingerprint: null,
      operator: this.#options.operator ?? safeUser(),
      host: safeHost(),
      dryRun: false,
    });
    const created: CodeJournal = { journal, path, nextSeq: 1, attempt: 0, verified: 0, failed: 0 };
    this.#journals.set(entry.code, created);
    this.#log(`Journal for ${entry.code}: ${path}`);
    return created;
  }

  /* ------------------------------------------------------------------------ */
  /* Helpers                                                                    */
  /* ------------------------------------------------------------------------ */

  private resolve(code: string): TagCodeEntry {
    try {
      return this.#table.uriFor(code).entry;
    } catch (cause) {
      const error = asChipError(cause, 'CODE_UNKNOWN', 'Choose a code from the list.');
      throw new AppRefusal(400, plain(error));
    }
  }

  private alreadyAttempted(uid: string | null): boolean {
    return uid !== null && uid === this.#lastAttemptUid;
  }

  /**
   * Lets go of the tag, powering it down by default, as the batch does. A poll only reads,
   * so it passes `leave`: powering the tag down every poll made the reader drop it and find
   * it again, and the next poll raced that.
   */
  private async release(disposition: 'unpower' | 'leave' = 'unpower'): Promise<void> {
    await this.#transport.releaseTag(disposition).catch(() => undefined);
  }

  private remember(record: UnitRecord, entry: TagCodeEntry): void {
    if (record.outcome === 'failed') this.#failedAttempts += 1;
    this.#recent.unshift({
      at: record.at,
      seq: record.seq,
      attempt: record.attempt,
      code: record.code,
      blendName: entry.blendName,
      uid: record.uid,
      outcome: record.outcome === 'failed' ? 'failed' : 'verified',
      url: record.outcome === 'failed' ? null : this.decodedUrl(record),
      error: record.error,
    });
  }

  private writtenCount(): number {
    return this.#verifiedUids.size + this.#verifiedWithoutUid;
  }

  /** "3 tags written and verified", the words the page uses beside the count. */
  private tally(): string {
    const n = this.writtenCount();
    return `${n} ${n === 1 ? 'tag' : 'tags'} written and verified`;
  }

  private sleep(ms: number): Promise<void> {
    if (this.#stopping) return Promise.resolve();
    return new Promise((resolve) => {
      const done = (): void => {
        clearTimeout(timer);
        if (this.#wake === done) this.#wake = null;
        resolve();
      };
      const timer = setTimeout(done, ms);
      this.#wake = done;
    });
  }

  private update(fields: {
    phase?: Phase;
    readerName?: string | null;
    uid?: string | null;
    code?: string | null;
    blendName?: string | null;
    url?: string | null;
    error?: PlainError | null;
  }): void {
    if (fields.phase !== undefined) this.#phase = fields.phase;
    if (fields.readerName !== undefined) this.#readerName = fields.readerName;
    if (fields.uid !== undefined) this.#uid = fields.uid;
    if (fields.code !== undefined) this.#code = fields.code;
    if (fields.blendName !== undefined) this.#blendName = fields.blendName;
    if (fields.url !== undefined) this.#url = fields.url;
    if (fields.error !== undefined) this.#error = fields.error;
    this.emit();
  }

  private notice(kind: NoticeKind, title: string, body: string): void {
    this.#noticeId += 1;
    this.#notices.push({ id: this.#noticeId, kind, title, body, at: this.#now().toISOString() });
    if (this.#notices.length > MAX_NOTICES) this.#notices.shift();
    this.emit();
  }

  /** Tells the page. Also called by the server after a simulator button, so its state shows. */
  emit(): void {
    const snapshot = this.snapshot();
    for (const listener of this.#listeners) {
      try {
        listener(snapshot);
      } catch {
        // A page that went away mid send is not the loop's problem.
      }
    }
  }
}
