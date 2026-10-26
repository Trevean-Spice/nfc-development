/**
 * The Tag Tool's view of a transport: writing and reading only.
 *
 * The Tag Tool never protects a tag. It has no password field, and it never calls
 * UnitSession's protect step or builds a password. This wrapper is the
 * third, independent statement of the same rule: every command on the protection
 * path is refused here before it reaches the reader, so a future edit that wired one
 * up by mistake fails loudly on the first tag instead of locking it. That is the
 * three that present, change or apply a password, the opcode probe, the protection
 * read, and the two proofs that follow protection.
 *
 * Everything else is passed straight through, unchanged, so the write and verify
 * path a unit takes in the Tag Tool is exactly the one it takes in chip-cli.
 * `test/tag-tool.test.ts` lists every TagTransport member and which side it is on,
 * and the build fails until a new member is placed on one.
 */

import { ChipError } from '../chip/errors.js';
import type { AreaProtection } from '../chip/st25tv02kc.js';
import type { AreaProtectionState, OpcodeProbeResult, TagIdentity, TagTransport } from '../transport/transport.js';

function refused(what: string): ChipError {
  return new ChipError(
    'USAGE',
    `The Tag Tool tried to ${what}. It writes and checks tags and never locks them.`,
    'This is a bug in the Tag Tool. Nothing was sent to the tag. Report it.',
    {},
  );
}

export class WriteOnlyTransport implements TagTransport {
  constructor(readonly inner: TagTransport) {}

  get name(): string {
    return this.inner.name;
  }

  get isHardware(): boolean {
    return this.inner.isHardware;
  }

  /** Read only, and passed through so a test can show it stayed at 0. */
  get irreversibleFramesSent(): number | undefined {
    return this.inner.irreversibleFramesSent;
  }

  open(): Promise<void> {
    return this.inner.open();
  }
  close(): Promise<void> {
    return this.inner.close();
  }
  waitForTag(timeoutMs: number): Promise<TagIdentity> {
    return this.inner.waitForTag(timeoutMs);
  }
  readBlocks(firstBlock: number, count: number): Promise<Uint8Array> {
    return this.inner.readBlocks(firstBlock, count);
  }
  writeBlock(block: number, data: Uint8Array): Promise<void> {
    return this.inner.writeBlock(block, data);
  }
  releaseTag(): Promise<void> {
    return this.inner.releaseTag();
  }
  completeUnit(): Promise<void> {
    return this.inner.completeUnit();
  }

  async presentPassword(_passwordNumber: number, _password: Uint8Array): Promise<void> {
    throw refused('present a tag password');
  }
  async writePassword(_passwordNumber: number, _password: Uint8Array): Promise<void> {
    throw refused('change a tag password');
  }
  async setAreaProtection(_area: number, _protection: AreaProtection, _passwordNumber: number): Promise<void> {
    throw refused('change area protection');
  }
  async readAreaProtection(_area: number): Promise<AreaProtectionState> {
    throw refused('read area protection');
  }
  async verifyOpcodes(): Promise<OpcodeProbeResult> {
    throw refused('run the opcode probe');
  }
  async proveWriteRefused(_block: number, _data: Uint8Array, _expectedUid: string | null): Promise<'refused' | 'accepted'> {
    throw refused('prove a tag refuses writes');
  }
  async proveWriteUnlocked(_block: number, _data: Uint8Array, _passwordNumber: number, _password: Uint8Array, _expectedUid: string | null): Promise<void> {
    throw refused('prove a tag password opens it');
  }
}
