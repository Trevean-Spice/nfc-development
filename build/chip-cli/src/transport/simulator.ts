/**
 * An in memory ST25TV02KC.
 *
 * This exists because there is no reader and no tag on the machine this tool was
 * written on, and because a tool whose failure paths can only be exercised by
 * physically breaking a write is a tool whose failure paths are never exercised.
 *
 * What it models faithfully:
 *   - 320 bytes in 80 blocks of 4 (DS13304 Rev 7, END_MEM 4Fh), and writes that
 *     land one block at a time
 *   - area based password protection, including refusing a write when the password
 *     for that area has not been presented in the current session
 *   - a session that ends when the tag leaves the field, so a presented password
 *     stops applying, which is how the tool proves protection actually took
 *   - partial writes: a fault that lands some blocks and then fails, which is the
 *     documented ISO/IEC 15693 failure mode and the reason the write plan is
 *     ordered the way it is
 *
 * What it does not model, and what therefore stays unproven until hardware:
 *   - RF behaviour of any kind: range, alignment, collisions, the 8 mm lid
 *   - real command framing, timing, or the ST specific command opcodes
 *   - the password retry counters some ST25 parts implement
 *   - anything a phone does with the tag once it is written
 *
 * See README section 6. This is a model of the memory, not a model of the radio.
 */

import { ChipError, isChipError } from '../chip/errors.js';
import {
  DEFAULT_AREA,
  DEFAULT_AREA_PASSWORD_NUMBER,
  MAX_AREAS,
  PART,
  buildCapabilityContainer,
  type AreaProtection,
} from '../chip/st25tv02kc.js';
import { encodeUriRecord } from '../ndef/encode.js';
import { wrapNdefTlv } from '../ndef/tlv.js';
import { T5T_AREA_BYTES } from '../chip/st25tv02kc.js';
import type { AreaProtectionState, TagIdentity, TagTransport } from './transport.js';

export type SimulatorFaultKind =
  /** No tag ever arrives in the field. */
  | 'tag-absent'
  /** The first block write is refused cleanly. Nothing lands. */
  | 'write-fail'
  /** Some blocks land and then the write fails. The classic ISO 15693 partial write. */
  | 'write-partial'
  /** The read back itself errors. */
  | 'readback-fail'
  /** The write reports success and the memory holds something else. */
  | 'readback-corrupt'
  /** Setting the area protection is refused after a good verified write. */
  | 'protect-fail'
  /** The tag holds a password other than the one the operator supplies. */
  | 'wrong-password'
  /** The tag reports a geometry that is not an ST25TV02KC. */
  | 'geometry-mismatch';

export interface SimulatorOptions {
  /** How many tags are in the tray. Defaults to a large number so a batch never runs dry. */
  readonly trayCount?: number;
  /** Preload every tag with this URI, modelling stock that is already encoded. */
  readonly preloadUri?: string | null;
  /** Preload tags with no capability container at all, modelling virgin stock. */
  readonly preloadBlank?: boolean;
  /** Faults keyed by 1 based tray position. */
  readonly faults?: Readonly<Record<number, SimulatorFaultKind>>;
  /** Password the tags already hold, as 8 bytes. Defaults to the factory sixteen zeros. */
  readonly storedPassword?: Uint8Array;
}

class SimulatedTag {
  readonly uid: string;
  readonly memory: Uint8Array;
  readonly passwords = new Map<number, Uint8Array>();
  readonly areas = new Map<number, AreaProtectionState>();
  readonly presented = new Set<number>();
  blockWrites = 0;

  constructor(uid: string, storedPassword: Uint8Array) {
    this.uid = uid;
    this.memory = new Uint8Array(PART.totalBytes);
    for (let n = 1; n <= 3; n += 1) this.passwords.set(n, storedPassword.slice());
    for (let a = 1; a <= MAX_AREAS; a += 1) {
      this.areas.set(a, { protection: 'none', passwordNumber: DEFAULT_AREA_PASSWORD_NUMBER });
    }
  }
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

export class SimulatorTransport implements TagTransport {
  readonly name = 'simulator';
  readonly isHardware = false;

  #cursor = 0; // 0 based index into the tray
  #current: SimulatedTag | null = null;
  #opened = false;
  readonly #tags = new Map<number, SimulatedTag>();
  readonly #options: SimulatorOptions;

  constructor(options: SimulatorOptions = {}) {
    this.#options = options;
  }

  /** 1 based tray position of the tag currently in the field, for fault lookup. */
  get position(): number {
    return this.#cursor + 1;
  }

  private faultAt(position: number): SimulatorFaultKind | undefined {
    return this.#options.faults?.[position];
  }

  private tagAt(position: number): SimulatedTag {
    const existing = this.#tags.get(position);
    if (existing) return existing;
    const stored = this.#options.storedPassword ?? new Uint8Array(8);
    const uid = `E002${position.toString(16).padStart(12, '0')}`.toUpperCase();
    const tag = new SimulatedTag(uid, stored);

    if (this.faultAt(position) === 'wrong-password') {
      // The tag holds a different password from the one the operator will present.
      tag.passwords.set(DEFAULT_AREA_PASSWORD_NUMBER, Uint8Array.from([9, 9, 9, 9, 9, 9, 9, 9]));
    }

    if (this.#options.preloadBlank !== true) {
      tag.memory.set(buildCapabilityContainer(), 0);
      const preload = this.#options.preloadUri ?? null;
      if (preload !== null) {
        const tlv = wrapNdefTlv(encodeUriRecord(preload).message, T5T_AREA_BYTES);
        tag.memory.set(tlv.bytes, PART.blockSizeBytes);
      } else {
        tag.memory[PART.blockSizeBytes] = 0xfe; // formatted and empty
      }
    }

    this.#tags.set(position, tag);
    return tag;
  }

  /** Read only view of a tag's memory, for assertions in tests. */
  snapshot(position: number): Uint8Array {
    return this.tagAt(position).memory.slice();
  }

  protectionOf(position: number, area: number = DEFAULT_AREA): AreaProtectionState {
    return this.tagAt(position).areas.get(area) ?? { protection: 'none', passwordNumber: DEFAULT_AREA_PASSWORD_NUMBER };
  }

  async open(): Promise<void> {
    this.#opened = true;
  }

  async close(): Promise<void> {
    this.#opened = false;
    this.#current = null;
  }

  private requireOpen(): void {
    if (!this.#opened) {
      throw new ChipError(
        'TRANSPORT_UNAVAILABLE',
        'The simulator was used before it was opened.',
        'This is a bug in the tool. Report it.',
        {},
      );
    }
  }

  private requireTag(): SimulatedTag {
    this.requireOpen();
    if (this.#current === null) {
      throw new ChipError(
        'TAG_ABSENT',
        'No tag is selected.',
        'Place a tag on the reader and try again.',
        { position: this.position },
      );
    }
    return this.#current;
  }

  async waitForTag(_timeoutMs: number): Promise<TagIdentity> {
    this.requireOpen();
    const position = this.position;
    const trayCount = this.#options.trayCount;
    if (trayCount !== undefined && position > trayCount) {
      throw new ChipError(
        'TAG_ABSENT',
        `The simulated tray holds ${trayCount} tags and unit ${position} was requested.`,
        'Increase --sim-tray, or run a smaller batch.',
        { position, trayCount },
      );
    }
    if (this.faultAt(position) === 'tag-absent') {
      throw new ChipError(
        'TAG_ABSENT',
        'No tag arrived in the field before the timeout.',
        'Check the tag is on the reader and centred, then retry this unit.',
        { position },
      );
    }
    const tag = this.tagAt(position);
    tag.presented.clear();
    this.#current = tag;

    if (this.faultAt(position) === 'geometry-mismatch') {
      return { uid: tag.uid, partNumber: 'NTAG216', blockCount: 222, blockSizeBytes: 4 };
    }
    return {
      uid: tag.uid,
      partNumber: PART.partNumber,
      blockCount: PART.blockCount,
      blockSizeBytes: PART.blockSizeBytes,
    };
  }

  private areaFor(_block: number): number {
    // Factory single area layout: area 1 covers the whole memory. This tool does not
    // repartition, so there is nothing else to work out here.
    return DEFAULT_AREA;
  }

  async readBlocks(firstBlock: number, count: number): Promise<Uint8Array> {
    const tag = this.requireTag();
    if (this.faultAt(this.position) === 'readback-fail') {
      throw new ChipError(
        'READBACK_FAILED',
        'The read back failed: the tag stopped responding.',
        'Retry this unit with the tag held still and centred on the reader.',
        { position: this.position },
      );
    }
    if (firstBlock < 0 || count < 1 || firstBlock + count > PART.blockCount) {
      throw new ChipError(
        'READBACK_FAILED',
        `Blocks ${firstBlock} to ${firstBlock + count - 1} are outside the ${PART.blockCount} blocks this part has.`,
        'This is a bug in the tool. Report it.',
        { firstBlock, count, blockCount: PART.blockCount },
      );
    }
    const area = this.areaFor(firstBlock);
    const state = tag.areas.get(area);
    if (state?.protection === 'read_and_write_protected' && !tag.presented.has(state.passwordNumber)) {
      throw new ChipError(
        'READBACK_FAILED',
        `Area ${area} is read protected and its password has not been presented.`,
        'Supply the password for this tag, or set the area back to write protection only.',
        { area },
      );
    }
    const start = firstBlock * PART.blockSizeBytes;
    return tag.memory.slice(start, start + count * PART.blockSizeBytes);
  }

  async writeBlock(block: number, data: Uint8Array): Promise<void> {
    const tag = this.requireTag();
    const fault = this.faultAt(this.position);

    if (data.length !== PART.blockSizeBytes) {
      throw new ChipError(
        'WRITE_FAILED',
        `A block write is exactly ${PART.blockSizeBytes} bytes. Got ${data.length}.`,
        'This is a bug in the tool. Report it.',
        { block, length: data.length },
      );
    }
    if (block < 0 || block >= PART.blockCount) {
      throw new ChipError(
        'WRITE_FAILED',
        `Block ${block} is outside the ${PART.blockCount} blocks this part has.`,
        'This is a bug in the tool. Report it.',
        { block, blockCount: PART.blockCount },
      );
    }

    if (fault === 'write-fail') {
      throw new ChipError(
        'WRITE_FAILED',
        'The tag refused the write.',
        'Retry this unit. If it fails twice, set the tag aside, label it, and move on.',
        { block, position: this.position },
      );
    }
    if (fault === 'write-partial' && tag.blockWrites >= 2) {
      // Two blocks landed, the third does not. The tag now holds a partial image.
      throw new ChipError(
        'WRITE_FAILED',
        'The write failed partway through. Some blocks landed and some did not.',
        'Rewrite this tag from the start. Do not assume the earlier blocks are correct.',
        { block, blocksLanded: tag.blockWrites, position: this.position },
      );
    }

    const area = this.areaFor(block);
    const state = tag.areas.get(area);
    if (
      (state?.protection === 'write_protected' || state?.protection === 'read_and_write_protected') &&
      !tag.presented.has(state.passwordNumber)
    ) {
      throw new ChipError(
        'AREA_PROTECTED',
        `Area ${area} is write protected and its 64 bit password has not been presented.`,
        'This tag is already protected. Supply the password it was protected with, or set the tag aside.',
        { area, block, passwordNumber: state.passwordNumber },
      );
    }

    tag.memory.set(data, block * PART.blockSizeBytes);
    tag.blockWrites += 1;

    if (fault === 'readback-corrupt') {
      // The write is accepted and the memory holds something else. This is the case
      // a "write successful" message cannot detect and read back verification can.
      const target = block * PART.blockSizeBytes;
      const current = tag.memory[target] ?? 0;
      tag.memory[target] = current ^ 0xff;
    }
  }

  async presentPassword(passwordNumber: number, password: Uint8Array): Promise<void> {
    const tag = this.requireTag();
    const stored = tag.passwords.get(passwordNumber);
    if (stored === undefined) {
      throw new ChipError(
        'PASSWORD_REJECTED',
        `Password number ${passwordNumber} does not exist on this part.`,
        'This is a bug in the tool. Report it.',
        { passwordNumber },
      );
    }
    if (!bytesEqual(stored, password)) {
      throw new ChipError(
        'PASSWORD_REJECTED',
        `The tag rejected password number ${passwordNumber}.`,
        'The password supplied is not the one this tag holds. Check the secret store. Do not guess: there is no reset and no recovery service.',
        { passwordNumber },
      );
    }
    tag.presented.add(passwordNumber);
  }

  async writePassword(passwordNumber: number, password: Uint8Array): Promise<void> {
    const tag = this.requireTag();
    if (!tag.presented.has(passwordNumber)) {
      throw new ChipError(
        'PROTECT_FAILED',
        `Password number ${passwordNumber} cannot be changed before the current one has been presented.`,
        'This is a bug in the tool. Report it.',
        { passwordNumber },
      );
    }
    if (password.length !== 8) {
      throw new ChipError(
        'PROTECT_FAILED',
        `A tag password is 8 bytes. Got ${password.length}.`,
        'This is a bug in the tool. Report it.',
        { length: password.length },
      );
    }
    tag.passwords.set(passwordNumber, password.slice());
    // The new value is presented for the rest of this session, as on the part.
    tag.presented.add(passwordNumber);
  }

  async setAreaProtection(area: number, protection: AreaProtection, passwordNumber: number): Promise<void> {
    const tag = this.requireTag();
    if (this.faultAt(this.position) === 'protect-fail') {
      throw new ChipError(
        'PROTECT_FAILED',
        'The tag refused the protection change.',
        'The tag is written and verified but not protected. Set it aside and report it. Do not ship it as protected.',
        { area, position: this.position },
      );
    }
    if (area < 1 || area > MAX_AREAS) {
      throw new ChipError('PROTECT_FAILED', `Area ${area} does not exist on this part.`, 'This is a bug in the tool. Report it.', {
        area,
      });
    }
    if (!tag.presented.has(passwordNumber)) {
      throw new ChipError(
        'PROTECT_FAILED',
        `The password governing area ${area} has not been presented.`,
        'This is a bug in the tool. Report it.',
        { area, passwordNumber },
      );
    }
    tag.areas.set(area, { protection, passwordNumber });
  }

  async readAreaProtection(area: number): Promise<AreaProtectionState> {
    const tag = this.requireTag();
    return tag.areas.get(area) ?? { protection: 'none', passwordNumber: DEFAULT_AREA_PASSWORD_NUMBER };
  }

  /**
   * The model's own refusal is the AREA_PROTECTED it throws for a protected block with
   * no password presented, so that, and only that, is reported as refused. An injected
   * write fault is rethrown, exactly as a write fault on a real reader must not be read
   * as protection. A tag other than the unit's own is refused before anything is written.
   */
  async proveWriteRefused(block: number, data: Uint8Array, expectedUid: string | null): Promise<'refused' | 'accepted'> {
    const tag = this.requireTag();
    if (expectedUid !== null && tag.uid !== expectedUid) {
      throw new ChipError(
        'TAG_CHANGED',
        `The proof write was not sent: this unit's tag is uid ${expectedUid} and the tag in the field is uid ${tag.uid}.`,
        'Set every tag in reach aside and label them. Do not record any of them as protected.',
        { expectedUid, fieldUid: tag.uid },
      );
    }
    try {
      await this.writeBlock(block, data);
      return 'accepted';
    } catch (cause) {
      if (isChipError(cause) && cause.code === 'AREA_PROTECTED') return 'refused';
      throw cause;
    }
  }

  /**
   * Presents the password through the model's own check, then rewrites the block. A wrong
   * password or a refused write rejects. The same UID rule as the refusal proof.
   */
  async proveWriteUnlocked(block: number, data: Uint8Array, passwordNumber: number, password: Uint8Array, expectedUid: string | null): Promise<void> {
    const tag = this.requireTag();
    if (expectedUid !== null && tag.uid !== expectedUid) {
      throw new ChipError(
        'TAG_CHANGED',
        `The unlock proof write was not sent: this unit's tag is uid ${expectedUid} and the tag in the field is uid ${tag.uid}.`,
        'Set every tag in reach aside and label them. Do not record any of them as protected.',
        { expectedUid, fieldUid: tag.uid },
      );
    }
    await this.presentPassword(passwordNumber, password);
    await this.writeBlock(block, data);
  }

  async releaseTag(): Promise<void> {
    if (this.#current !== null) this.#current.presented.clear();
    this.#current = null;
  }

  async completeUnit(): Promise<void> {
    await this.releaseTag();
    this.#cursor += 1;
  }
}
