/**
 * A fake ACR1552U with an ST25TV02KC on it, for driving the PC/SC transport in tests.
 *
 * **This is a model of what the documents say, not of the silicon.** The reader side
 * follows the ACS reference manual, REF-ACR1552U-Series 1.09, section 5.3.5, byte for
 * byte where the manual gives bytes: a failed step answers `90 00` with the failure in a
 * C0 data object, a Transparent Exchange with no Timer object times out because the
 * default wait is "about 302 µs" (5.3.5.4.3), and a successful exchange answers in the
 * shape of 5.3.5.6 step 6. The tag side follows the ST25TV02KC datasheet, DS13304 Rev 7,
 * since Sunday 25 October 2026: GetRandomNumber and cover coded passwords (5.1.3), one
 * security session at a time, closed by a wrong password or by the field dropping
 * (5.1.2, Figure 6), RW_PROTECTION_A1 written under the CONFIG session and enforced only
 * from the next RF boot (Tables 10 and 11, 5.1.4), the error codes of Tables 94, 107 and
 * 155, silence on an error in Non-Addressed mode (6.2.6), and ToggleDiscreetSilent at BAh
 * (6.4.23). It is written from the same document as the tool, so a test passing here
 * proves the tool and this fake agree, and nothing about the part. README section 6.2
 * says why that distinction matters.
 *
 * Since Sunday 25 October 2026 (review findings F1 and F3) the field can hold more than
 * one tag: `neighbours` are further tags in range that hear every transceived frame and
 * execute it unless it is addressed to another UID, exactly as ISO/IEC 15693-3 says a
 * non addressed request is executed by every tag that is not quiet. The PC/SC storage
 * commands (FF CA, FF B0, FF D6) go to the one tag the reader selected. Identical answers
 * from several tags come back as one answer, which is the review's worst case, and
 * differing ones come back with the collision bit set. Manage Session also understands
 * RF Off, Timer and RF On (5.3.5.3.3 to 5.3.5.3.5).
 *
 * Shared by pcsc-binding.test.ts and pcsc-lock.test.ts. Not a test file itself.
 */

import { READER_STATE_FLAGS, type PcscBinding, type PcscCardHandle, type PcscReaderHandle, type PcscReaderState } from '../src/transport/pcsc.js';
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

/**
 * A transceived frame with its address taken out, so a test can read the parameters at
 * the same offsets whether or not the frame was addressed: [02, command, (mfg), params].
 * Returns null for flags this tag does not take.
 */
export function unaddressed(frame: number[]): number[] | null {
  const [flags, cmd = 0] = frame;
  const uidAt = cmd >= 0xa0 && cmd <= 0xdf ? 3 : 2;
  if (flags === 0x02) return frame;
  if (flags === 0x22) return [0x02, ...frame.slice(1, uidAt), ...frame.slice(uidAt + 8)];
  return null;
}

/** The UID an addressed frame carries, as sent (LSB first), or null for a non addressed one. */
export function addressOf(frame: number[]): number[] | null {
  const [flags, cmd = 0] = frame;
  if (flags !== 0x22) return null;
  const uidAt = cmd >= 0xa0 && cmd <= 0xdf ? 3 : 2;
  return frame.slice(uidAt, uidAt + 8);
}

/** True when an APDU carries an ST custom command with this code. */
export const carriesSt = (apdu: string, code: number) => {
  const frame = frameOf(apdu);
  return frame !== null && frame[1] === code && frame[2] === 0x02;
};

/**
 * DS13304 Rev 7, section 4.2: END_MEM is 4Fh on ST25TV02KC, so 80 blocks. Typed in
 * rather than taken from PART, so the fake tag is the datasheet's and a model that
 * drifts from it fails the probe here as it would on silicon.
 */
export const ST25TV02KC_BLOCKS = 0x4f + 1;

/** A tag on a reader, answering per the ACS manual, and recording every APDU. */
export class FakeTag {
  readonly memory: Uint8Array;
  readonly sent: string[] = [];
  /** SCARD_UNPOWER_CARD disconnects. */
  disconnects = 0;
  /** SCARD_LEAVE_CARD disconnects. */
  leaves = 0;
  failTransmit = false;
  uidLsbFirst: number[] = UID_LSB_FIRST;
  /** Replaces the whole answer to Get Data for the UID, status word included, when set. */
  uidAnswer: number[] | null = null;

  /** PWD_A1, most significant byte first. Eight zero bytes is the factory value (Table 19). */
  password = new Uint8Array(8);
  /** PWD_CFG, most significant byte first. Factory "00000000h" (Table 17). */
  configPassword = new Uint8Array(4);
  /** PWD_PRIV, most significant byte first. Factory "00000000h" (Table 23). */
  privPassword = new Uint8Array(4);
  /** RW_PROTECTION_A1 as stored, which ReadConfiguration returns at once (6.4.17). */
  areaProtection = 0;
  /** RW_PROTECTION_A1 as enforced: latched from `areaProtection` at each RF boot (Table 10, "on next RF boot sequence"). */
  activeAreaProtection = 0;
  /** END_A1. END_MEM (4Fh on an 80 block tag) is single area mode (Table 13). Set from the block count in the constructor. */
  endA1: number;
  /** LCK_CONFIG, b15 to b0 (Table 7). */
  lckConfig = 0;
  /** The one open security session (Table 26), or null. */
  session: 'config' | 'area1' | 'priv' | null = null;
  /** RND_NUMBER from the latest GetRandomNumber since boot, or null when none has been issued (5.1.3). */
  rnd: number | null = null;
  /** True after a presentation failed on its Password_data, until the next GetRandomNumber (5.1.3). */
  needsNewRandom = false;
  /** The next RND_NUMBER this tag will hand out. Table 30's example value first. */
  nextRandom = 0x1de6;
  /** True once a ToggleDiscreetSilent succeeded in Addressed mode: the tag then ignores almost everything (6.2.9). */
  discreetOrSilent = false;
  /** RF boots this tag has been through, counting the first. */
  boots = 1;
  /** The ISO 15693 error code this tag gives a write to a protected block (Table 107: 12h). */
  protectedWriteError = 0x12;

  /** True while the AREA1 security session is open. */
  get presented(): boolean {
    return this.session === 'area1';
  }

  /** Further tags in the field. They hear every transceived frame (review finding F1). */
  neighbours: FakeTag[] = [];
  /** Every frame this tag executed, address removed. A neighbour's list must stay free of B1, BA and 21h. */
  readonly executed: number[][] = [];
  /** False models a reader whose SCARD_UNPOWER_CARD leaves the field up, so a presented password survives it (review S4). */
  unpowerDropsField = true;
  /** True models a tag, or a path, on which an addressed frame gets no answer. */
  ignoresAddressed = false;

  /**
   * Replaces the tag's ISO 15693 answer to a frame. Null means the tag stays silent. It
   * sees the frame with the address taken out (see `unaddressed`), and only frames that
   * were addressed to this tag or not addressed at all.
   */
  tagOverride: ((frame: number[]) => number[] | null) | null = null;
  /** Replaces the answer to Switch Protocol, for reader level faults. */
  switchOverride: number[] | null = null;
  /**
   * Replaces the whole Transparent Exchange answer, for reader level faults. Sees the frame
   * with the address taken out, and `normal`, which runs the frame through the field as
   * usual and returns the reader's answer, so an override can let the tag act and then
   * lose or garble the answer. Throwing from it makes the transmit fail.
   */
  exchangeOverride: ((frame: number[], normal: () => number[]) => number[]) | null = null;
  /**
   * Transmits still to fail with SCARD_E_NO_SMARTCARD, counting down: the connect succeeded
   * and the next SCardTransmit found no card. This is what Dan's ACR1552U on Windows 11 did
   * on Monday 26 October 2026, word for word as pcsc-mini reports it (see `noSmartCard`).
   */
  noCardTransmits = 0;
  /** Until this time (Date.now()), every transmit fails with SCARD_E_NO_SMARTCARD: the reader is still bringing the tag up. */
  noCardUntil = 0;
  /** How long the tag stays not ready after SCARD_UNPOWER_CARD, while the reader drops it and polls it up again. 0 is at once. */
  unpowerSettleMs = 0;
  /** Makes every transmit of an APDU (hex) it returns true for fail with SCARD_E_NO_SMARTCARD. */
  noCardOn: ((apdu: string) => boolean) | null = null;
  /** Makes one transmit fail, before it reaches the tag, when it returns true for the APDU (hex). */
  failOn: ((apdu: string) => boolean) | null = null;
  /** Every RND_NUMBER this tag handed out, in order. */
  readonly randomsIssued: number[] = [];

  private inSession = false;
  private switchedTo15693 = false;

  /** `blockCount` is the user memory this tag has. Anything but 80 is another part, or a TruST25 reduced END_MEM (section 5.6). */
  constructor(readonly blockCount: number = ST25TV02KC_BLOCKS) {
    this.memory = new Uint8Array(blockCount * PART.blockSizeBytes);
    this.endA1 = blockCount - 1;
  }

  handle(): PcscCardHandle {
    return {
      transmit: async (apdu) => {
        this.sent.push(hex(apdu));
        if (this.failTransmit) throw new Error('[ RemovedCard ] - Error in native function');
        if (this.noCardTransmits > 0 || Date.now() < this.noCardUntil || this.noCardOn?.(hex(apdu)) === true) {
          if (this.noCardTransmits > 0) this.noCardTransmits -= 1;
          throw noSmartCard();
        }
        if (this.failOn?.(hex(apdu)) === true) throw new Error('[ RemovedCard ] - Error in native function');
        return Uint8Array.from(this.answer(apdu));
      },
      disconnectUnpower: async () => {
        this.disconnects += 1;
        if (this.unpowerSettleMs > 0) this.noCardUntil = Date.now() + this.unpowerSettleMs;
        if (this.unpowerDropsField) {
          this.powerDown();
        } else {
          this.inSession = false;
          this.switchedTo15693 = false;
        }
      },
      disconnectLeave: async () => {
        // SCARD_LEAVE_CARD: the connection ends and the tag stays powered, password session and all.
        this.leaves += 1;
      },
    };
  }

  /** The field drops: a presented password stops applying, on every tag in range, and any session ends. */
  powerDown(): void {
    this.rfOff();
    this.inSession = false;
  }

  /** RF off: every tag in range powers down and boots again when the field returns, and the protocol must be switched again. */
  private rfOff(): void {
    for (const tag of [this, ...this.neighbours]) tag.boot();
    this.switchedTo15693 = false;
  }

  /**
   * The tag's boot sequence: "All security sessions closed" (Figure 6), no random number
   * fetched yet (5.1.3), and the stored RW_PROTECTION_A1 becomes the enforced one.
   */
  boot(): void {
    this.session = null;
    this.rnd = null;
    this.needsNewRandom = false;
    this.activeAreaProtection = this.areaProtection;
    this.boots += 1;
  }

  /** Table 11 and 5.1.4, block 00h included for write. */
  private writeProtected(block: number): boolean {
    const bits = this.activeAreaProtection & 0x03;
    if (bits === 0x03) return true;
    return bits !== 0x00 && this.session !== 'area1';
  }

  /** Table 11: 10b and 11b protect reads of AREA1 except block 00h. */
  private readProtected(block: number): boolean {
    const bits = this.activeAreaProtection & 0x03;
    return block >= 1 && (bits === 0x02 || bits === 0x03) && this.session !== 'area1';
  }

  private answer(apdu: Uint8Array): number[] {
    const [cla, ins, p1 = 0, p2 = 0, lc = 0] = apdu;
    if (cla !== 0xff) return [0x6e, 0x00];
    const block = (p1 << 8) | p2;
    if (ins === 0xca) return this.uidAnswer ?? [...this.uidLsbFirst, ...OK];
    if (ins === 0xb0) {
      const count = (lc === 0 ? 256 : lc) / PART.blockSizeBytes;
      if (block + count > this.blockCount) return [0x6a, 0x82];
      for (let b = block; b < block + count; b += 1) if (this.readProtected(b)) return [0x63, 0x00];
      return [...this.memory.subarray(block * 4, (block + count) * 4), ...OK];
    }
    if (ins === 0xd6) {
      if (block >= this.blockCount) return [0x6a, 0x82];
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
      // 5.3.5.3 Cmd TLVs: 81 00, 82 00, 83 00, 84 00, and 5F 46 04 [TIME] in 1000 to 4294967000 µs.
      let i = 0;
      let n = 0;
      while (i < data.length) {
        n += 1;
        const tag = data[i] === 0x5f ? 0x5f00 | (data[i + 1] ?? 0) : (data[i] ?? 0);
        i += tag > 0xff ? 2 : 1;
        const len = data[i++] ?? -1;
        const value = data.slice(i, i + len);
        i += len;
        if (value.length !== len || i > data.length) return [0xc0, 0x03, n, 0x67, 0x00, ...OK];
        if (tag === 0x81 && len === 0) this.inSession = true;
        else if (tag === 0x82 && len === 0) {
          this.inSession = false;
          this.switchedTo15693 = false;
        } else if (tag === 0x83 && len === 0) this.rfOff();
        else if (tag === 0x84 && len === 0) this.rfOns += 1;
        else if (tag === 0x5f46 && len === 4) {
          const us = (value[0] ?? 0) | ((value[1] ?? 0) << 8) | ((value[2] ?? 0) << 16) | ((value[3] ?? 0) * 0x1000000);
          if (us < 1000) return [0xc0, 0x03, n, 0x6a, 0x80, ...OK];
        } else return [0xc0, 0x03, n, 0x6a, 0x81, ...OK];
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
      const normal = () => this.exchange(data, frame);
      if (this.exchangeOverride) return this.exchangeOverride(unaddressed(frame) ?? frame, normal);
      return normal();
    }
    return [0x6a, 0x81];
  }

  /** A Transparent Exchange as the reader and the tags in the field answer it. */
  private exchange(data: number[], frame: number[]): number[] {
    {
      if (!this.inSession || !this.switchedTo15693) return [...C0_NO_RESPONSE_FROM_TAG, ...OK];
      // 5.3.5.4.3: with no Timer object and no FWTI the reader waits "about 302 µs",
      // which is less than an ISO 15693 tag takes to start answering.
      const hasTimer = data[0] === 0x5f && data[1] === 0x46 && data[2] === 0x04;
      const timerUs = hasTimer ? (data[3] ?? 0) | ((data[4] ?? 0) << 8) | ((data[5] ?? 0) << 16) | ((data[6] ?? 0) << 24) : 302;
      if (timerUs < 20_000) return [...C0_NO_RESPONSE_FROM_TAG, ...OK];
      const answers = [this, ...this.neighbours].map((t) => t.respond(frame)).filter((a): a is number[] => a !== null);
      if (answers.length === 0) return [...C0_NO_RESPONSE_FROM_TAG, ...OK];
      const first = answers[0]!;
      if (answers.every((a) => hex(Uint8Array.from(a)) === hex(Uint8Array.from(first)))) return exchangeAnswer(first);
      // Different answers at once: the reader sees a collision (5.3.5.4.7, bit 1).
      return [...C0_OK, 0x92, 0x01, 0x00, 0x96, 0x02, 0x02, 0x00, 0x97, first.length, ...first, ...OK];
    }
  }

  /** RF On objects seen, so a test can tell the field was cycled. */
  rfOns = 0;

  /**
   * One tag hearing one frame. A frame addressed to another UID is ignored (6.2.7: "Otherwise
   * the device remains silent"). A non addressed frame is executed, and an error in it is
   * not answered (6.2.6).
   */
  respond(frame: number[]): number[] | null {
    const address = addressOf(frame);
    const addressed = address !== null;
    if (addressed) {
      if (this.ignoresAddressed) return null;
      if (hex(Uint8Array.from(address)) !== hex(Uint8Array.from(this.uidLsbFirst))) return null;
    }
    const body = unaddressed(frame);
    if (body === null) return addressed ? [0x01, 0x03] : null;
    if (this.discreetOrSilent) return null;
    this.executed.push(body);
    const answer = this.tagOverride ? this.tagOverride(body) : this.datasheetAnswer(body, addressed);
    if (answer !== null && answer[0] === 0x01 && !addressed) return null;
    return answer;
  }

  /** Table 27: PWD_A1 is 8 bytes in single area mode, 4 in dual. PWD_A2 is invalid in single area mode. */
  private passwordFor(id: number): { bytes: number; value: () => Uint8Array; set: (v: Uint8Array) => void; session: 'config' | 'area1' | 'priv' } | null {
    if (id === 0x00) return { bytes: 4, value: () => this.configPassword, set: (v) => (this.configPassword = Uint8Array.from(v)), session: 'config' };
    if (id === 0x01) {
      const bytes = this.endA1 === this.blockCount - 1 ? 8 : 4;
      return { bytes, value: () => this.password.subarray(8 - bytes), set: (v) => this.password.set(v, 8 - bytes), session: 'area1' };
    }
    if (id === 0x03) return { bytes: 4, value: () => this.privPassword, set: (v) => (this.privPassword = Uint8Array.from(v)), session: 'priv' };
    return null;
  }

  /** 5.1.3: undoes the cover coding of a Password_data field sent LSB first, giving the plain value MSB first. */
  private decode(data: number[], rnd: number): Uint8Array {
    return Uint8Array.from(data.map((b, i) => b ^ (i % 2 === 0 ? rnd & 0xff : rnd >>> 8)).reverse());
  }

  /** Every configuration register this fake knows (Table 4). */
  private readonly registers: Record<string, { get: () => number[]; set?: (v: number[]) => number | null; lckConfigFid: number }> = {
    '0,0': { get: () => [this.areaProtection], set: (v) => ((this.areaProtection = v[0] ?? 0), null), lckConfigFid: 0 },
    '0,1': { get: () => [this.endA1], set: (v) => ((this.lckConfig & 0x03) !== 0 ? 0x12 : ((this.endA1 = v[0] ?? 0), null)), lckConfigFid: -1 },
    '1,0': { get: () => [0x00], set: () => null, lckConfigFid: 1 },
    '255,0': { get: () => [this.lckConfig & 0xff, this.lckConfig >>> 8], set: (v) => ((this.lckConfig |= (v[0] ?? 0) | ((v[1] ?? 0) << 8)), null), lckConfigFid: -1 },
  };

  /** The ST25TV02KC as DS13304 Rev 7 describes it. Receives the frame with the address taken out. */
  datasheetAnswer(frame: number[], addressed = true): number[] | null {
    const [flags, cmd, mfg, ...params] = frame;
    if (flags !== 0x02) return [0x01, 0x03];
    if (cmd === 0x21) {
      // Table 105: block number, then four bytes. Table 107 for the errors.
      const block = mfg ?? 0;
      if (params.length !== 4) return [0x01, 0x02];
      if (block >= this.blockCount) return [0x01, 0x10];
      if (this.writeProtected(block)) return [0x01, this.protectedWriteError];
      this.memory.set(params, block * 4);
      return [0x00];
    }
    if (cmd === undefined || cmd < 0xa0 || cmd > 0xdf) return [0x01, 0x02];
    if (mfg !== 0x02) return [0x01, 0x01];

    if (cmd === 0xb4) {
      // Table 166 and 167: no parameters, answer 00h then RND_NUMBER LSB first.
      if (params.length !== 0) return [0x01, 0x02];
      const rnd = this.nextRandom;
      this.nextRandom = (rnd * 75 + 74) & 0xffff;
      this.randomsIssued.push(rnd);
      this.rnd = rnd;
      this.needsNewRandom = false;
      return [0x00, rnd & 0xff, rnd >>> 8];
    }
    if (cmd === 0xb3 || cmd === 0xba) {
      // PresentPassword (Tables 153 and 155) and ToggleDiscreetSilent (Tables 163 and 165).
      const [id = -1, ...data] = params;
      if (cmd === 0xba && !addressed) return null;
      if (cmd === 0xba && id !== 0x03) return [0x01, 0x10];
      const pwd = this.passwordFor(id);
      if (pwd === null) return [0x01, 0x10];
      if (data.length !== pwd.bytes) return [0x01, 0x02];
      if (this.rnd === null || this.needsNewRandom) {
        this.session = null;
        return [0x01, 0x0f];
      }
      const ok = hex(this.decode(data, this.rnd)) === hex(pwd.value());
      if (!ok) {
        // "All security sessions are closed if an invalid value of Password_data is presented."
        this.session = null;
        this.needsNewRandom = true;
        return [0x01, 0x0f];
      }
      if (cmd === 0xba) {
        this.discreetOrSilent = true;
        return [0x00];
      }
      this.session = pwd.session;
      return [0x00];
    }
    if (cmd === 0xb1) {
      // Table 150 and 152: needs the session of that password, value cover coded.
      const [id = -1, ...data] = params;
      const pwd = this.passwordFor(id);
      if (pwd === null) return [0x01, 0x10];
      if (data.length !== pwd.bytes) return [0x01, 0x02];
      if (this.session !== pwd.session || this.rnd === null) return [0x01, 0x12];
      pwd.set(this.decode(data, this.rnd));
      return [0x00];
    }
    if (cmd === 0xa0 || cmd === 0xa1) {
      // Tables 144 to 149.
      const [fid = -1, pid = -1, ...value] = params;
      const reg = this.registers[`${fid},${pid}`];
      if (reg === undefined) return [0x01, 0x10];
      if (cmd === 0xa0) return params.length === 2 ? [0x00, ...reg.get()] : [0x01, 0x02];
      if (value.length !== reg.get().length || reg.set === undefined) return [0x01, 0x02];
      if (this.session !== 'config') return [0x01, 0x12];
      if (reg.lckConfigFid >= 0 && (this.lckConfig & (1 << reg.lckConfigFid)) !== 0) return [0x01, 0x12];
      const error = reg.set(value);
      return error === null ? [0x00] : [0x01, error];
    }
    return [0x01, 0x01];
  }
}

const { PRESENT, EMPTY, CHANGED } = READER_STATE_FLAGS;

/** Shaped like a pcsc-mini error: the PC/SC name in `code`, nothing useful in `message`. */
export function pcscError(code: string): Error {
  return Object.assign(new Error('[ Client.TaskConnect ] Async task error'), { code });
}

/**
 * SCARD_E_NO_SMARTCARD from SCardTransmit, shaped exactly as pcsc-mini 0.1.3 raised it on
 * Dan's machine: "NoSmartCard" in `code`, "[ Session.TaskTransmit ] Async task error" in
 * `message`. The transport's own words around it make the line he sent.
 */
export function noSmartCard(): Error {
  return Object.assign(new Error('[ Session.TaskTransmit ] Async task error'), { code: 'NoSmartCard' });
}

export class FakeReader implements PcscReaderHandle {
  /** The raw SCARD_STATE_* flags the fake service reports. */
  raw: number;
  gone = false;
  connects = 0;
  /** When set, connect fails with it. A function can also change the state, as a real reader would. */
  connectError: (() => Error) | null = null;
  constructor(
    readonly name: string,
    public tag: FakeTag = new FakeTag(),
    present = true,
  ) {
    this.raw = present ? PRESENT | CHANGED : EMPTY | CHANGED;
  }
  set present(value: boolean) {
    this.raw = value ? PRESENT | CHANGED : EMPTY | CHANGED;
  }
  state(): PcscReaderState {
    return { raw: this.raw, gone: this.gone };
  }
  /** Called on every connect, before the handle is made, so a test can put another tag in its place. */
  onConnect: ((count: number) => void) | null = null;
  /** How long a connect takes. 0 answers at once; a real SCardConnect powers the tag up first. */
  connectDelayMs = 0;
  async connect(): Promise<PcscCardHandle> {
    if (this.connectDelayMs > 0) await new Promise((r) => setTimeout(r, this.connectDelayMs));
    this.connects += 1;
    this.onConnect?.(this.connects);
    if (this.connectError) throw this.connectError();
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
