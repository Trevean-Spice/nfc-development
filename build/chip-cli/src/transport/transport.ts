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
   * Drops the tag out of the field. Any presented password stops applying, which is
   * how the tool proves that protection actually took effect rather than merely
   * being accepted.
   */
  releaseTag(): Promise<void>;

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

  constructor(private readonly inner: TagTransport) {}

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
  releaseTag(): Promise<void> {
    return this.record('releaseTag', [], () => this.inner.releaseTag());
  }
  completeUnit(): Promise<void> {
    return this.record('completeUnit', [], () => this.inner.completeUnit());
  }
}
