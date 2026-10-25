/**
 * The real reader, over PC/SC.
 *
 * Written Thursday 17 September 2026, once the reader stopped being hypothetical:
 * the client holds an **ACR1552U with GoToTags**, which is NFC Forum certified
 * across ISO 14443, **ISO 15693** and ISO 18092. See "Decision log", D46.
 *
 * ---------------------------------------------------------------------------
 * READ THIS BEFORE TRUSTING A SINGLE BYTE BELOW
 * ---------------------------------------------------------------------------
 *
 * **NOTHING IN THIS FILE HAS EVER TALKED TO A CHIP.** It is written against
 * published interface documentation and it is unverified in exactly the way
 * README section 6.2 warns about. The bring up sequence in **section 6.3 is the
 * gate**, and no claim about hardware behaviour may be made to anybody,
 * including by us, until step 3 of it has been done and written down.
 *
 * **What that section 6.2 caution does and does not forbid.** It forbids copying
 * opcodes out of a datasheet into code that has never run and then treating them
 * as fact. It does not forbid writing the transport at all, because without one
 * the M4 acceptance criterion, "a member of Trevean staff encodes one unaided",
 * cannot be attempted by anybody. So this file is split along exactly that line:
 *
 *   - **Implemented, from documented standard PC/SC commands.** Tag detection,
 *     UID, block reads and block writes. **This is the whole encode and verify
 *     path, and therefore the whole acceptance criterion.**
 *
 *   - **Implemented, and gated on the tag.** Passwords and area protection. Those
 *     need ST custom commands carried inside the ACS transparent session, whose bytes
 *     are checked against the ACR1552U reference manual (see the session constants
 *     below), while the ST opcodes themselves are secondary sourced. A wrong
 *     protection opcode is the worst possible thing to be wrong about: applied to a
 *     real tag it is not reversible without the very password the command was
 *     supposed to set. **So Write Password, Set Memory Protection and the 0xBA read
 *     form send nothing unless `verifyOpcodes` has passed on the tag in the field
 *     now.** README sections 6.4 and 6.5.
 *
 * `--protect` runs that probe itself, immediately before the first irreversible
 * command. None of the protection path has run on silicon. `PROTECTION_BRING_UP` at
 * the bottom of this file was written before it existed and is kept as the checklist.
 */

import {
  PART,
  type AreaProtection,
} from '../chip/st25tv02kc.js';
import { ChipError } from '../chip/errors.js';
import {
  ST_COMMANDS,
  stRequest,
  assertPasswordLength,
  FACTORY_DEFAULT_PASSWORD,
  DELIBERATELY_WRONG_PASSWORD,
  FLAG_HIGH_DATA_RATE,
  type StCommand,
} from '../chip/st-custom.js';
import type { AreaProtectionState, TagIdentity, TagTransport } from './transport.js';

/**
 * The PC/SC binding is an OPTIONAL dependency and is loaded lazily.
 *
 * It is a native module. Making it a hard dependency would mean `npm install`
 * needs a compiler or a matching prebuild on a machine whose only job might be
 * running the simulator and the tests, and a tool that cannot be installed is
 * worse than one that cannot reach a reader. So the simulator path never touches
 * this, and the failure when it is missing is a sentence telling the operator
 * what to install rather than a stack trace at import time.
 *
 * **The binding is `pcsc-mini`, pinned exactly, since Sunday 25 October 2026.** It
 * replaced `@pokusew/pcsclite`, which was pinned at a version that does not exist
 * (so npm skipped it without a word) and which, at its real version 0.6.0, compiles
 * from C++ on install, needing Python and a C++ toolchain on the operator's machine.
 * On Windows its constructor also asks for administrator rights to reconfigure the
 * Smart Card service, and with no PC/SC service running it spins on the main thread
 * forever, so the ten second reader timeout below could never fire. `pcsc-mini` ships
 * prebuilt binaries for Windows x64 and macOS arm64 and x64, links only the operating
 * system's own PC/SC library (WinSCard.dll, PCSC.framework), runs no install script,
 * and fails in milliseconds with `NoService` instead of hanging. See SETUP-WINDOWS-MAC.md.
 *
 * Everything the transport needs from a binding is the three small interfaces below,
 * so the tests can drive the whole transport, gate included, with a fake reader.
 */
export interface PcscCardHandle {
  /** Sends one APDU and resolves with the full response, status word included. */
  transmit(apdu: Uint8Array): Promise<Uint8Array>;
  /** Ends the connection and powers the tag down. */
  disconnectUnpower(): Promise<void>;
}

export interface PcscReaderHandle {
  readonly name: string;
  /** The latest state the PC/SC service reported: a tag is in the field and answering. */
  tagPresent(): boolean;
  connect(): Promise<PcscCardHandle>;
}

export interface PcscBinding {
  /**
   * Starts watching for readers. `onReader` is called once for every reader, including
   * the ones already attached. Throws when the PC/SC service cannot be reached at all.
   */
  start(onReader: (reader: PcscReaderHandle) => void, onError: (err: Error) => void): void;
  /** Stops watching and releases the PC/SC context, so the process can exit. */
  stop(): void;
}

export type PcscBindingLoader = () => Promise<PcscBinding>;

/** The part of the `pcsc-mini` module this file uses, typed here so it need not be installed to compile. */
type PcscMiniStatus = { readonly raw: number };
type PcscMiniCard = {
  transmit(input: Uint8Array): Promise<Uint8Array>;
  disconnect(then: number): Promise<void>;
};
type PcscMiniReader = {
  name(): string;
  on(event: 'change', cb: (status: PcscMiniStatus) => void): unknown;
  on(event: 'disconnect', cb: () => void): unknown;
  connect(mode: number): Promise<PcscMiniCard>;
};
type PcscMiniClient = {
  on(event: 'reader', cb: (reader: PcscMiniReader) => void): unknown;
  on(event: 'error', cb: (err: Error) => void): unknown;
  start(): unknown;
  stop(): void;
};
export type PcscMiniModule = {
  Client: new () => PcscMiniClient;
  CardMode: { readonly SHARED: number };
  CardDisposition: { readonly UNPOWER: number };
  ReaderStatus: { readonly PRESENT: number; readonly MUTE: number };
};

/**
 * Adapts `pcsc-mini` to the three interfaces above. Exported for the tests, which feed
 * it a fake module of the same shape.
 *
 * Presence is tracked from the moment a reader is announced, because `pcsc-mini`
 * reports a reader's state on change only. A listener attached later, when a unit
 * starts, would never hear about a tag that was already lying on the reader.
 */
export function adaptPcscMini(lib: PcscMiniModule): PcscBinding {
  const client = new lib.Client();
  return {
    start(onReader, onError) {
      client.on('error', onError);
      client.on('reader', (reader) => {
        let status = 0;
        let gone = false;
        reader.on('change', (next) => {
          status = next.raw;
        });
        reader.on('disconnect', () => {
          gone = true;
          status = 0;
        });
        onReader({
          name: reader.name(),
          tagPresent: () => !gone && (status & lib.ReaderStatus.PRESENT) !== 0 && (status & lib.ReaderStatus.MUTE) === 0,
          async connect() {
            const card = await reader.connect(lib.CardMode.SHARED);
            return {
              transmit: (apdu) => card.transmit(apdu),
              disconnectUnpower: () => card.disconnect(lib.CardDisposition.UNPOWER),
            };
          },
        });
      });
      client.start();
    },
    stop() {
      client.stop();
    },
  };
}

/** The version in package.json, repeated here so the install remedy names it exactly. */
export const PCSC_BINDING_PACKAGE = 'pcsc-mini@0.1.3';

async function loadPcscMini(): Promise<PcscBinding> {
  // Deliberately dynamic. A static import would make the native module a hard
  // requirement of every code path, including the simulator and the test suite.
  // The specifier is held in a variable on purpose. It keeps TypeScript from
  // resolving an OPTIONAL native module at compile time, so `npm run typecheck`
  // passes on a machine that has never installed it, which is every machine that
  // only runs the simulator.
  const specifier = 'pcsc-mini';
  const mod = (await import(specifier)) as { default?: PcscMiniModule } & Partial<PcscMiniModule>;
  return adaptPcscMini((mod.default ?? mod) as PcscMiniModule);
}

/**
 * True for the SAM slot interface some ACS readers expose beside the contactless one.
 * A SAM slot can never hold an NFC tag, so with no --reader-name it is passed over
 * rather than picked because it happened to be announced first.
 */
export function isSamSlot(readerName: string): boolean {
  return /\bSAM\b/i.test(readerName);
}

export interface PcscTransportOptions {
  /** For tests. Defaults to loading `pcsc-mini`. */
  readonly loadBinding?: PcscBindingLoader;
  /** How long `open` waits for a reader. Ten seconds unless a test says otherwise. */
  readonly readerTimeoutMs?: number;
}

/**
 * STANDARD PC/SC CONTACTLESS STORAGE CARD COMMANDS.
 *
 * These are the PC/SC part 3 commands every compliant reader implements for a
 * storage card, and an ISO 15693 tag is presented as one. **They are not ACS
 * specific and they are not ST specific**, which is why they are the only
 * commands this file is willing to send unverified.
 *
 * `FF CA 00 00 00` is confirmed present in the ACS API documentation, where the
 * same command is used to read a FeliCa IDM. The Read Binary and Update Binary
 * forms are PC/SC part 3 and are how ACS documents storage card access.
 */
const CLA_PCSC = 0xff;
const INS_GET_DATA = 0xca;
const INS_READ_BINARY = 0xb0;
const INS_UPDATE_BINARY = 0xd6;

/** Status words. 0x9000 is success; everything else is the card or reader saying no. */
const SW_OK = 0x9000;

/**
 * ISO/IEC 15693-3: every UID is 64 bits, the most significant byte is always
 * 0xE0, and the byte below it is the IC manufacturer code. **0x02 is
 * STMicroelectronics.** This is the one identity check available without vendor
 * commands, and it is a real one: it will reject an NTAG, an ICODE or any other
 * maker's Type 5 tag before a single byte is written to it.
 */
const ISO15693_UID_PREFIX = 0xe0;
const IC_MFG_STMICROELECTRONICS = 0x02;

/**
 * ACS transparent session pseudo APDUs, used to carry a raw ISO 15693 frame.
 *
 * A standard PC/SC Read Binary cannot express an ST custom command, so the reader has
 * to be put into a mode where it forwards bytes verbatim. On ACS readers that is the
 * transparent session, and these are its APDUs.
 *
 * **Checked byte for byte on Sunday 25 October 2026 against the ACS reference manual,
 * REF-ACR1552U-Series version 1.09, section 5.3.5 "APDU Commands for PC/SC 2.0 Part 3".**
 * The section numbers below are that manual's. Being in the manual is not the same as
 * having run on the client's reader, so **nothing irreversible is sent through them
 * until the probe in `verifyOpcodes` has shown the whole path behaves as predicted.**
 *
 * The earlier Switch Protocol bytes, `8F 02 00 03`, selected ISO 14443A layer 3 and
 * not ISO 15693. The gate made that fail safe. It is recorded here so nobody restores it.
 */

/**
 * 5.3.5.3 Manage Session, Start Session data object `81 00` (5.3.5.3.1). Byte for byte
 * the manual's own example, 5.3.5.6 step 1: "FF C2 00 00 02 81 00". The Le column of
 * 5.3.5.3 reads "--/00h", so Le is optional, and it is left out exactly as the example
 * leaves it out. Either way the answer can be `90 00` with a failure inside a C0 data
 * object, so the C0 object is checked, not only the status word.
 */
export const ACS_SESSION_START = Uint8Array.from([0xff, 0xc2, 0x00, 0x00, 0x02, 0x81, 0x00]);
/** 5.3.5.3.2 End Session data object `82 00`. Byte for byte 5.3.5.6 step 7: "FF C2 00 00 02 82 00". */
export const ACS_SESSION_END = Uint8Array.from([0xff, 0xc2, 0x00, 0x00, 0x02, 0x82, 0x00]);
/**
 * 5.3.5.5 Switch Protocol: "FFh C2h 00h 02h [Cmd Data Length] [Cmd TLV] 00h". Le is
 * listed as 00h, so it is sent. The data object is `8F 02 [RF] [Layer]` (5.3.5.5.1),
 * where RF "02h: ISO15693" (00h is ISO14443A) and Layer "03h: Switch or activate to
 * layer 3". The example in 5.3.5.6 step 4 shows a failed switch answering
 * `C0 03 01 64 01 90 00`: status word 90 00 with the failure in the C0 object.
 */
export const ACS_SWITCH_ISO15693 = Uint8Array.from([0xff, 0xc2, 0x00, 0x02, 0x04, 0x8f, 0x02, 0x02, 0x03, 0x00]);

/**
 * How long the reader waits for the tag's answer to one transceived frame, in
 * microseconds.
 *
 * 5.3.5.4.3: "If no timer data object was defined in the data field, the reader will
 * wait for the duration given in the Set Parameter FWTI Data Object. If no FWTI is set,
 * the reader will wait for about 302 µs." An ISO 15693 tag does not even begin to answer
 * until about 320 µs after the request (t1 in ISO/IEC 15693-3), and Write Password and
 * Set Memory Protection program EEPROM before they answer. So every exchange carries
 * its own Timer data object. **50 ms is deliberately generous**: ISO/IEC 15693-3 lets a
 * write-alike command answer up to 20 ms after the request (quoted from the standard as
 * commonly cited, not from a copy in hand), and the ST25TV02KC programming time is not
 * in hand either. A timeout that is too short is the dangerous direction, because an
 * irreversible command that took effect would then be reported as failed. 5.3.5.4 says
 * the actual timeout rounds up to the nearest 302.07 x 2^n µs, which here is 77.3 ms.
 */
export const TRANSCEIVE_TIMEOUT_US = 50_000;

/**
 * Wraps a raw ISO 15693 frame in the ACS Transparent Exchange pseudo APDU.
 *
 * 5.3.5.4: "FFh C2h 00h 01h [Cmd Data Length] [Cmd TLV] 00h", Le listed as 00h. Cmd TLVs,
 * in this order: Timer "5F 46 04h [TIME]: 4 byte value (LSB first) in range 1 us to
 * 4294967000 us", then Transceive "95h [Size] [Data]". The order matches the manual's
 * example in 5.3.5.6 step 6, "FF C2 00 01 0E 5F 46 04 40 42 0F 00 95 05 ...". No
 * Transceive Flag object is sent, so "current protocol value is used" for CRC handling,
 * which after the Switch Protocol above is ISO 15693's. No Retry Counter is sent either:
 * an irreversible command is never resent on a timeout.
 *
 * Exported for the tests, which assert the bytes without a reader in the room.
 */
export function transparentExchangeApdu(frame: Uint8Array): Uint8Array {
  // 5.3.5.4.3: a one byte BER-TLV length covers 1 to 127 bytes, and every frame this
  // tool sends is far shorter. Anything else is a caller bug, refused before the wire.
  if (frame.length < 1 || frame.length > 0x7f) {
    throw new Error(`A transceived ISO 15693 frame must be 1 to 127 bytes. This one is ${frame.length}.`);
  }
  const us = TRANSCEIVE_TIMEOUT_US;
  const timer = [0x5f, 0x46, 0x04, us & 0xff, (us >>> 8) & 0xff, (us >>> 16) & 0xff, (us >>> 24) & 0xff];
  const tlvs = [...timer, 0x95, frame.length, ...frame];
  return Uint8Array.from([0xff, 0xc2, 0x00, 0x01, tlvs.length, ...tlvs, 0x00]);
}

/** One BER-TLV data object out of an ACS response. Multi byte tags are held as one number, so `5F 51` is 0x5f51. */
export interface BerTlv {
  readonly tag: number;
  readonly value: Uint8Array;
}

/**
 * Parses the BER-TLV data field of an ACS PC/SC 2.0 Part 3 response, 5.3.5.2 ("Data Field
 * BER-TLV encoded"). Returns null for anything malformed, including a length that runs
 * past the end, so a truncated answer can never be read as a short valid one.
 */
export function parseBerTlv(data: Uint8Array): BerTlv[] | null {
  const out: BerTlv[] = [];
  let i = 0;
  while (i < data.length) {
    let tag = data[i++] ?? 0;
    if ((tag & 0x1f) === 0x1f) {
      // Multi byte tag, as in 5F 46, 5F 51 and FF 6E. Subsequent bytes carry bit 8 while more follow.
      let more = true;
      let extra = 0;
      while (more) {
        if (i >= data.length || extra === 3) return null;
        const b = data[i++] ?? 0;
        tag = tag * 256 + b;
        more = (b & 0x80) !== 0;
        extra += 1;
      }
    }
    if (i >= data.length) return null;
    let length = data[i++] ?? 0;
    if (length === 0x81) {
      if (i + 1 > data.length) return null;
      length = data[i++] ?? 0;
    } else if (length === 0x82) {
      if (i + 2 > data.length) return null;
      length = ((data[i] ?? 0) << 8) | (data[i + 1] ?? 0);
      i += 2;
    } else if (length > 0x7f) {
      return null;
    }
    if (i + length > data.length) return null;
    out.push({ tag, value: data.subarray(i, i + length) });
    i += length;
  }
  return out;
}

/** 5.3.5.2, "C0 data element Format": `C0 03 [XX] [SW1] [SW2]`, where `00 90 00` is "No error occurred". */
const TLV_STATUS = 0xc0;
/** 5.3.5.4, Rsp TLV "Receive Bit framing: 92 01h [NumBit]". */
const TLV_RX_BIT_FRAMING = 0x92;
/** 5.3.5.4, Rsp TLV "Response Status: 96 02h [Status] 00h", with Status bit 0 CRC, 1 collision, 2 parity, 3 framing error. */
const TLV_RESPONSE_STATUS = 0x96;
/** 5.3.5.4, Rsp TLV "Response: 97h [Size] [Data]". */
const TLV_RESPONSE = 0x97;
/** 5.3.5.5 Rsp TLV `8F` and 5.3.5.5.2 `5F 51`, which a Switch Protocol answer may carry. */
const TLV_SWITCH_RESPONSE = 0x8f;
const TLV_ATR = 0x5f51;

/** Explains the C0 status object, or returns null when it reads `00 90 00`. Exported for the tests. */
export function c0Problem(value: Uint8Array): string | null {
  if (value.length !== 3) return `the C0 status object is ${value.length} bytes rather than 3`;
  if (value[0] === 0x00 && value[1] === 0x90 && value[2] === 0x00) return null;
  const sw12 = ((value[1] ?? 0) << 8) | (value[2] ?? 0);
  const meaning =
    sw12 === 0x6401
      ? 'no response from the tag (a timeout)'
      : sw12 === 0x6400
        ? 'no response from the reader'
        : sw12 === 0x6a81
          ? 'data object not supported'
          : sw12 === 0x6700
            ? 'data object with unexpected length'
            : sw12 === 0x6a80
              ? 'data object with unexpected value'
              : 'an error status';
  return `the reader reported ${meaning} in data object ${value[0]}, C0 status ${hex(value)}`;
}

/**
 * Checks the answer to a session control or Switch Protocol APDU. Throws unless the
 * status word is 90 00, the data field parses, any C0 object reads `00 90 00`, and
 * nothing appears that the manual does not list for that command.
 */
function requireControlOk(response: Uint8Array, step: string, allowedTags: readonly number[]): void {
  const problem = controlProblem(response, allowedTags);
  if (problem === null) return;
  throw new ChipError(
    'PROTECT_FAILED',
    `The reader did not complete "${step}": ${problem}. The ST command that was to follow was not sent.`,
    'Nothing irreversible reached the tag. Unplug and replug the reader before the next tag: ACS warns a transparent session used incorrectly can leave it unable to detect tags (ACR1552U reference manual, 5.3.5.3). Record this message for the bring up notes.',
    { step },
  );
}

function controlProblem(response: Uint8Array, allowedTags: readonly number[]): string | null {
  if (sw(response) !== SW_OK) return `status word 0x${sw(response).toString(16)}`;
  const tlvs = parseBerTlv(body(response));
  if (tlvs === null) return `a malformed data field, ${hex(body(response))}`;
  for (const tlv of tlvs) {
    if (tlv.tag === TLV_STATUS) {
      const problem = c0Problem(tlv.value);
      if (problem !== null) return problem;
    } else if (!allowedTags.includes(tlv.tag)) {
      return `an unexpected data object with tag 0x${tlv.tag.toString(16)}`;
    }
  }
  return null;
}

/**
 * What the TAG said, as opposed to what the reader said about the exchange.
 *
 *   - `ok`: the ISO 15693 response flags byte is exactly 00 and `data` is what followed it.
 *   - `error`: the flags byte is exactly 01, the error flag, followed by exactly one error code.
 *   - `no-answer`: anything else, with the reason. A timeout, a CRC, parity, framing or
 *     collision error, a C0 status other than `00 90 00`, a status word other than 90 00,
 *     a missing or duplicated object, an object the manual does not list, or flags that
 *     are neither of the two above. **None of these is evidence about the tag.**
 */
export type TagAnswer =
  | { readonly kind: 'ok'; readonly data: Uint8Array }
  | { readonly kind: 'error'; readonly errorCode: number }
  | { readonly kind: 'no-answer'; readonly reason: string };

/** ISO/IEC 15693-3 response flags: bit 1 is the error flag. */
const ISO15693_RESPONSE_FLAG_ERROR = 0x01;

/**
 * Reads a Transparent Exchange answer, strictly.
 *
 * The shape required is the manual's own, 5.3.5.6 step 6: "C0 03 00 90 00 92 01 00
 * 96 02 00 00 97 0C [Card Response] 90 00". The C0 object must be present and read
 * `00 90 00` ("SW1 SW2 from the C0 data object below should also be used", 5.3.5.2).
 * The 92 and 96 objects are optional, and when present must report all bits valid and
 * no error. Exactly one 97 object must carry the tag's answer. Exported for the tests.
 */
export function parseTransceiveAnswer(response: Uint8Array): TagAnswer {
  const noAnswer = (reason: string): TagAnswer => ({ kind: 'no-answer', reason });
  if (sw(response) !== SW_OK) return noAnswer(`status word 0x${sw(response).toString(16)}`);
  const tlvs = parseBerTlv(body(response));
  if (tlvs === null) return noAnswer(`a malformed data field, ${hex(body(response))}`);

  const seen = new Set<number>();
  let status: Uint8Array | null = null;
  let tagData: Uint8Array | null = null;
  for (const tlv of tlvs) {
    if (seen.has(tlv.tag)) return noAnswer(`data object 0x${tlv.tag.toString(16)} appears twice`);
    seen.add(tlv.tag);
    if (tlv.tag === TLV_STATUS) {
      status = tlv.value;
    } else if (tlv.tag === TLV_RX_BIT_FRAMING) {
      if (tlv.value.length !== 1 || tlv.value[0] !== 0x00) return noAnswer(`receive bit framing ${hex(tlv.value)}, so the last byte was partial`);
    } else if (tlv.tag === TLV_RESPONSE_STATUS) {
      if (tlv.value.length !== 2 || tlv.value[0] !== 0x00 || tlv.value[1] !== 0x00) {
        return noAnswer(`response status ${hex(tlv.value)} (bit 0 CRC, bit 1 collision, bit 2 parity, bit 3 framing error)`);
      }
    } else if (tlv.tag === TLV_RESPONSE) {
      tagData = tlv.value;
    } else {
      return noAnswer(`an unexpected data object with tag 0x${tlv.tag.toString(16)}`);
    }
  }

  if (status === null) return noAnswer('no C0 status object');
  const problem = c0Problem(status);
  if (problem !== null) return noAnswer(problem);
  if (tagData === null) return noAnswer('no 97 response object, so the tag said nothing');
  if (tagData.length === 0) return noAnswer('an empty 97 response object');

  const flags = tagData[0] ?? 0;
  if (flags === 0x00) return { kind: 'ok', data: tagData.subarray(1) };
  if (flags === ISO15693_RESPONSE_FLAG_ERROR && tagData.length === 2) return { kind: 'error', errorCode: tagData[1] ?? 0 };
  return noAnswer(`ISO 15693 response flags 0x${flags.toString(16).padStart(2, '0')} with ${tagData.length - 1} byte(s) after them, which is neither a plain success nor a plain error`);
}

/**
 * ISO/IEC 15693-3 error codes that mean the tag did not understand the request as a
 * command it implements: 01 command not supported, 02 command not recognised, 03 option
 * not supported. A wrong password answered with one of these proves nothing about the
 * password, only that the frame was not taken as Present Password.
 */
const ISO15693_ERRORS_NOT_UNDERSTOOD: readonly number[] = [0x01, 0x02, 0x03];

/**
 * ISO/IEC 15693-3 error code 12: "the specified block is locked and its content cannot
 * be changed". The only answer to a write that the post protection proof accepts as a
 * protection refusal. **Taken from ISO 15693-3 as commonly cited, not from the ST25TV02KC
 * datasheet, which is not in hand.** If the part answers a password protected block with
 * a different code, the proof fails closed: the unit is recorded PROTECT_FAILED, never
 * protected, and the code seen is in the message.
 */
export const ISO15693_ERROR_BLOCK_LOCKED = 0x12;

/** ISO/IEC 15693-3 Write Single Block. A standard command, in the ACS supported list (5.3.4.2.2, 21h, "Yes"). */
const ISO15693_WRITE_SINGLE_BLOCK = 0x21;

/** Builds an ISO 15693 Write Single Block frame: flags, 21, block number, data. Exported for the tests. */
export function writeSingleBlockFrame(block: number, data: Uint8Array): Uint8Array {
  if (block < 0 || block > 0xff) throw new Error(`Block ${block} does not fit a one byte block number.`);
  return Uint8Array.from([FLAG_HIGH_DATA_RATE, ISO15693_WRITE_SINGLE_BLOCK, block, ...data]);
}

/**
 * Decides whether the opcode probe proved the command path. Pure, so every way it can
 * go wrong is tested without a reader. Exported for the tests.
 *
 * **"Different" is not enough. Both halves must be explicitly correct:**
 *   - the factory default must be an explicit tag level success: flags 00, nothing after;
 *   - the deliberately wrong password must be an explicit tag level error: flags 01 and
 *     one error code, and not a code saying the command itself was not understood.
 * A timeout and a CRC error differ from each other, and proved nothing under the old rule.
 */
export function judgeOpcodeProbe(wrong: TagAnswer, right: TagAnswer): { proven: boolean; detail: string } {
  const describe = (a: TagAnswer) =>
    a.kind === 'ok'
      ? `success with ${a.data.length} byte(s) after the flags`
      : a.kind === 'error'
        ? `tag error code 0x${a.errorCode.toString(16).padStart(2, '0')}`
        : `no usable answer (${a.reason})`;
  const seen = `The deliberately wrong password got ${describe(wrong)}. The factory default got ${describe(right)}.`;

  if (right.kind !== 'ok' || right.data.length !== 0) {
    return {
      proven: false,
      detail: `${seen} The factory default must be an explicit success (ISO 15693 flags 00, nothing after them) and was not, so the command path is unproven and the irreversible commands stay locked. Either this tag already carries a password, or a byte in the opcode, the flags, the session framing or the reader wrapper is wrong.`,
    };
  }
  if (wrong.kind !== 'error') {
    return {
      proven: false,
      detail: `${seen} The wrong password must be refused with the ISO 15693 error flag and was not, so a right password and a wrong one cannot be told apart and the irreversible commands stay locked.`,
    };
  }
  if (ISO15693_ERRORS_NOT_UNDERSTOOD.includes(wrong.errorCode)) {
    return {
      proven: false,
      detail: `${seen} Error code 0x${wrong.errorCode.toString(16).padStart(2, '0')} means the tag did not take the frame as a command it implements, so the refusal says nothing about the password. The irreversible commands stay locked.`,
    };
  }
  return {
    proven: true,
    detail: `${seen} The tag accepted the factory default and explicitly refused the wrong password, so the Present Password path is confirmed on this tag.`,
  };
}

/** Generous. A person is placing a tag on a reader by hand. */
const POLL_INTERVAL_MS = 100;

function sw(response: Uint8Array): number {
  if (response.length < 2) return 0;
  return ((response[response.length - 2] ?? 0) << 8) | (response[response.length - 1] ?? 0);
}

function body(response: Uint8Array): Uint8Array {
  return response.subarray(0, Math.max(0, response.length - 2));
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Builds a Read Binary APDU for one or more blocks.
 *
 * P1/P2 carry the block number and Le the byte count. Exported for tests, which
 * can assert the bytes without a reader in the room: that is the only part of
 * this file that can be proven today, so it is made testable deliberately.
 */
export function readBinaryApdu(firstBlock: number, count: number): Uint8Array {
  const bytes = count * PART.blockSizeBytes;
  return Uint8Array.from([CLA_PCSC, INS_READ_BINARY, (firstBlock >> 8) & 0xff, firstBlock & 0xff, bytes & 0xff]);
}

/** Builds an Update Binary APDU for exactly one block. */
export function updateBinaryApdu(block: number, data: Uint8Array): Uint8Array {
  return Uint8Array.from([
    CLA_PCSC,
    INS_UPDATE_BINARY,
    (block >> 8) & 0xff,
    block & 0xff,
    data.length & 0xff,
    ...data,
  ]);
}

export function getUidApdu(): Uint8Array {
  return Uint8Array.from([CLA_PCSC, INS_GET_DATA, 0x00, 0x00, 0x00]);
}

/**
 * Accepts a UID in either byte order and returns it most significant byte first.
 *
 * **This ambiguity is real and is flagged rather than resolved.** ISO 15693 UIDs
 * are transmitted least significant byte first on the air interface, and readers
 * differ over whether they hand that straight back or reverse it for you. Rather
 * than guess, this accepts whichever end carries the 0xE0 marker, and refuses
 * when neither does. **Confirm the true order during bring up and simplify this
 * function then**, because a UID printed backwards in a batch journal is a record
 * that cannot be matched against a tag later.
 */
export function normaliseUid(raw: Uint8Array): { uid: Uint8Array; reversed: boolean } | null {
  if (raw.length !== PART.uidBits / 8) return null;
  if (raw[0] === ISO15693_UID_PREFIX) return { uid: raw, reversed: false };

  const last = raw[raw.length - 1];
  if (last === ISO15693_UID_PREFIX) return { uid: Uint8Array.from(raw).reverse(), reversed: true };

  return null;
}

/** True when a normalised, MSB first UID says STMicroelectronics. */
export function isStMicroelectronics(uidMsbFirst: Uint8Array): boolean {
  return uidMsbFirst.length === PART.uidBits / 8 && uidMsbFirst[1] === IC_MFG_STMICROELECTRONICS;
}

/** Narrows a UID read from the wire. Exported only so the tests can reuse the shape. */
export type NormalisedUid = { uid: Uint8Array; reversed: boolean };

export class PcscTransport implements TagTransport {
  readonly name = 'pcsc';
  readonly isHardware = true;

  private binding: PcscBinding | null = null;
  private reader: PcscReaderHandle | null = null;
  private card: PcscCardHandle | null = null;
  private connected = false;
  private currentUid: string | null = null;
  /** The reader this transport last opened. Kept after close so doctor can name it. */
  private openedReaderName: string | null = null;
  /**
   * The UID of the one physical tag on which verifyOpcodes has confirmed the command
   * path, or null. **The proof belongs to that tag and that connection only.** It is
   * cleared when any tag is selected, when the tag is released, when the transport is
   * opened or closed, and on any transport error, and the irreversible commands also
   * re-read the UID from the field and require it to match before sending anything.
   */
  private provenUid: string | null = null;

  private readonly loadBinding: PcscBindingLoader;
  private readonly readerTimeoutMs: number;

  constructor(
    private readonly readerNameFilter?: string,
    options: PcscTransportOptions = {},
  ) {
    this.loadBinding = options.loadBinding ?? loadPcscMini;
    this.readerTimeoutMs = options.readerTimeoutMs ?? 10_000;
  }

  /** The PC/SC name of the reader in use, or null before the first successful open. */
  get readerName(): string | null {
    return this.openedReaderName;
  }

  async open(): Promise<void> {
    this.resetProof();
    let binding: PcscBinding;
    try {
      binding = await this.loadBinding();
    } catch {
      throw new ChipError(
        'TRANSPORT_UNAVAILABLE',
        'The PC/SC binding is not installed, so no reader can be reached.',
        `Run "npm ci" in build/chip-cli, which installs it, or "npm install ${PCSC_BINDING_PACKAGE}". It is an optional dependency because it is a native module and the simulator does not need it. It is prebuilt for Windows x64 and macOS, so no compiler is needed. On Linux also install pcscd. To carry on without a reader, use --transport simulator, which needs no hardware and writes nothing physical.`,
      );
    }
    this.binding = binding;

    try {
      const reader = await new Promise<PcscReaderHandle>((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(() => {
          settled = true;
          reject(
            new ChipError(
              'TRANSPORT_UNAVAILABLE',
              `No PC/SC reader appeared within ${Math.round(this.readerTimeoutMs / 1000)} seconds.`,
              'Check the reader is plugged in and its driver is installed. On Windows, Device Manager lists it as a smart card reader. Close any other application holding it open, GoToTags included: PC/SC gives exclusive access and the second application to ask is the one that fails.',
            ),
          );
        }, this.readerTimeoutMs);

        try {
          binding.start(
            (reader) => {
              if (settled) return;
              if (this.readerNameFilter) {
                if (!reader.name.toLowerCase().includes(this.readerNameFilter.toLowerCase())) return;
              } else if (isSamSlot(reader.name)) {
                return;
              }
              settled = true;
              clearTimeout(timer);
              resolve(reader);
            },
            (err) => {
              if (settled) return;
              settled = true;
              clearTimeout(timer);
              reject(
                new ChipError('TRANSPORT_UNAVAILABLE', `PC/SC reported an error: ${err.message}`, 'Check the reader connection and the PC/SC service.'),
              );
            },
          );
        } catch (err) {
          settled = true;
          clearTimeout(timer);
          reject(
            new ChipError(
              'TRANSPORT_UNAVAILABLE',
              `The PC/SC service could not be reached: ${err instanceof Error ? err.message : String(err)}`,
              'Plug the reader in first. On Windows the Smart Card service only starts once a reader is attached, so with none plugged in this is the answer to expect. On a Mac it is built in. On Linux start pcscd. Then run the command again.',
            ),
          );
        }
      });
      this.reader = reader;
      this.openedReaderName = reader.name;
    } catch (cause) {
      // A binding left running holds the event loop open, and the command would print
      // its failure and then never exit.
      this.stopBinding();
      throw cause;
    }
  }

  async close(): Promise<void> {
    this.resetProof();
    if (this.connected) await this.releaseTag().catch(() => undefined);
    this.stopBinding();
    this.reader = null;
  }

  private stopBinding(): void {
    try {
      this.binding?.stop();
    } catch {
      // Stopping a client whose service has already gone away is not a failure of the run.
    }
    this.binding = null;
  }

  async waitForTag(timeoutMs: number): Promise<TagIdentity> {
    // A selection, of the same tag or another, ends any proof. The probe has to be run
    // again on whatever is in the field now.
    this.resetProof();
    this.currentUid = null;
    const reader = this.requireReader();
    const deadline = Date.now() + timeoutMs;

    while (!reader.tagPresent()) {
      if (Date.now() > deadline) {
        throw new ChipError(
          'TAG_ABSENT',
          `No tag arrived on the reader within ${timeoutMs} ms.`,
          'Place one ST25TV02KC tag flat on the reader. One at a time: two tags in the field collide and neither is selected.',
        );
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }

    // An existing connection is reused, as the previous binding did.
    if (!this.card) {
      try {
        this.card = await reader.connect();
      } catch (err) {
        throw new ChipError(
          'TAG_ABSENT',
          `The reader saw a tag but could not select it: ${err instanceof Error ? err.message : String(err)}`,
          'Reseat the tag and try again. If it repeats, the tag may not be ISO 15693, or another application (GoToTags included) is holding the reader: close it.',
        );
      }
    }
    this.connected = true;

    const response = await this.transmit(getUidApdu(), 32);
    if (sw(response) !== SW_OK) {
      throw new ChipError(
        'TAG_ABSENT',
        `The reader refused to report a UID (status 0x${sw(response).toString(16)}).`,
        'Reseat the tag. If every tag does this, the reader may be in a mode that does not poll ISO 15693.',
      );
    }

    const normalised = normaliseUid(body(response));
    if (!normalised) {
      throw new ChipError(
        'TAG_NOT_ST25TV02KC',
        `The tag returned a UID that is not an ISO 15693 UID: ${hex(body(response))}.`,
        'Every ISO 15693 UID is eight bytes and begins 0xE0. This is most likely an NTAG or another Type 2 tag, which this tool cannot write. See the README, section 1.',
      );
    }
    if (!isStMicroelectronics(normalised.uid)) {
      throw new ChipError(
        'TAG_NOT_ST25TV02KC',
        `The tag is ISO 15693 but not made by STMicroelectronics (manufacturer code 0x${(normalised.uid[1] ?? 0).toString(16).padStart(2, '0')}).`,
        'This tool writes ST25TV02KC. An ICODE SLIX or other maker\'s Type 5 tag has a different memory layout and must not be written with this image.',
      );
    }

    this.currentUid = hex(normalised.uid);

    return {
      uid: this.currentUid,
      // PC/SC cannot report a part number. Null is the documented, expected answer here
      // and the UID check above is what stands in for it.
      partNumber: null,
      blockCount: await this.probeBlockCount(),
      blockSizeBytes: PART.blockSizeBytes,
    };
  }

  /**
   * Establishes the block count by reading, rather than asserting it from the datasheet.
   *
   * README section 6.3 step 2 says to confirm the geometry is 64 blocks of 4 bytes.
   * A constant cannot confirm anything, so this reads the last block the part should
   * have and then reads one past it, and requires the first to succeed and the second
   * to fail. **A part that answers both is not the part this tool models**, and writing
   * a 248 byte image to it could run off the end of its area.
   */
  private async probeBlockCount(): Promise<number> {
    const last = await this.transmit(readBinaryApdu(PART.blockCount - 1, 1), PART.blockSizeBytes + 2);
    if (sw(last) !== SW_OK) {
      throw new ChipError(
        'TAG_NOT_ST25TV02KC',
        `Block ${PART.blockCount - 1} could not be read, so this tag has fewer than ${PART.blockCount} blocks.`,
        'ST25TV02KC has 64 blocks of 4 bytes. A smaller part is a different chip and this tool will not write it.',
      );
    }

    const past = await this.transmit(readBinaryApdu(PART.blockCount, 1), PART.blockSizeBytes + 2);
    if (sw(past) === SW_OK) {
      throw new ChipError(
        'TAG_NOT_ST25TV02KC',
        `Block ${PART.blockCount} answered a read, so this tag is larger than ST25TV02KC.`,
        'This is a bigger ST25 part. It is not what the redirect table and the 248 byte area calculation assume, so it is refused rather than half written.',
      );
    }

    return PART.blockCount;
  }

  async readBlocks(firstBlock: number, count: number): Promise<Uint8Array> {
    const expected = count * PART.blockSizeBytes;
    const response = await this.transmit(readBinaryApdu(firstBlock, count), expected + 2);

    if (sw(response) !== SW_OK) {
      throw new ChipError(
        'READBACK_FAILED',
        `Reading ${count} block(s) from block ${firstBlock} failed with status 0x${sw(response).toString(16)}.`,
        'If this happens after a write, the tag may have left the field mid operation. Keep it still on the reader for the whole unit.',
      );
    }

    const data = body(response);
    if (data.length !== expected) {
      throw new ChipError(
        'READBACK_FAILED',
        `Expected ${expected} bytes from block ${firstBlock} and got ${data.length}.`,
        'A short read means the reader chunked the response. Reduce the blocks per read, or report this with the reader model.',
      );
    }
    return data;
  }

  async writeBlock(block: number, data: Uint8Array): Promise<void> {
    if (data.length !== PART.blockSizeBytes) {
      throw new ChipError(
        'WRITE_FAILED',
        `A block write must be exactly ${PART.blockSizeBytes} bytes and this was ${data.length}.`,
        'This is a bug in the caller rather than anything to do with the tag.',
      );
    }

    const response = await this.transmit(updateBinaryApdu(block, data), 2);
    if (sw(response) !== SW_OK) {
      throw new ChipError(
        'WRITE_FAILED',
        `Writing block ${block} failed with status 0x${sw(response).toString(16)}.`,
        'If this is a tag from order SO4731, it is write protected and needs the ST25TV area password, which Trevean does not hold. Use a bare tag. See "Decision log", D45.',
      );
    }
  }

  // -------------------------------------------------------------------------
  // Protection.
  //
  // The opcodes these use come from secondary sources rather than the datasheet,
  // which would not download from five routes on 7 October 2026. See
  // chip/st-custom.ts for the provenance of every byte.
  //
  // The design that makes that shippable: PRESENT PASSWORD cannot damage a tag,
  // so it is probed against the physical chip, and the probe's result decides
  // whether the irreversible pair is allowed to run at all.
  // -------------------------------------------------------------------------

  /**
   * Sends one raw ISO 15693 frame inside a transparent session and returns what the TAG
   * said. Throws, with nothing further sent, when the session start or the protocol
   * switch is refused, including a refusal hidden in a C0 object under a 90 00. A
   * transport error throws too, and clears the proof.
   */
  private async transceive(frame: Uint8Array, step: string): Promise<TagAnswer> {
    requireControlOk(await this.transmit(ACS_SESSION_START, 2), `start transparent session for ${step}`, []);
    try {
      requireControlOk(await this.transmit(ACS_SWITCH_ISO15693, 2), `switch protocol to ISO 15693 for ${step}`, [
        TLV_SWITCH_RESPONSE,
        TLV_ATR,
      ]);
      return parseTransceiveAnswer(await this.transmit(transparentExchangeApdu(frame), 32));
    } finally {
      // Always closes, even on failure. A reader left in a transparent session stops
      // auto polling and looks broken to the next person who picks it up.
      await this.transmit(ACS_SESSION_END, 2).catch(() => undefined);
    }
  }

  /** Sends one ST custom command. See `transceive`. */
  private stCommand(command: StCommand, params: readonly number[] = []): Promise<TagAnswer> {
    return this.transceive(stRequest(command, params), command.name);
  }

  /**
   * Proves the command path on the tag in front of you, without changing it.
   *
   * This is the bring up step README section 6.3 asks for, made executable, and since
   * Sunday 25 October 2026 it runs inside `--protect` itself, immediately before the
   * first irreversible command (see `UnitSession.protect`). It presents a deliberately
   * wrong password and then the factory default, and requires the factory default to be
   * an EXPLICIT success and the wrong one an EXPLICIT tag level error. See
   * `judgeOpcodeProbe` for exactly what counts. Only then are the opcode, the
   * manufacturer byte, the flag byte, the transparent session framing and the reader
   * transceive wrapper shown to be right, because nothing else produces that pair.
   *
   * Any timeout, CRC error, transport error or unexpected shape on either attempt means
   * NOT proven. The proof is recorded against this tag's UID and is lost when any tag is
   * selected, when the tag is released, and on reopen or any transport error.
   *
   * It passes only on a bare tag whose password 1 is still the factory default. Run it
   * on a SACRIFICIAL BARE TAG. It is safe by construction, but the point of a bring up
   * is that you find out on a tag you do not mind losing.
   */
  async verifyOpcodes(): Promise<{ proven: boolean; detail: string }> {
    this.resetProof();
    const uid = this.currentUid;
    if (!this.connected || uid === null) {
      return { proven: false, detail: 'No tag is selected, so there is nothing to prove the command path on.' };
    }

    const cmd = ST_COMMANDS.PRESENT_PASSWORD;
    let verdict: { proven: boolean; detail: string };
    try {
      const wrong = await this.stCommand(cmd, [1, ...DELIBERATELY_WRONG_PASSWORD]);
      const right = await this.stCommand(cmd, [1, ...FACTORY_DEFAULT_PASSWORD]);
      verdict = judgeOpcodeProbe(wrong, right);
    } catch (cause) {
      this.resetProof();
      return {
        proven: false,
        detail: `The probe did not complete: ${cause instanceof Error ? cause.message : String(cause)} The irreversible commands stay locked.`,
      };
    }
    if (!verdict.proven) return verdict;

    // The two answers came from whatever was in the field. Require it to be the tag
    // that was selected, read from the field now rather than remembered.
    const now = await this.readUidNow();
    if (now !== uid) {
      this.resetProof();
      return {
        proven: false,
        detail: `The probe answered correctly, but the tag in the field now reads uid ${now ?? 'unreadable'} and the selected tag was ${uid}. Nothing is proven.`,
      };
    }
    this.provenUid = uid;
    return verdict;
  }

  async presentPassword(passwordNumber: number, password: Uint8Array): Promise<void> {
    assertPasswordLength(password);
    const answer = await this.stCommand(ST_COMMANDS.PRESENT_PASSWORD, [passwordNumber, ...password]);

    if (answer.kind === 'error') {
      throw new ChipError(
        'PASSWORD_REJECTED',
        `The tag refused password ${passwordNumber} with ISO 15693 error code 0x${answer.errorCode.toString(16).padStart(2, '0')}.`,
        'Either the password is wrong or this area is governed by a different password number. On an SO4731 tag it is wrong, and Trevean does not hold the right one. See "Decision log", D45.',
        { passwordNumber, errorCode: answer.errorCode },
      );
    }
    if (answer.kind !== 'ok' || answer.data.length !== 0) {
      throw new ChipError(
        'PROTECT_FAILED',
        `Present Password got no usable answer from the tag: ${answer.kind === 'no-answer' ? answer.reason : `success flags with ${answer.data.length} unexpected byte(s) after them`}.`,
        'This is not evidence of a wrong password, and nothing was written. It is the ST command path through the reader failing. Set the tag aside and record this message for the bring up notes.',
        { passwordNumber },
      );
    }
  }

  async writePassword(passwordNumber: number, password: Uint8Array): Promise<void> {
    assertPasswordLength(password);
    await this.requireProvenOpcodes('change a password');

    const answer = await this.stCommand(ST_COMMANDS.WRITE_PASSWORD, [passwordNumber, ...password]);
    if (answer.kind !== 'ok' || answer.data.length !== 0) {
      throw new ChipError(
        'PROTECT_FAILED',
        `Writing password ${passwordNumber} was not confirmed by the tag: ${describeAnswer(answer)}.`,
        'Set the tag aside, label it, and do not record it as protected. If the tag gave no answer, it may or may not now hold the new password, which is the one in the secret store: write down the fingerprint the tool printed with this run. Do not retry on this tag.',
        { passwordNumber },
      );
    }
  }

  async setAreaProtection(area: number, protection: AreaProtection, passwordNumber: number): Promise<void> {
    await this.requireProvenOpcodes('apply area protection');

    const bits = protection === 'none' ? 0x00 : protection === 'write_protected' ? 0x01 : 0x03;
    const answer = await this.stCommand(ST_COMMANDS.SET_MEMORY_PROTECTION, [area, (passwordNumber << 4) | bits]);
    if (answer.kind !== 'ok' || answer.data.length !== 0) {
      throw new ChipError(
        'PROTECT_FAILED',
        `Setting protection on area ${area} was not confirmed by the tag: ${describeAnswer(answer)}.`,
        'Set the tag aside, label it, and do not record it as protected. If the tag gave no answer, the area may or may not now be protected under the password in the secret store. Do not retry on this tag.',
        { area, passwordNumber },
      );
    }
  }

  /**
   * Reads an area's protection with the 0xBA "read form", a single parameter.
   *
   * **GATED, like the irreversible pair, since Sunday 25 October 2026.** 0xBA is the
   * same code as Set Memory Protection, and the one parameter "read form" is described
   * only by secondary sources. **No documented safe read of the area protection is in
   * hand**: the ST25TV02KC datasheet is not, and the ACS manual documents only the
   * transport. A bet on an undocumented form of an irreversible opcode is not "read
   * only", so this refuses, sending nothing, unless the probe has passed on this very
   * tag in this very connection. The consequence is stated plainly in README 6.4: it can
   * no longer be pointed at an SO4731 tag to find out what the supplier applied, because
   * the probe cannot pass on a tag that carries a password.
   */
  async readAreaProtection(area = 1): Promise<AreaProtectionState> {
    await this.requireProvenOpcodes('read area protection with the undocumented 0xBA read form');

    const answer = await this.stCommand(ST_COMMANDS.SET_MEMORY_PROTECTION, [area]);
    if (answer.kind !== 'ok' || answer.data.length !== 1) {
      throw new ChipError(
        'PROTECT_FAILED',
        `The tag did not report protection for area ${area}: ${describeAnswer(answer)}.`,
        'The 0xBA read form is undocumented and this is the first thing to record at bring up. The protection command before it may still have taken effect. Set the tag aside, label it, and do not record it as protected.',
        { area },
      );
    }

    const value = answer.data[0] ?? 0;
    const bits = value & 0x03;
    return {
      protection: bits === 0x00 ? 'none' : bits === 0x01 ? 'write_protected' : 'read_and_write_protected',
      passwordNumber: (value >> 4) & 0x03,
    };
  }

  /**
   * The post protection proof: rewrites `data`, which must be what the block already
   * holds, and reports the tag's own verdict.
   *
   * A refused PC/SC Update Binary cannot be used for this. The ACS manual gives it one
   * error row, "6X XXh Fail" (5.3.3.5), so a write refused by protection and a write
   * lost to RF look the same, and calling the second "protected" would record an
   * unprotected tag as protected. So this sends the standard ISO 15693 Write Single Block
   * (21h) in a transparent session and reads the tag's flags and error code. Only error
   * 0x12 counts as refused by protection. A plain success means the write went through,
   * leaving the block unchanged because the bytes are the ones already there. Anything
   * else throws.
   *
   * It is not gated by the probe. It cannot be: the proof runs after the tag has left the
   * field, which clears the probe, and after the password has changed, so the probe cannot
   * pass again. It writes nothing that is not already there, so it is no more dangerous
   * than the Update Binary it replaces.
   */
  async proveWriteRefused(block: number, data: Uint8Array): Promise<'refused' | 'accepted'> {
    if (data.length !== PART.blockSizeBytes) {
      throw new ChipError('PROTECT_FAILED', `The proof write must be exactly ${PART.blockSizeBytes} bytes.`, 'This is a bug in the caller. Report it.');
    }
    const answer = await this.transceive(writeSingleBlockFrame(block, data), 'Write Single Block');
    if (answer.kind === 'ok' && answer.data.length === 0) return 'accepted';
    if (answer.kind === 'error' && answer.errorCode === ISO15693_ERROR_BLOCK_LOCKED) return 'refused';
    throw new ChipError(
      'PROTECT_FAILED',
      `The proof write to block ${block} got neither a plain success nor the "block locked" refusal (ISO 15693 error 0x12): ${describeAnswer(answer)}.`,
      'Set the tag aside, label it, and do not record it as protected. If the answer was a tag error code other than 0x12, write the code down: it may be how this part reports a password protected block, which the datasheet would settle.',
      { block },
    );
  }

  /**
   * The gate. Irreversible commands, and the undocumented 0xBA read form, do not run
   * unless the probe passed on the tag that is in the field right now.
   *
   * Three conditions, all checked before a single byte of the command is sent: the probe
   * passed in this connection, the selected UID is the proven one, and the UID read from
   * the field now is the proven one. The last costs one Get Data and catches a tag
   * swapped without the tool being told.
   */
  private async requireProvenOpcodes(action: string): Promise<void> {
    const proven = this.provenUid;
    if (proven !== null && this.connected && this.currentUid === proven) {
      const now = await this.readUidNow();
      if (now === proven) return;
      this.resetProof();
      throw gateRefusal(action, `the tag in the field reads uid ${now ?? 'unreadable'}, not the uid ${proven} the probe ran on`);
    }
    this.resetProof();
    throw gateRefusal(action, 'the ST custom command path has not been proven on this tag');
  }

  /** The UID read from the field now, MSB first, or null if it cannot be read as an ST ISO 15693 UID. */
  private async readUidNow(): Promise<string | null> {
    try {
      const response = await this.transmit(getUidApdu(), 32);
      if (sw(response) !== SW_OK) return null;
      const normalised = normaliseUid(body(response));
      if (!normalised || !isStMicroelectronics(normalised.uid)) return null;
      return hex(normalised.uid);
    } catch {
      return null;
    }
  }

  async releaseTag(): Promise<void> {
    this.resetProof();
    const card = this.card;
    if (!this.reader || !this.connected || !card) return;

    // Unpower rather than leave: dropping the field is what makes a presented password
    // stop applying, which is how the verify step proves protection actually took hold
    // rather than merely being accepted. A failure to disconnect is ignored, as before:
    // the connection is gone either way.
    await card.disconnectUnpower().catch(() => undefined);
    this.card = null;
    this.connected = false;
    this.currentUid = null;
  }

  private resetProof(): void {
    this.provenUid = null;
  }

  async completeUnit(): Promise<void> {
    await this.releaseTag();
  }

  private requireReader(): PcscReaderHandle {
    if (!this.reader) {
      throw new ChipError('TRANSPORT_UNAVAILABLE', 'The transport is not open.', 'Call open() before waiting for a tag. This is a bug in the caller.');
    }
    return this.reader;
  }

  /**
   * Sends one APDU to the connected tag.
   *
   * `expectedLen` records what each call site expects back, and is no longer used to
   * size the receive buffer. The binding always receives into its maximum, because a
   * buffer smaller than the answer makes PC/SC refuse the whole exchange
   * (SCARD_E_INSUFFICIENT_BUFFER), and the ACS transparent session control commands
   * answer with a status TLV longer than the two bytes they were sized for here.
   * The length checks that matter, in readBlocks, are unchanged.
   */
  private async transmit(apdu: Uint8Array, expectedLen: number): Promise<Uint8Array> {
    void expectedLen;
    this.requireReader();
    const card = this.card;
    if (!card) {
      throw new ChipError('TRANSPORT_UNAVAILABLE', 'The reader rejected a command: no tag is connected.', 'Reseat the tag. If it repeats, close any other application holding the reader.');
    }
    try {
      return new Uint8Array(await card.transmit(Uint8Array.from(apdu)));
    } catch (err) {
      // Whatever happened, the tag that was proven may not be the tag that answers next.
      this.resetProof();
      throw new ChipError(
        'TRANSPORT_UNAVAILABLE',
        `The reader rejected a command: ${err instanceof Error ? err.message : String(err)}`,
        'Reseat the tag. If it repeats, close any other application holding the reader.',
      );
    }
  }
}

function describeAnswer(answer: TagAnswer): string {
  if (answer.kind === 'no-answer') return answer.reason;
  if (answer.kind === 'error') return `tag error code 0x${answer.errorCode.toString(16).padStart(2, '0')}`;
  return `success flags with ${answer.data.length} unexpected byte(s) after them`;
}

function gateRefusal(action: string, reason: string): ChipError {
  return new ChipError(
    'PROTECT_FAILED',
    `Refusing to ${action}: ${reason}. Nothing was sent to the tag.`,
    'The opcode probe runs automatically as part of --protect, on the tag in the field, immediately before the first irreversible command, and passes only on a bare tag whose password is still the factory default. Use a sacrificial bare tag for bring up. The opcodes come from secondary sources rather than the datasheet, and an irreversible command sent on an unproven path can lock a tag with a value nobody holds. See README section 6.4, chip/st-custom.ts and "Decision log", D45.',
    { action },
  );
}

function protectionUnavailable(action: string): ChipError {
  return new ChipError(
    'PROTECT_FAILED',
    `This transport cannot ${action} yet.`,
    'Password and area protection need ST custom commands inside a reader specific transparent session, and those opcodes are deliberately not written into code that has never run. Encoding, read back and tap verification all work without them, which is the whole Milestone 4 criterion. See PROTECTION_BRING_UP in src/transport/pcsc.ts.',
  );
}

/**
 * WHAT FINISHING THE PROTECTION HALF ACTUALLY REQUIRES.
 *
 * Written here rather than in a ticket, because the next person to open this file
 * is the person who needs it.
 *
 * 1. **Two documents, both of which must be read rather than recalled.** The
 *    ST25TV02KC datasheet for the custom command set and the area protection
 *    model, and ST application note **AN5658**. Also the ACS reference manual for
 *    the reader, for how a raw ISO 15693 frame is carried: ACS calls it a
 *    transparent session and it is a different APDU family from everything above.
 *
 * 2. **Four methods, in this order.** `readAreaProtection` first, because it is
 *    the only one that changes nothing and can be run against a tag all day
 *    without consequence. Then `presentPassword`, then `writePassword`, then
 *    `setAreaProtection` last, because it is the one that is not reversible
 *    without the password it just installed.
 *
 * 3. **Sacrificial tags only, and a password nobody minds losing.** README
 *    section 6.3, steps 5 and 6. Not on SO4731 stock, which is already protected
 *    with a password Trevean does not hold, and not on anything destined for a jar.
 *
 * 4. **The check people skip:** after protection is applied, tap the tag with a
 *    real phone and confirm the page still opens. A tag that is correctly
 *    protected and no longer readable by a handset is a failure that every
 *    software check will call a success.
 */
export const PROTECTION_BRING_UP = 'See the comment above this constant.' as const;
