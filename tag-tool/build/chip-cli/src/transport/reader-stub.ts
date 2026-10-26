/**
 * The real reader. Not implemented.
 *
 * This file is the whole hardware boundary. Everything else in the package is
 * finished and tested. Making the tool drive physical tags means filling in the
 * twelve methods below against a chosen reader, and changing nothing else.
 *
 * It throws rather than silently doing nothing, because a tool that pretends to
 * write tags is worse than a tool that says it cannot.
 *
 * -------------------------------------------------------------------------
 * Notes for whoever implements it
 * -------------------------------------------------------------------------
 *
 * Reader choice. Any ISO/IEC 15693 capable reader will do. It must expose the ST
 * custom command set, not only the ISO subset, because the password and area
 * protection commands are ST specific. Readers that only speak ISO 14443 cannot
 * talk to this tag at all: that is the same Type 5 versus Type 2 split that runs
 * through this whole project.
 *
 * Commands needed, per the ST25TV02KC datasheet and application note AN5658:
 *
 *   ISO/IEC 15693 standard
 *     Inventory                anticollision and UID
 *     Read Single Block        readBlocks
 *     Write Single Block       writeBlock
 *     Get System Information   block count and block size, for the geometry check
 *
 *   ST custom, IC manufacturer code 0x02
 *     Present Password         presentPassword
 *     Write Password           writePassword
 *     Write Configuration      setAreaProtection
 *     Read Configuration       readAreaProtection
 *
 * The opcode values are deliberately not written down here. They belong in the
 * implementation, taken from the datasheet at the time of writing, and confirmed
 * against a tag on a bench. Copying them into a stub that has never run would
 * create exactly the kind of unverified fact this project keeps out of its
 * documents.
 *
 * Contract the rest of the tool relies on:
 *
 *   - writeBlock must not return until the block is committed to EEPROM. If the
 *     reader returns on acknowledgement rather than on programming completion, add
 *     the wait here. The read back verification will catch it if you do not, which
 *     is the point, but catching it once per tag at pack out is expensive.
 *   - releaseTag must genuinely drop the tag out of the field so a presented
 *     password stops applying. If it does not, the tool's proof that protection
 *     took effect becomes a proof that the command was accepted, which is weaker.
 *   - Every failure must be thrown as a ChipError with one of the codes in
 *     chip/errors.ts. A raw reader error reaching the batch runner is recorded as
 *     an unknown failure, which is correct but unhelpful.
 *
 * Before this is used on stock, section 6 of the README lists what has to be
 * verified on real silicon, in order, on sacrificial tags.
 */

import { ChipError } from '../chip/errors.js';
import type { AreaProtection } from '../chip/st25tv02kc.js';
import type { AreaProtectionState, TagIdentity, TagTransport } from './transport.js';

function notImplemented(method: string): never {
  throw new ChipError(
    'TRANSPORT_UNAVAILABLE',
    `The physical reader transport is not implemented (${method}).`,
    'Run with --transport simulator, which needs no hardware. Wiring up a real reader is one file: src/transport/reader-stub.ts.',
    { method },
  );
}

export class PhysicalReaderTransport implements TagTransport {
  readonly name = 'reader';
  readonly isHardware = true;

  async open(): Promise<void> {
    notImplemented('open');
  }
  async close(): Promise<void> {
    notImplemented('close');
  }
  async waitForTag(_timeoutMs: number): Promise<TagIdentity> {
    notImplemented('waitForTag');
  }
  async readBlocks(_firstBlock: number, _count: number): Promise<Uint8Array> {
    notImplemented('readBlocks');
  }
  async writeBlock(_block: number, _data: Uint8Array): Promise<void> {
    notImplemented('writeBlock');
  }
  async presentPassword(_passwordNumber: number, _password: Uint8Array): Promise<void> {
    notImplemented('presentPassword');
  }
  async writePassword(_passwordNumber: number, _password: Uint8Array): Promise<void> {
    notImplemented('writePassword');
  }
  async setAreaProtection(_area: number, _protection: AreaProtection, _passwordNumber: number): Promise<void> {
    notImplemented('setAreaProtection');
  }
  async readAreaProtection(_area: number): Promise<AreaProtectionState> {
    notImplemented('readAreaProtection');
  }
  async proveWriteRefused(_block: number, _data: Uint8Array, _expectedUid: string | null): Promise<'refused' | 'accepted'> {
    notImplemented('proveWriteRefused');
  }
  async proveWriteUnlocked(_block: number, _data: Uint8Array, _passwordNumber: number, _password: Uint8Array, _expectedUid: string | null): Promise<void> {
    notImplemented('proveWriteUnlocked');
  }
  async releaseTag(): Promise<void> {
    notImplemented('releaseTag');
  }
  async completeUnit(): Promise<void> {
    notImplemented('completeUnit');
  }
}
