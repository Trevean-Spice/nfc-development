/**
 * The Tag Tool's view of a transport: writing and reading only.
 *
 * The Tag Tool never protects a tag. It has no password field, and it never calls
 * UnitSession's protect step or builds a password. This wrapper is the
 * third, independent statement of the same rule: the three commands that present,
 * change or apply a password are refused here before they reach the reader, so a
 * future edit that wired one up by mistake fails loudly on the first tag instead
 * of locking it.
 *
 * Everything else is passed straight through, unchanged, so the write and verify
 * path a unit takes in the Tag Tool is exactly the one it takes in chip-cli.
 */

import { ChipError } from '../chip/errors.js';
import type { AreaProtection } from '../chip/st25tv02kc.js';
import type { AreaProtectionState, TagIdentity, TagTransport } from '../transport/transport.js';

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
  readAreaProtection(area: number): Promise<AreaProtectionState> {
    return this.inner.readAreaProtection(area);
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
}
