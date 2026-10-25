/**
 * A fake ACR1552U with an ST25TV02KC on it, for driving the PC/SC transport in tests.
 *
 * **This is a model of what the documents say, not of the silicon.** The reader side
 * follows the ACS reference manual, REF-ACR1552U-Series 1.09, section 5.3.5, byte for
 * byte where the manual gives bytes: a failed step answers `90 00` with the failure in a
 * C0 data object, a Transparent Exchange with no Timer object times out because the
 * default wait is "about 302 µs" (5.3.5.4.3), and a successful exchange answers in the
 * shape of 5.3.5.6 step 6. The tag side uses the secondary sourced ST opcodes the tool
 * itself uses, so a test passing here proves the tool and this fake agree, and nothing
 * about the part. README section 6.2 says why that distinction matters.
 *
 * Shared by pcsc-binding.test.ts and pcsc-lock.test.ts. Not a test file itself.
 */

import type { PcscBinding, PcscCardHandle, PcscReaderHandle } from '../src/transport/pcsc.js';
import { PART } from '../src/chip/st25tv02kc.js';

export const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join(' ');
export const OK = [0x90, 0x00];
export const C0_OK = [0xc0, 0x03, 0x00, 0x90, 0x00];
/** 5.3.5.2: "XX 64 01h Data Object XX execution error (no response from ICC)". */
export const C0_NO_RESPONSE_FROM_TAG = [0xc0, 0x03, 0x01, 0x64, 0x01];
export const UID_LSB_FIRST = [0x66, 0x55, 0x44, 0x33, 0x22, 0x11, 0x02, 0xe0];
export const OTHER_UID_LSB_FIRST = [0x99, 0x88, 0x77, 0x33, 0x22, 0x11, 0x02, 0xe0];

/** Wraps a tag's ISO 15693 answer the way 5.3.5.6 step 6 shows a successful exchange. */
export function exchangeAnswer(tagBytes: number[]): number[] {
  return [...C0_OK, 0x92, 0x01, 0x00, 0x96, 0x02, 0x00, 0x00, 0x97, tagBytes.length, ...tagBytes, ...OK];
}

/** The ISO 15693 frame inside a Transparent Exchange APDU (hex string), or null if it is not one. */
export function frameOf(apdu: string): number[] | null {
  const bytes = apdu.split(' ').map((b) => parseInt(b, 16));
  if (bytes[0] !== 0xff || bytes[1] !== 0xc2 || bytes[2] !== 0x00 || bytes[3] !== 0x01) return null;
  let i = 5;
  const end = 5 + (bytes[4] ?? 0);
  while (i < end) {
    let tag = bytes[i++] ?? 0;
    if ((tag & 0x1f) === 0x1f) tag = tag * 256 + (bytes[i++] ?? 0);
    const len = bytes[i++] ?? 0;
    if (tag === 0x95) return bytes.slice(i, i + len);
    i += len;
  }
  return null;
}

/** True when an APDU carries an ST custom command with this code. */
export const carriesSt = (apdu: string, code: number) => {
  const frame = frameOf(apdu);
  return frame !== null && frame[1] === code && frame[2] === 0x02;
};

/** A tag on a reader, answering per the ACS manual, and recording every APDU. */
export class FakeTag {
  readonly memory = new Uint8Array(PART.totalBytes);
  readonly sent: string[] = [];
  disconnects = 0;
  failTransmit = false;
  uidLsbFirst: number[] = UID_LSB_FIRST;

  /** Password 1. Eight zero bytes is the factory default. */
  password = new Uint8Array(8);
  presented = false;
  /** Area 1 protection byte as the 0xBA set form wrote it, or 0 for none. */
  areaProtection = 0;
  /** The ISO 15693 error code this tag gives a write to a protected block. */
  protectedWriteError = 0x12;

  /** Replaces the tag's ISO 15693 answer to a frame. Null means the tag stays silent. */
  tagOverride: ((frame: number[]) => number[] | null) | null = null;
  /** Replaces the answer to Switch Protocol, for reader level faults. */
  switchOverride: number[] | null = null;
  /** Replaces the whole Transparent Exchange answer, for reader level faults. */
  exchangeOverride: ((frame: number[]) => number[]) | null = null;

  private inSession = false;
  private switchedTo15693 = false;

  handle(): PcscCardHandle {
    return {
      transmit: async (apdu) => {
        this.sent.push(hex(apdu));
        if (this.failTransmit) throw new Error('[ RemovedCard ] - Error in native function');
        return Uint8Array.from(this.answer(apdu));
      },
      disconnectUnpower: async () => {
        this.disconnects += 1;
        this.powerDown();
      },
    };
  }

  /** The field drops: a presented password stops applying and any session ends. */
  powerDown(): void {
    this.presented = false;
    this.inSession = false;
    this.switchedTo15693 = false;
  }

  private writeProtected(block: number): boolean {
    return block >= 1 && (this.areaProtection & 0x03) !== 0 && !this.presented;
  }

  private answer(apdu: Uint8Array): number[] {
    const [cla, ins, p1 = 0, p2 = 0, lc = 0] = apdu;
    if (cla !== 0xff) return [0x6e, 0x00];
    const block = (p1 << 8) | p2;
    if (ins === 0xca) return [...this.uidLsbFirst, ...OK];
    if (ins === 0xb0) {
      const count = (lc === 0 ? 256 : lc) / PART.blockSizeBytes;
      if (block + count > PART.blockCount) return [0x6a, 0x82];
      return [...this.memory.subarray(block * 4, (block + count) * 4), ...OK];
    }
    if (ins === 0xd6) {
      if (block >= PART.blockCount) return [0x6a, 0x82];
      // 5.3.3.5 gives Update Binary one error row, "6X XXh Fail", whatever the cause.
      if (this.writeProtected(block)) return [0x63, 0x00];
      this.memory.set(apdu.subarray(5, 5 + lc), block * 4);
      return OK;
    }
    if (ins === 0xc2) return this.pcsc2(p2, apdu);
    return [0x6d, 0x00];
  }

  private pcsc2(fn: number, apdu: Uint8Array): number[] {
    const lc = apdu[4] ?? 0;
    const data = Array.from(apdu.subarray(5, 5 + lc));
    const le = apdu.length === 5 + lc + 1 ? apdu[5 + lc] : undefined;

    if (fn === 0x00) {
      if (data[0] === 0x81) this.inSession = true;
      if (data[0] === 0x82) {
        this.inSession = false;
        this.switchedTo15693 = false;
      }
      return [...C0_OK, ...OK];
    }
    if (fn === 0x02) {
      // 5.3.5.5.1: 8F 02 [RF] [Layer]. RF 02h is ISO 15693, and the tag is only that.
      if (le !== 0x00) return [0x67, 0x00];
      if (this.switchOverride) return this.switchOverride;
      if (data[0] === 0x8f && data[1] === 0x02 && data[2] === 0x02 && data[3] === 0x03) {
        this.switchedTo15693 = this.inSession;
        return this.inSession ? [...C0_OK, ...OK] : [0xc0, 0x03, 0x01, 0x6a, 0x80, ...OK];
      }
      // Anything else, ISO 14443A included, finds no card: the manual's own example answer.
      return [0xc0, 0x03, 0x01, 0x64, 0x01, ...OK];
    }
    if (fn === 0x01) {
      if (le !== 0x00) return [0x67, 0x00];
      const frame = frameOf(hex(apdu));
      if (frame === null) return [...C0_OK.slice(0, 2), 0x00, 0x6a, 0x80, ...OK];
      if (this.exchangeOverride) return this.exchangeOverride(frame);
      if (!this.inSession || !this.switchedTo15693) return [...C0_NO_RESPONSE_FROM_TAG, ...OK];
      // 5.3.5.4.3: with no Timer object and no FWTI the reader waits "about 302 µs",
      // which is less than an ISO 15693 tag takes to start answering.
      const hasTimer = data[0] === 0x5f && data[1] === 0x46 && data[2] === 0x04;
      const timerUs = hasTimer ? (data[3] ?? 0) | ((data[4] ?? 0) << 8) | ((data[5] ?? 0) << 16) | ((data[6] ?? 0) << 24) : 302;
      if (timerUs < 20_000) return [...C0_NO_RESPONSE_FROM_TAG, ...OK];
      const tag = this.tagOverride ? this.tagOverride(frame) : this.tagAnswer(frame);
      if (tag === null) return [...C0_NO_RESPONSE_FROM_TAG, ...OK];
      return exchangeAnswer(tag);
    }
    return [0x6a, 0x81];
  }

  /** The ST25TV02KC as the tool's secondary sources describe it. */
  private tagAnswer(frame: number[]): number[] | null {
    const [flags, cmd, mfg, ...params] = frame;
    if (flags !== 0x02) return [0x01, 0x03];
    if (cmd === 0x21) {
      const block = mfg ?? 0;
      if (this.writeProtected(block)) return [0x01, this.protectedWriteError];
      this.memory.set(params.slice(0, 4), block * 4);
      return [0x00];
    }
    if (mfg !== 0x02) return [0x01, 0x02];
    if (cmd === 0xb3) {
      const pw = params.slice(1, 9);
      const ok = params.length === 9 && pw.every((b, i) => b === this.password[i]);
      this.presented = ok;
      return ok ? [0x00] : [0x01, 0x0f];
    }
    if (cmd === 0xb1) {
      if (!this.presented || params.length !== 9) return [0x01, 0x0f];
      this.password = Uint8Array.from(params.slice(1, 9));
      return [0x00];
    }
    if (cmd === 0xba) {
      if (params.length === 1) return [0x00, this.areaProtection];
      if (!this.presented || params.length !== 2) return [0x01, 0x0f];
      this.areaProtection = params[1] ?? 0;
      return [0x00];
    }
    return [0x01, 0x01];
  }
}

export class FakeReader implements PcscReaderHandle {
  present: boolean;
  connects = 0;
  constructor(
    readonly name: string,
    public tag: FakeTag = new FakeTag(),
    present = true,
  ) {
    this.present = present;
  }
  tagPresent(): boolean {
    return this.present;
  }
  async connect(): Promise<PcscCardHandle> {
    this.connects += 1;
    return this.tag.handle();
  }
}

export class FakeBinding implements PcscBinding {
  stops = 0;
  constructor(
    private readonly readers: FakeReader[],
    private readonly startError?: Error,
  ) {}
  start(onReader: (reader: PcscReaderHandle) => void): void {
    if (this.startError) throw this.startError;
    for (const reader of this.readers) onReader(reader);
  }
  stop(): void {
    this.stops += 1;
  }
}

export const ACR1552U = 'ACS ACR1552 1S CL Reader PICC 0';
