/**
 * The hardware boundary.
 *
 * Everything above this interface is pure logic and is fully exercised by the test
 * suite on a machine with no reader and no tags. Everything below it is one file.
 * Adding real hardware means writing one more implementation of `TagTransport`, not
 * changing anything that uses it.
 *
 * The interface is deliberately chip shaped rather than NDEF shaped. It speaks
 * blocks, passwords and area protection, which is what an ISO/IEC 15693 reader
 * actually offers. Pushing NDEF down here would put encoding logic on the wrong
 * side of the boundary, where it could not be tested without a reader.
 *
 * Implementations in this package:
 *   simulator.ts    an in memory ST25TV02KC. Used by the tests and by --transport simulator.
 *   reader-stub.ts  the real reader. Not implemented, and it says so rather than pretending.
 */

import type { AreaProtection } from '../chip/st25tv02kc.js';

export interface TagIdentity {
  /** 64 bit UID as 16 hex characters, or null if the reader cannot supply one. */
  readonly uid: string | null;
  /** What the tag says it is, when the reader can tell. Null is normal on many readers. */
  readonly partNumber: string | null;
  readonly blockCount: number;
  readonly blockSizeBytes: number;
}

export interface AreaProtectionState {
  readonly protection: AreaProtection;
  readonly passwordNumber: number;
}

/** What the opcode probe concluded, and why, in words for the operator. */
export interface OpcodeProbeResult {
  readonly proven: boolean;
  readonly detail: string;
}

export interface TagTransport {
  /** Short name for the batch record, for example "simulator" or "pcsc". */
  readonly name: string;
  /** True only when real silicon is involved. Drives the honesty banner and the journal. */
  readonly isHardware: boolean;

  open(): Promise<void>;
  close(): Promise<void>;

  /**
   * Waits for one tag in the field and selects it.
   * Rejects with ChipError TAG_ABSENT if none arrives before the timeout.
   */
  waitForTag(timeoutMs: number): Promise<TagIdentity>;

  /** Reads `count` blocks starting at `firstBlock`. Returns count * blockSize bytes. */
  readBlocks(firstBlock: number, count: number): Promise<Uint8Array>;

  /** Writes exactly one block. `data` must be exactly one block long. */
  writeBlock(block: number, data: Uint8Array): Promise<void>;

  /**
   * Presents a password for this session. On success the areas that password governs
   * accept writes until the tag leaves the field.
   */
  presentPassword(passwordNumber: number, password: Uint8Array): Promise<void>;

  /** Changes a stored password. Requires the current password to have been presented. */
  writePassword(passwordNumber: number, password: Uint8Array): Promise<void>;

  /** Sets an area's protection state and the password number that governs it. */
  setAreaProtection(area: number, protection: AreaProtection, passwordNumber: number): Promise<void>;

  readAreaProtection(area: number): Promise<AreaProtectionState>;

  /**
   * The post protection proof. Writes `data`, which must be the bytes `block` already
   * holds, and reports the tag's own verdict: 'refused' only when the tag refused because
   * the block is write protected, 'accepted' when the write went through. Anything else,
   * including a refusal whose reason cannot be told, rejects. A transport must never
   * report 'refused' for a write that merely failed, because that would record an
   * unprotected tag as protected.
   *
   * `expectedUid` is the UID the unit selected at the start. A transport that can read a
   * UID must refuse, sending nothing, unless the tag in front of it is that tag.
   */
  proveWriteRefused(block: number, data: Uint8Array, expectedUid: string | null): Promise<'refused' | 'accepted'>;

  /**
   * The unlock proof, run after the refusal proof. Presents `password` as `passwordNumber`
   * and writes `data`, which must be the bytes `block` already holds, and resolves only when
   * the tag accepted both. Anything else rejects. It shows the password this run recorded
   * opens the tag after protection (review finding N1). The same UID rule as the refusal
   * proof applies.
   */
  proveWriteUnlocked(block: number, data: Uint8Array, passwordNumber: number, password: Uint8Array, expectedUid: string | null): Promise<void>;

  /**
   * How many irreversible frames (on the PC/SC transport, WritePassword and
   * WriteConfiguration) have been handed to the reader so far. Counts up immediately before
   * each one is transmitted. A transport that cannot say leaves it undefined, and then any
   * failure after the probe is treated as though one had been sent (review finding N3).
   */
  readonly irreversibleFramesSent?: number | undefined;

  /**
   * Proves, on the tag in the field and without changing it, that the command path the
   * irreversible protection commands travel is right. Present on transports whose
   * protection opcodes are not proven by construction, which today means the PC/SC one.
   * `UnitSession.protect` runs it immediately before the first irreversible command and
   * refuses to continue unless it passes. A hardware transport without it is refused
   * protection outright. See README section 6.4.
   */
  verifyOpcodes?(): Promise<OpcodeProbeResult>;

  /**
   * Drops the tag out of the field. Any presented password stops applying, which is
   * how the tool proves that protection actually took effect rather than merely
   * being accepted.
   *
   * `'leave'` lets go of the tag without powering it down, on a transport where that
   * differs (PC/SC). Only for a read only detection, the Tag Tool's polls: it would leave a
   * presented password applying, so the write and protection paths never pass it.
   */
  releaseTag(disposition?: 'unpower' | 'leave'): Promise<void>;

  /**
   * Signals that this unit is finished and the next tag will be a different one.
   * A real reader has nothing to do here. The simulator advances its tray.
   */
  completeUnit(): Promise<void>;
}

/**
 * Counts every call, and refuses none. Wrapped around a transport in tests to prove
 * that dry run performs zero writes, and that the protect step never runs before
 * the verify step.
 */
export class RecordingTransport implements TagTransport {
  readonly calls: { method: string; args: unknown[] }[] = [];
  /** Present exactly when the wrapped transport has a probe, so wrapping never adds or hides one. */
  readonly verifyOpcodes?: () => Promise<OpcodeProbeResult>;

  constructor(private readonly inner: TagTransport) {
    const probe = inner.verifyOpcodes?.bind(inner);
    if (probe !== undefined) this.verifyOpcodes = () => this.record('verifyOpcodes', [], probe);
  }

  get name(): string {
    return this.inner.name;
  }

  get isHardware(): boolean {
    return this.inner.isHardware;
  }

  private record<T>(method: string, args: unknown[], run: () => Promise<T>): Promise<T> {
    this.calls.push({ method, args });
    return run();
  }

  /** Every call in order, as method names. */
  methodSequence(): string[] {
    return this.calls.map((c) => c.method);
  }

  countOf(method: string): number {
    return this.calls.filter((c) => c.method === method).length;
  }

  open(): Promise<void> {
    return this.record('open', [], () => this.inner.open());
  }
  close(): Promise<void> {
    return this.record('close', [], () => this.inner.close());
  }
  waitForTag(timeoutMs: number): Promise<TagIdentity> {
    return this.record('waitForTag', [timeoutMs], () => this.inner.waitForTag(timeoutMs));
  }
  readBlocks(firstBlock: number, count: number): Promise<Uint8Array> {
    return this.record('readBlocks', [firstBlock, count], () => this.inner.readBlocks(firstBlock, count));
  }
  writeBlock(block: number, data: Uint8Array): Promise<void> {
    return this.record('writeBlock', [block], () => this.inner.writeBlock(block, data));
  }
  presentPassword(passwordNumber: number, password: Uint8Array): Promise<void> {
    // The password value is not recorded. Nothing that holds one is ever kept here.
    return this.record('presentPassword', [passwordNumber], () =>
      this.inner.presentPassword(passwordNumber, password),
    );
  }
  writePassword(passwordNumber: number, password: Uint8Array): Promise<void> {
    return this.record('writePassword', [passwordNumber], () => this.inner.writePassword(passwordNumber, password));
  }
  setAreaProtection(area: number, protection: AreaProtection, passwordNumber: number): Promise<void> {
    return this.record('setAreaProtection', [area, protection, passwordNumber], () =>
      this.inner.setAreaProtection(area, protection, passwordNumber),
    );
  }
  readAreaProtection(area: number): Promise<AreaProtectionState> {
    return this.record('readAreaProtection', [area], () => this.inner.readAreaProtection(area));
  }
  proveWriteRefused(block: number, data: Uint8Array, expectedUid: string | null): Promise<'refused' | 'accepted'> {
    return this.record('proveWriteRefused', [block, expectedUid], () => this.inner.proveWriteRefused(block, data, expectedUid));
  }
  proveWriteUnlocked(block: number, data: Uint8Array, passwordNumber: number, password: Uint8Array, expectedUid: string | null): Promise<void> {
    // The password value is not recorded.
    return this.record('proveWriteUnlocked', [block, passwordNumber, expectedUid], () =>
      this.inner.proveWriteUnlocked(block, data, passwordNumber, password, expectedUid),
    );
  }
  get irreversibleFramesSent(): number | undefined {
    return this.inner.irreversibleFramesSent;
  }
  releaseTag(disposition?: 'unpower' | 'leave'): Promise<void> {
    return this.record('releaseTag', disposition === undefined ? [] : [disposition], () => this.inner.releaseTag(disposition));
  }
  completeUnit(): Promise<void> {
    return this.record('completeUnit', [], () => this.inner.completeUnit());
  }
}
