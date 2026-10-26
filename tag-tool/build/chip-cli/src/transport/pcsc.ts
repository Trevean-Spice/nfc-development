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
 *     below). Since Sunday 25 October 2026 the ST commands come from the ST25TV02KC
 *     datasheet, DS13304 Rev 7 (see chip/st-custom.ts), which corrected three wrong
 *     secondary sourced values. A wrong protection command is the worst possible thing
 *     to be wrong about: applied to a real tag it is not reversible without the very
 *     password the command was supposed to set. **So WritePassword, WriteConfiguration
 *     and the protection read send nothing unless `verifyOpcodes` has passed on the
 *     tag in the field now.** README sections 6.4 to 6.6.
 *
 * `--protect` runs that probe itself, immediately before the first irreversible
 * command. None of the protection path has run on silicon. `PROTECTION_BRING_UP` at
 * the bottom of this file was written before it existed and is kept as the checklist.
 */

import {
  PART,
  type AreaProtection,
} from '../chip/st25tv02kc.js';
import { ChipError, isChipError, type ChipErrorDetail } from '../chip/errors.js';
import {
  ST_COMMANDS,
  CONFIG_REGISTERS,
  PASSWORD_ID,
  RW_PROTECTION_WRITE_PROTECTED,
  END_MEM_ST25TV02KC,
  ERROR_INVALID_PASSWORD_DATA,
  stRequest,
  coverCode,
  assertPasswordLength,
  FACTORY_DEFAULT_PASSWORD,
  FACTORY_DEFAULT_CONFIG_PASSWORD,
  DELIBERATELY_WRONG_PASSWORD,
  FLAGS_ADDRESSED,
  uidOnAir,
  type ConfigRegister,
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
  /**
   * Ends the connection and leaves the tag as it is, powered (SCARD_LEAVE_CARD). Only for
   * letting go after a read only detection: a presented password would survive it, so
   * nothing on the protection path uses it.
   */
  disconnectLeave(): Promise<void>;
}

/** What the PC/SC service last said about one reader. */
export interface PcscReaderState {
  /** The raw SCARD_STATE_* flags, 0 until the service has reported anything. See READER_STATE_FLAGS. */
  readonly raw: number;
  /** True once the reader has been unplugged, or the client stopped. */
  readonly gone: boolean;
}

export interface PcscReaderHandle {
  readonly name: string;
  /** The latest state the PC/SC service reported for this reader. */
  state(): PcscReaderState;
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
  CardDisposition: { readonly UNPOWER: number; readonly LEAVE: number };
};

/**
 * Adapts `pcsc-mini` to the three interfaces above. Exported for the tests, which feed
 * it a fake module of the same shape.
 *
 * Presence is tracked from the moment a reader is announced, because `pcsc-mini`
 * reports a reader's state on change only. A listener attached later, when a unit
 * starts, would never hear about a tag that was already lying on the reader.
 * `pcsc-mini` emits "reader" and then that reader's first "change" in the same call,
 * so the listener below is attached in time. Measured on Monday 26 October 2026
 * against pcscd with a virtual card already inserted: the first "change" was
 * 0x00030022, PRESENT.
 *
 * The state is passed through raw and decoded in this file, so an error can quote
 * exactly what the service said rather than a yes or no.
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
          state: () => ({ raw: status, gone }),
          async connect() {
            const card = await reader.connect(lib.CardMode.SHARED);
            return {
              transmit: (apdu) => card.transmit(apdu),
              disconnectUnpower: () => card.disconnect(lib.CardDisposition.UNPOWER),
              disconnectLeave: () => card.disconnect(lib.CardDisposition.LEAVE),
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

/**
 * The SCARD_STATE_* reader state flags. The values are the same in WinSCard
 * (winscard.h), in pcsc-lite (pcsclite.h, which macOS also follows) and in
 * `pcsc-mini` 0.1.3's ReaderStatus, which passes them through unchanged. The high 16
 * bits are not flags: WinSCard and pcsc-lite both keep a count of card events there.
 */
export const READER_STATE_FLAGS = {
  IGNORE: 0x0001,
  CHANGED: 0x0002,
  UNKNOWN: 0x0004,
  UNAVAILABLE: 0x0008,
  EMPTY: 0x0010,
  PRESENT: 0x0020,
  ATRMATCH: 0x0040,
  EXCLUSIVE: 0x0080,
  INUSE: 0x0100,
  MUTE: 0x0200,
  UNPOWERED: 0x0400,
} as const;

/**
 * What the reader state says about a tag.
 *
 * `mute` is PRESENT and MUTE together: the reader's polling found a tag, and powering
 * it up to build an answer to reset failed (the CCID reader answered ICC_MUTE). On a
 * contactless reader that is a tag in the field that did not complete activation,
 * usually because it is at the edge of the field.
 */
export type TagPresence = 'present' | 'mute' | 'absent' | 'reader-gone';

export function tagPresence(state: PcscReaderState): TagPresence {
  if (state.gone) return 'reader-gone';
  if ((state.raw & READER_STATE_FLAGS.PRESENT) === 0) return 'absent';
  return (state.raw & READER_STATE_FLAGS.MUTE) !== 0 ? 'mute' : 'present';
}

/** The raw flags and their names, for quoting in an error: "0x00030222 PRESENT|MUTE|CHANGED". */
export function describeReaderState(state: PcscReaderState): string {
  const raw = `0x${(state.raw >>> 0).toString(16).padStart(8, '0')}`;
  const names = Object.entries(READER_STATE_FLAGS)
    .filter(([, bit]) => (state.raw & bit) !== 0)
    .map(([name]) => name);
  const flags = names.length > 0 ? names.join('|') : 'no flags, nothing reported yet';
  return `${raw} ${flags}${state.gone ? ', reader disconnected' : ''}`;
}

/**
 * `pcsc-mini` puts the PC/SC error in `code` ("SharingViolation") and only a generic
 * "[ Client.TaskConnect ] Async task error" in `message`, measured on Monday 26
 * October 2026. Quoting the message alone hides the one word that says what happened.
 */
const PCSC_ERROR_NAMES: Readonly<Record<string, string>> = {
  SharingViolation: 'SCARD_E_SHARING_VIOLATION',
  UnresponsiveCard: 'SCARD_W_UNRESPONSIVE_CARD',
  UnpoweredCard: 'SCARD_W_UNPOWERED_CARD',
  UnsupportedCard: 'SCARD_W_UNSUPPORTED_CARD',
  RemovedCard: 'SCARD_W_REMOVED_CARD',
  ResetCard: 'SCARD_W_RESET_CARD',
  NoSmartCard: 'SCARD_E_NO_SMARTCARD',
  ProtoMismatch: 'SCARD_E_PROTO_MISMATCH',
  ReaderUnavailable: 'SCARD_E_READER_UNAVAILABLE',
  UnknownReader: 'SCARD_E_UNKNOWN_READER',
  NotReady: 'SCARD_E_NOT_READY',
  Timeout: 'SCARD_E_TIMEOUT',
};

function pcscErrorCode(err: unknown): string | null {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : null;
}

/** "SharingViolation (SCARD_E_SHARING_VIOLATION): [ Client.TaskConnect ] Async task error" */
export function describePcscError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const code = pcscErrorCode(err);
  if (code === null || message.includes(code)) return message;
  const name = PCSC_ERROR_NAMES[code];
  return `${code}${name ? ` (${name})` : ''}: ${message}`;
}

export interface PcscTransportOptions {
  /** For tests. Defaults to loading `pcsc-mini`. */
  readonly loadBinding?: PcscBindingLoader;
  /** How long `open` waits for a reader. Ten seconds unless a test says otherwise. */
  readonly readerTimeoutMs?: number;
  /** How long PRESENT with MUTE may last before the tool connects anyway. MUTE_GRACE_MS unless a test says otherwise. */
  readonly muteGraceMs?: number;
  /** How long a tag that has just arrived is left before the first command. ARRIVAL_SETTLE_MS unless a test says otherwise. */
  readonly arrivalSettleMs?: number;
  /** The first pause before selecting a tag that was not ready again. NOT_READY_RETRY_MS unless a test says otherwise. */
  readonly notReadyRetryMs?: number;
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
 * How long the RF field is held off in the cycle before the post protection proof, in
 * microseconds. 5.3.5.3 gives the Manage Session Timer "[TIME]: 4 byte value (LSB first)
 * in range from 1000 to 4294967000 us. The actual sleep time will round up to nearest
 * 1000us." 10 ms is ten times the minimum.
 */
export const RF_OFF_US = 10_000;

/**
 * 5.3.5.3 Manage Session with three Cmd TLVs: RF Off `83 00` (5.3.5.3.3, "This command
 * turns off the antenna field"), Timer `5F 46 04 [TIME]` (5.3.5.3.5, "If there is a timer
 * data object with 5000 µs between RF Turn Off Data Object and RF Turn On Data Object,
 * the reader will turn off the RF field for about 5000µs before it is turned on"), and
 * RF On `84 00` (5.3.5.3.4). Lc is 2 + 7 + 2 = 11, `0B`. Le is left out, as in the manual's
 * own examples of the RF objects, 5.3.5.6 steps 2 and 3 ("FF C2 00 00 02 83 00", "FF C2
 * 00 00 02 84 00"); the Le column of 5.3.5.3 reads "--/00h".
 *
 * **Why it exists (review finding F3).** The proof that protection took needs a tag that
 * no longer has a password presented. Releasing the PC/SC card with SCARD_UNPOWER_CARD was
 * assumed to drop the field, and PC/SC does not promise that on a contactless reader. If
 * the field stayed up, the password presented before Write Password would still apply, the
 * proof write would be accepted, and a protected tag would be reported as not protected.
 * This cycles the field explicitly, inside the proof's own session, by the manual's bytes.
 */
export const ACS_RF_CYCLE = Uint8Array.from([
  0xff, 0xc2, 0x00, 0x00, 0x0b,
  0x83, 0x00,
  0x5f, 0x46, 0x04, RF_OFF_US & 0xff, (RF_OFF_US >>> 8) & 0xff, (RF_OFF_US >>> 16) & 0xff, (RF_OFF_US >>> 24) & 0xff,
  0x84, 0x00,
]);

/**
 * How long the reader waits for the tag's answer to one transceived frame, in
 * microseconds.
 *
 * 5.3.5.4.3: "If no timer data object was defined in the data field, the reader will
 * wait for the duration given in the Set Parameter FWTI Data Object. If no FWTI is set,
 * the reader will wait for about 302 µs." An ISO 15693 tag does not even begin to answer
 * until about 320 µs after the request (t1 in ISO/IEC 15693-3), and WritePassword,
 * WriteConfiguration and GetRandomNumber program EEPROM before they answer: they are
 * "write-alike" commands (DS13304 6.4.17, 6.4.18, 6.4.24), with a write time Wt of
 * "Max 32 bits of data - 4 - ms" typical (Table 172) and "typical 5 ms per block" (features
 * list). So every exchange carries its own Timer data object. **50 ms is deliberately
 * generous**: ten times the typical write time. A timeout that is too short is the dangerous direction, because an
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
 * The 92 and 96 objects must both be present, since the manual's success shape
 * always carries them, and must report all bits valid and no error: a reader that left
 * 96 out would leave a CRC error unseen, so its absence fails closed (review finding F9).
 * Exactly one 97 object must carry the tag's answer. Exported for the tests.
 */
export function parseTransceiveAnswer(response: Uint8Array): TagAnswer {
  const noAnswer = (reason: string): TagAnswer => ({ kind: 'no-answer', reason });
  if (sw(response) !== SW_OK) return noAnswer(`status word 0x${sw(response).toString(16)}`);
  const tlvs = parseBerTlv(body(response));
  if (tlvs === null) return noAnswer(`a malformed data field, ${hex(body(response))}`);

  const seen = new Set<number>();
  let status: Uint8Array | null = null;
  let tagData: Uint8Array | null = null;
  let bitFramingSeen = false;
  let responseStatusSeen = false;
  for (const tlv of tlvs) {
    if (seen.has(tlv.tag)) return noAnswer(`data object 0x${tlv.tag.toString(16)} appears twice`);
    seen.add(tlv.tag);
    if (tlv.tag === TLV_STATUS) {
      status = tlv.value;
    } else if (tlv.tag === TLV_RX_BIT_FRAMING) {
      bitFramingSeen = true;
      if (tlv.value.length !== 1 || tlv.value[0] !== 0x00) return noAnswer(`receive bit framing ${hex(tlv.value)}, so the last byte was partial`);
    } else if (tlv.tag === TLV_RESPONSE_STATUS) {
      responseStatusSeen = true;
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
  const plainOk = flags === 0x00;
  const plainError = flags === ISO15693_RESPONSE_FLAG_ERROR && tagData.length === 2;
  if (!plainOk && !plainError) {
    return noAnswer(`ISO 15693 response flags 0x${flags.toString(16).padStart(2, '0')} with ${tagData.length - 1} byte(s) after them, which is neither a plain success nor a plain error`);
  }
  if (!bitFramingSeen) return noAnswer('no 92 receive bit framing object, which the manual\'s success shape always carries');
  if (!responseStatusSeen) return noAnswer('no 96 response status object, so a CRC, collision, parity or framing error could not be seen');
  if (plainOk) return { kind: 'ok', data: tagData.subarray(1) };
  return { kind: 'error', errorCode: tagData[1] ?? 0 };
}

/**
 * ISO/IEC 15693-3 error codes that mean the tag did not understand the request as a
 * command it implements. DS13304 Table 94: "01h Invalid IC Mfg code value 02h Invalid
 * request format 03h Invalid Request_flags value". A wrong password answered with one of
 * these proves nothing about the password, only that the frame was not taken as
 * PresentPassword.
 */
const ISO15693_ERRORS_NOT_UNDERSTOOD: readonly number[] = [0x01, 0x02, 0x03];

/**
 * The only answer to the proof write that counts as a protection refusal. **Confirmed by
 * the datasheet on Sunday 25 October 2026:** DS13304 Table 107, WriteSingleBlock error
 * codes, "12h Write access to requested block is protected and security session is
 * closed". (Until then it was ISO 15693-3 as commonly cited.) Any other answer fails
 * closed: the unit is recorded PROTECT_FAILED, never protected.
 */
export const ISO15693_ERROR_BLOCK_LOCKED = 0x12;

/**
 * ISO/IEC 15693-3 Write Single Block, an optional command of the standard.
 *
 * It goes through the Transparent Exchange (5.3.5.4), which forwards whatever frame it is
 * given, so no ACS table governs it. **The "21h ... Yes" row in 5.3.4.2.2 is not evidence
 * for this path:** that table lists what ACS tested through the separate `FF FB` pass
 * through command (5.3.4.2), which this tool does not use. (Corrected Sunday 25 October
 * 2026, review finding F10. The earlier comment cited it as the support claim.)
 */
const ISO15693_WRITE_SINGLE_BLOCK = 0x21;

/**
 * Builds an addressed ISO 15693 Write Single Block frame: flags `22h`, `21h`, the UID LSB
 * first, block number, data. For a standard command the UID follows the command code
 * directly, as in the manual's addressed Stay Quiet example "22 02 XX XX XX XX XX XX XX
 * XX" (5.3.4.2.1). Exported for the tests.
 */
export function writeSingleBlockFrame(uidMsbFirst: Uint8Array, block: number, data: Uint8Array): Uint8Array {
  if (block < 0 || block > 0xff) throw new Error(`Block ${block} does not fit a one byte block number.`);
  return Uint8Array.from([FLAGS_ADDRESSED, ISO15693_WRITE_SINGLE_BLOCK, ...uidOnAir(uidMsbFirst), block, ...data]);
}

/**
 * Decides whether the Present Password pair of the probe proved the command path. Pure, so
 * every way it can go wrong is tested without a reader. Exported for the tests.
 *
 * **"Different" is not enough. Both halves must be explicitly correct:**
 *   - the factory default must be an explicit tag level success: flags 00, nothing after
 *     (DS13304 Table 154, "00h");
 *   - the deliberately wrong password must be an explicit tag level error with exactly
 *     the code the datasheet gives for it, 0Fh, "Invalid Password_data value" (Table 155).
 *     Since Sunday 25 October 2026 any other code is refused too, which is stricter than
 *     the earlier "anything but 01, 02 or 03".
 * A timeout and a CRC error differ from each other, and proved nothing under the old rule.
 */
export function judgeOpcodeProbe(wrong: TagAnswer, right: TagAnswer): { proven: boolean; detail: string } {
  const seen = `The deliberately wrong password got ${describeProbeAnswer(wrong)}. The factory default got ${describeProbeAnswer(right)}.`;

  if (right.kind !== 'ok' || right.data.length !== 0) {
    return {
      proven: false,
      detail: `${seen} The factory default must be an explicit success (ISO 15693 flags 00, nothing after them) and was not, so the command path is unproven and the irreversible commands stay locked. Either this tag's password 1 is not the factory default, or a byte in the opcode, the flags, the address, the cover coding, the session framing or the reader wrapper is wrong.`,
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
      detail: `${seen} Error code 0x${hex2(wrong.errorCode)} means the tag did not take the frame as a command it implements, so the refusal says nothing about the password. The irreversible commands stay locked.`,
    };
  }
  if (wrong.errorCode !== ERROR_INVALID_PASSWORD_DATA) {
    return {
      proven: false,
      detail: `${seen} The datasheet's answer to a wrong password is error 0x0f, "Invalid Password_data value" (DS13304 Table 155), and this was 0x${hex2(wrong.errorCode)}. The irreversible commands stay locked.`,
    };
  }
  return {
    proven: true,
    detail: `${seen} The tag accepted the factory default and refused the wrong password with error 0x0f, so the GetRandomNumber, cover coding, PresentPassword and addressing path is confirmed on this tag.`,
  };
}

/**
 * What the rest of the probe saw: the configuration password and three configuration
 * registers. All of them are read or presented without changing anything.
 */
export interface ProbePreconditions {
  readonly configPassword: TagAnswer;
  readonly rwProtectionA1: TagAnswer;
  readonly endA1: TagAnswer;
  readonly lckConfig: TagAnswer;
}

/**
 * The second half of the probe, added Sunday 25 October 2026 from the datasheet. It makes
 * the gate stricter: the irreversible pair runs only on a tag where it can complete, so a
 * password is never changed on a tag whose protection then cannot be applied. Pure and
 * exported for the tests. Requires:
 *   - PWD_CFG, Password_id 00h, to accept its factory value (Table 17, "00000000h"), because
 *     RW_PROTECTION_A1 can only be written in the CONFIG session (Table 10);
 *   - RW_PROTECTION_A1 to read 00h: AREA1 not yet protected (Table 11, factory "00b");
 *   - END_A1 to read 4Fh, END_MEM: single area mode, so PWD_A1 is the 64 bit password this
 *     tool holds (Table 27) and AREA1 covers the whole user memory (Table 13);
 *   - LCK_CONFIG b0 and b1 clear: RW_PROTECTION_A1 and END_A1 are not permanently locked
 *     (Table 7, 5.1.4).
 */
export function judgeProbePreconditions(seen: ProbePreconditions): { proven: boolean; detail: string } {
  const fail = (why: string) => ({ proven: false, detail: `${why} The irreversible commands stay locked.` });
  const c = seen.configPassword;
  if (c.kind !== 'ok' || c.data.length !== 0) {
    return fail(`The configuration password (Password_id 00h) got ${describeProbeAnswer(c)} to its factory value. Area protection is written only in the CONFIG session, so it could not be applied after the password change.`);
  }
  const one = (a: TagAnswer, name: string, bytes: number): number[] | string =>
    a.kind === 'ok' && a.data.length === bytes ? Array.from(a.data) : `${name} could not be read (${describeProbeAnswer(a)})`;
  const rw = one(seen.rwProtectionA1, 'RW_PROTECTION_A1', 1);
  if (typeof rw === 'string') return fail(`${rw}.`);
  if (rw[0] !== 0x00) return fail(`RW_PROTECTION_A1 reads 0x${hex2(rw[0] ?? 0)}, so AREA1 is already protected or configured (factory value 00h, DS13304 Table 11).`);
  const end = one(seen.endA1, 'END_A1', 1);
  if (typeof end === 'string') return fail(`${end}.`);
  if (end[0] !== END_MEM_ST25TV02KC) return fail(`END_A1 reads 0x${hex2(end[0] ?? 0)}, not 0x${hex2(END_MEM_ST25TV02KC)} (END_MEM), so the tag is in dual area mode, or its END_MEM has been reduced by a TruST25 configuration (DS13304 section 5.6), and PWD_A1 is not the 64 bit password over the whole 80 block memory that this tool holds (DS13304 Tables 13 and 27).`);
  const lck = one(seen.lckConfig, 'LCK_CONFIG', 2);
  if (typeof lck === 'string') return fail(`${lck}.`);
  if (((lck[0] ?? 0) & 0x03) !== 0) return fail(`LCK_CONFIG reads 0x${hex2(lck[1] ?? 0)}${hex2(lck[0] ?? 0)}, so the AREA1 configuration is permanently locked (DS13304 Table 7) and protection could not be applied.`);
  return {
    proven: true,
    detail: 'The configuration password is the factory value, AREA1 is unprotected, the tag is in single area mode and the AREA1 configuration is not locked.',
  };
}

function describeProbeAnswer(a: TagAnswer): string {
  return a.kind === 'ok'
    ? `success with ${a.data.length} byte(s) after the flags`
    : a.kind === 'error'
      ? `tag error code 0x${hex2(a.errorCode)}`
      : `no usable answer (${a.reason})`;
}

function hex2(n: number): string {
  return n.toString(16).padStart(2, '0');
}

/** Generous. A person is placing a tag on a reader by hand. */
const POLL_INTERVAL_MS = 100;

/**
 * How long PRESENT with MUTE is given to clear by itself before the tool connects anyway.
 *
 * A tag sliding into place can be caught mid activation and then settle. A tag that
 * stays mute is not retried by the service on its own: WinSCard and pcsc-lite power a
 * card up when it arrives and again when a client connects, not in between. So without
 * a connect a mute tag is never activated again until it is lifted off and put back,
 * and before this the tool waited the whole timeout and called it "no tag".
 *
 * Connecting is safe. It asks the reader to activate the tag again (ISO 15693 inventory
 * and select), which writes nothing, and a connection that succeeds goes through exactly
 * the UID and geometry checks every other tag does before anything is written.
 */
const MUTE_GRACE_MS = 1_000;

/**
 * How long a tag that arrived while the tool was watching is left before the first command.
 *
 * Measured from the field, Monday 26 October 2026: on Dan's Windows 11 machine the connect to
 * a tag the ACR1552U had just reported succeeded, and the first SCardTransmit after it failed
 * with SCARD_E_NO_SMARTCARD. The ACR1552U manual, 5.3.2, says Windows Smart Card Plug and Play
 * sends its own APDUs to a card "at the time of card present", so the moment a tag arrives is
 * the moment it is busiest. A third of a second is a pause a person does not notice.
 */
const ARRIVAL_SETTLE_MS = 300;

/**
 * Selecting a tag that is not ready is tried this many times in all, pausing
 * NOT_READY_RETRY_MS, then twice that, in between, before TAG_NOT_READY is raised.
 */
const NOT_READY_ATTEMPTS = 3;
const NOT_READY_RETRY_MS = 250;

/**
 * The PC/SC errors from SCardTransmit that are about the tag rather than the reader: the
 * connect succeeded, and then the tag was not there, not powered, reset by someone else,
 * or did not answer. None of them means the reader has gone, and closing and reopening the
 * reader does nothing for any of them. pcsc-mini's names, as it puts them in `code`.
 */
const TAG_NOT_READY_ERRORS: ReadonlySet<string> = new Set(['NoSmartCard', 'RemovedCard', 'ResetCard', 'UnpoweredCard', 'UnresponsiveCard']);

/**
 * What to do about another program on the same reader, in the words the Tag Tool page uses.
 *
 * Seen on Dan's screen recording of his first Tag Tool run, Monday 26 October 2026: a
 * program that starts with Windows read every tag the moment it arrived and typed its UID,
 * byte reversed, into whatever had the focus, over and over. That is GoToTags' keyboard
 * wedge. A program reading the tag at the same moment is also what loses it under this
 * tool's first command (SCARD_E_NO_SMARTCARD), or refuses the connect outright
 * (SCARD_E_SHARING_VIOLATION).
 */
export const OTHER_PROGRAM_REMEDY =
  'Usually this is GoToTags, which starts with Windows and reads every tag the moment it arrives: exit it from its icon near the clock (right click, Exit), or end it in Task Manager, and close any other NFC software.';

/**
 * The reader state flags that say a program has the card connected. Only evidence of
 * another program while this tool holds no connection of its own.
 */
const HELD_FLAGS = READER_STATE_FLAGS.EXCLUSIVE | READER_STATE_FLAGS.INUSE;

/** "EXCLUSIVE", "INUSE", or null when neither flag is set. */
function heldBy(raw: number): string | null {
  if ((raw & READER_STATE_FLAGS.EXCLUSIVE) !== 0) return 'EXCLUSIVE';
  if ((raw & READER_STATE_FLAGS.INUSE) !== 0) return 'INUSE';
  return null;
}

/** How the PC/SC card is let go of. See `releaseTag`. */
export type ReleaseDisposition = 'unpower' | 'leave';

/** Which TAG_ABSENT this is. Each one is named in the message the operator sees. */
export type TagAbsentCase = 'NO_TAG' | 'READER_GONE' | 'TAG_MUTE' | 'CONNECT_FAILED' | 'UID_REFUSED' | 'TAG_NOT_READY';

/** The result of `inspectTag`, which is what doctor prints about the tag on the reader. */
export interface TagInspection {
  readonly readerName: string;
  readonly presence: TagPresence;
  /** The reader state at the end, as `describeReaderState` writes it. */
  readonly readerState: string;
  /** True when the tool could connect to the tag and read its UID. */
  readonly selected: boolean;
  /** MSB first when it is an ISO 15693 UID, otherwise the bytes as the reader sent them. */
  readonly uid: string | null;
  /** What was found, or why the tag could not be selected. */
  readonly note: string;
}

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

/** The UID the transport holds as MSB first hex, back as bytes. */
function uidBytes(uidHex: string): Uint8Array {
  return Uint8Array.from(uidHex.match(/../g) ?? [], (b) => parseInt(b, 16));
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
  // Le is one byte. An 80 block part can be asked for more than that in one read, and
  // a length that wrapped would ask the reader for the wrong number of bytes.
  if (bytes < 1 || bytes > 0xff) {
    throw new ChipError(
      'READBACK_FAILED',
      `A single Read Binary carries 1 to 255 bytes, and ${count} block(s) is ${bytes}.`,
      'This is a bug in the caller rather than anything to do with the tag. Read in smaller spans.',
    );
  }
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
  /** Every reader the service announced, picked or not, so a wrong pick can be seen. */
  private readonly announcedReaders: string[] = [];
  /**
   * The UID of the one physical tag on which verifyOpcodes has confirmed the command
   * path, or null. **The proof belongs to that tag and that connection only.** It is
   * cleared when any tag is selected, when the tag is released, when the transport is
   * opened or closed, and on any transport error, and the irreversible commands also
   * re-read the UID from the field and require it to match before sending anything.
   */
  private provenUid: string | null = null;
  /**
   * Passwords this connection has presented successfully to the selected tag, by
   * Password_id, so WritePassword can present the current one again in its own session.
   * Held in memory only, and cleared with the proof.
   */
  private readonly presentedPasswords = new Map<number, Uint8Array>();
  /**
   * The value the last WritePassword in this proof was sent with, from the moment its frame
   * is handed to the reader, or null when none has been sent. Cleared with the proof.
   */
  private writtenPassword: Uint8Array | null = null;
  /**
   * The PWD_A1 value a successful PresentPassword has shown to open AREA1 on this tag, after
   * the probe and after the last WritePassword, or null. `setAreaProtection` refuses without
   * it, and once a WritePassword has gone out only the presentation of that exact value,
   * made straight after it, sets it (review finding N1). Cleared with the proof.
   */
  private area1Opens: Uint8Array | null = null;
  /** WritePassword and WriteConfiguration frames handed to the reader since this transport was made. See `irreversibleFramesSent`. */
  private irreversibleSent = 0;

  /** What the last wait for a tag ended on, so a tag arriving between two waits is seen to arrive. Null after open. */
  private lastPresence: TagPresence | null = null;

  private readonly loadBinding: PcscBindingLoader;
  private readonly readerTimeoutMs: number;
  private readonly muteGraceMs: number;
  private readonly arrivalSettleMs: number;
  private readonly notReadyRetryMs: number;

  constructor(
    private readonly readerNameFilter?: string,
    options: PcscTransportOptions = {},
  ) {
    this.loadBinding = options.loadBinding ?? loadPcscMini;
    this.readerTimeoutMs = options.readerTimeoutMs ?? 10_000;
    this.muteGraceMs = options.muteGraceMs ?? MUTE_GRACE_MS;
    this.arrivalSettleMs = options.arrivalSettleMs ?? ARRIVAL_SETTLE_MS;
    this.notReadyRetryMs = options.notReadyRetryMs ?? NOT_READY_RETRY_MS;
  }

  /**
   * How many irreversible frames (WritePassword B1h, WriteConfiguration A1h) this transport
   * has handed to the reader. It counts up immediately before the frame is transmitted, so a
   * refusal that sends nothing leaves it alone and a transmit that fails part way does not.
   * `UnitSession.protect` compares it before and after to tell "nothing irreversible was
   * sent" from "the tag may be locked" (review finding N3). Never goes down.
   */
  get irreversibleFramesSent(): number {
    return this.irreversibleSent;
  }

  /** The PC/SC name of the reader in use, or null before the first successful open. */
  get readerName(): string | null {
    return this.openedReaderName;
  }

  /** The other readers the service announced, which this transport did not pick. */
  get otherReaders(): readonly string[] {
    return this.announcedReaders.filter((name) => name !== this.openedReaderName);
  }

  async open(): Promise<void> {
    this.resetProof();
    this.lastPresence = null;
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
              if (!this.announcedReaders.includes(reader.name)) this.announcedReaders.push(reader.name);
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
    // The reader state saying the card is in use (INUSE) or held exclusively (EXCLUSIVE)
    // before this tool connected to it: another program has it.
    let otherProgram: string | null = null;
    for (let attempt = 1; ; attempt += 1) {
      const seen = await this.awaitTag(reader, timeoutMs);
      if (seen === 'reader-gone') {
        throw this.tagAbsent(
          reader,
          'READER_GONE',
          'The reader was disconnected while the tool waited for a tag.',
          'Check the USB cable and run the command again. If it repeats, plug the reader straight into the computer rather than through a hub.',
        );
      }
      if (seen === 'absent') {
        throw this.tagAbsent(
          reader,
          'NO_TAG',
          `No tag arrived on the reader within ${timeoutMs} ms.`,
          'Place one ST25TV02KC tag flat and centred on the reader, printed face towards it. By default the ACR1552U beeps once when it detects a tag: no beep means the reader is not seeing the tag at all. One at a time: two tags in the field collide and neither is selected. An on metal tag reads at a much shorter distance away from metal, so lay it directly on the reader. If the tag is on another reader listed above, pass --reader-name. If no tag ever makes this reader beep, unplug it and plug it back in.',
        );
      }

      // An existing connection is reused, as the previous binding did.
      if (!this.card) {
        otherProgram ??= heldBy(reader.state().raw & HELD_FLAGS);
        try {
          this.card = await reader.connect();
        } catch (err) {
          throw this.connectFailed(reader, seen, err);
        }
      }
      this.connected = true;

      try {
        return await this.identify(reader);
      } catch (err) {
        // Connected, and then the tag was not there to answer: SCARD_E_NO_SMARTCARD and its
        // kind. That is the tag not ready yet, or gone, never the reader. Let go of the dead
        // connection without powering the tag down, because powering it down is what makes
        // the reader drop it and find it again, and select it from scratch after a pause.
        const pcscCode = isChipError(err) ? err.detail.pcscCode : undefined;
        if (typeof pcscCode !== 'string' || !TAG_NOT_READY_ERRORS.has(pcscCode)) throw err;
        await this.releaseTag('leave');
        if (attempt >= NOT_READY_ATTEMPTS) {
          const step = isChipError(err) && typeof err.detail.step === 'string' ? err.detail.step : 'the first command';
          const why = isChipError(err) && typeof err.detail.pcscError === 'string' ? err.detail.pcscError : pcscCode;
          const elsewhere = otherProgram === null ? '' : ` Before the connect the reader reported the tag in use by another program (${otherProgram}).`;
          throw this.tagAbsent(
            reader,
            'TAG_NOT_READY',
            `The tag was not ready. The reader connected to it, and then ${step} found no tag: ${why}. Tried ${attempt} times.${elsewhere}`,
            `The tool tries again by itself. Keep the tag flat and still in the centre of the reader, printed face towards it. If it never becomes ready, another program is most likely reading the tag first. ${OTHER_PROGRAM_REMEDY} Then unplug the reader, plug it back in, and send this whole message if it still happens.`,
            { pcscCode, step, otherProgram },
          );
        }
        await new Promise((r) => setTimeout(r, this.notReadyRetryMs * attempt));
      }
    }
  }

  /** The UID and geometry checks on the connected tag. Read only. */
  private async identify(reader: PcscReaderHandle): Promise<TagIdentity> {
    const response = await this.transmit(getUidApdu(), 32, 'the UID read');
    if (sw(response) !== SW_OK) {
      throw this.tagAbsent(
        reader,
        'UID_REFUSED',
        `The reader connected to the tag but refused to report its UID (status 0x${sw(response).toString(16)}).`,
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
   * README section 6.3 step 2 says to confirm the geometry is 80 blocks of 4 bytes
   * (DS13304 Rev 7, section 4.2: END_MEM is 4Fh on ST25TV02KC). A constant cannot
   * confirm anything, so this reads block 79, the last the part should have, and then
   * block 80, one past it, and requires the first to succeed and the second to fail.
   * **A part that answers both is not the part this tool models**, and writing a 312
   * byte image to it could run off the end of its area.
   */
  private async probeBlockCount(): Promise<number> {
    const last = await this.transmit(readBinaryApdu(PART.blockCount - 1, 1), PART.blockSizeBytes + 2, `the geometry check's read of block ${PART.blockCount - 1}`);
    if (sw(last) !== SW_OK) {
      throw new ChipError(
        'TAG_NOT_ST25TV02KC',
        `Block ${PART.blockCount - 1} could not be read, so this tag has fewer than ${PART.blockCount} blocks.`,
        'ST25TV02KC has 80 blocks of 4 bytes (DS13304, END_MEM 4Fh). A smaller part is a different chip, an ST25TV512C has 16, and this tool will not write it. A genuine ST25TV02KC answers here unless its TruST25 configuration has reduced END_MEM, which DS13304 section 5.6 says can bring it to 3Dh. Report it with the UID rather than forcing it.',
      );
    }

    const past = await this.transmit(readBinaryApdu(PART.blockCount, 1), PART.blockSizeBytes + 2, `the geometry check's read of block ${PART.blockCount}`);
    if (sw(past) === SW_OK) {
      throw new ChipError(
        'TAG_NOT_ST25TV02KC',
        `Block ${PART.blockCount} answered a read, so this tag is larger than ST25TV02KC.`,
        'This is a bigger ST25 part. It is not what the redirect table and the 312 byte area calculation assume, so it is refused rather than half written.',
      );
    }

    return PART.blockCount;
  }

  /**
   * Waits for the reader to report a tag. Returns at once for PRESENT, and at the
   * deadline when there is none. PRESENT with MUTE is returned once it has lasted
   * MUTE_GRACE_MS, or at the deadline, so the caller connects to it: see MUTE_GRACE_MS.
   * A tag seen to arrive, during this wait or since the last one ended without it, is
   * left ARRIVAL_SETTLE_MS first and must still be PRESENT after it.
   */
  private async awaitTag(reader: PcscReaderHandle, timeoutMs: number): Promise<TagPresence> {
    const deadline = Date.now() + timeoutMs;
    let muteSince: number | null = null;
    let arrived = this.lastPresence !== null && this.lastPresence !== 'present';
    let settled = false;
    for (;;) {
      const presence = tagPresence(reader.state());
      const now = Date.now();
      if (presence === 'present' && arrived && !settled && this.arrivalSettleMs > 0) {
        settled = true;
        await new Promise((r) => setTimeout(r, this.arrivalSettleMs));
        continue;
      }
      if (presence === 'present' || presence === 'reader-gone') return (this.lastPresence = presence);
      arrived = true;
      if (presence === 'mute') {
        muteSince ??= now;
        if (now - muteSince >= this.muteGraceMs || now > deadline) return (this.lastPresence = 'mute');
      } else {
        muteSince = null;
        if (now > deadline) return (this.lastPresence = 'absent');
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
  }

  /**
   * A TAG_ABSENT that says which case it is, what the reader state was when it was
   * raised, and which reader, so a report from the field can be read without a rerun.
   */
  private tagAbsent(reader: PcscReaderHandle, which: TagAbsentCase, what: string, remedy: string, extra: ChipErrorDetail = {}): ChipError {
    const state = reader.state();
    const flags = describeReaderState(state);
    const others = this.otherReaders;
    const otherText = others.length > 0 ? ` Other readers attached: ${others.map((name) => `"${name}"`).join(', ')}.` : '';
    return new ChipError('TAG_ABSENT', `Case ${which}. ${what} Reader "${reader.name}", state ${flags}.${otherText}`, remedy, {
      case: which,
      readerName: reader.name,
      readerState: state.raw,
      readerFlags: flags,
      ...extra,
    });
  }

  private connectFailed(reader: PcscReaderHandle, seen: TagPresence, err: unknown): ChipError {
    const why = describePcscError(err).replace(/\.$/, '');
    const code = pcscErrorCode(err);
    const weakTag =
      'The tag is at the edge of the reader field. Lift it off, lay it flat in the centre of the reader with its printed face towards it, and retry. An on metal tag is tuned to have metal behind it and reads at a much shorter distance without it. If every tag does this, report this message with the tag type.';

    if (seen === 'mute') {
      return this.tagAbsent(
        reader,
        'TAG_MUTE',
        `The reader detects a tag (PRESENT) that did not answer activation (MUTE), and connecting to it again failed: ${why}.`,
        weakTag,
      );
    }

    // This tool holds no connection here, so a held card is another program's.
    const otherProgram = code === 'SharingViolation' ? 'SCARD_E_SHARING_VIOLATION' : heldBy(reader.state().raw & HELD_FLAGS);
    const exclusive = code === 'SharingViolation' || (reader.state().raw & READER_STATE_FLAGS.EXCLUSIVE) !== 0;
    const remedy = exclusive
      ? `Another application holds the reader exclusively. ${OTHER_PROGRAM_REMEDY} Then retry.`
      : code === 'RemovedCard' || code === 'NoSmartCard'
        ? `The tag left the field between being seen and being connected. Hold it still in the centre of the reader and retry. If it keeps happening, another program is probably reading the tag first. ${OTHER_PROGRAM_REMEDY}`
        : code === 'UnresponsiveCard' || code === 'UnpoweredCard'
          ? `${weakTag} If the tag is flat and centred and it still happens, another program may be reading it first. ${OTHER_PROGRAM_REMEDY}`
          : `Reseat the tag and try again. If it repeats, the tag may not be ISO 15693, or another program is holding the reader. ${OTHER_PROGRAM_REMEDY}`;
    return this.tagAbsent(reader, 'CONNECT_FAILED', `The reader saw a tag but could not connect to it: ${why}.`, remedy, { pcscCode: code, otherProgram });
  }

  /**
   * For doctor: is a tag on the reader, and can it be selected?
   *
   * Uses the same wait and the same MUTE policy as `waitForTag`, so what doctor says is
   * what a write would meet. Sends one APDU, the Get Data for the UID, which reads and
   * changes nothing, and powers the tag down afterwards. Never throws for a tag that is
   * missing or cannot be selected: that is the answer, and doctor prints it.
   *
   * It is a selection like any other, so it ends any opcode proof first and drops a
   * connection this transport holds: powering the tag down under a proven connection
   * would leave a proof standing for a tag that has since been reset.
   */
  async inspectTag(waitMs: number): Promise<TagInspection> {
    await this.releaseTag();
    const reader = this.requireReader();
    const presence = await this.awaitTag(reader, waitMs);
    const result = (selected: boolean, uid: string | null, note: string): TagInspection => ({
      readerName: reader.name,
      presence,
      readerState: describeReaderState(reader.state()),
      selected,
      uid,
      note,
    });

    if (presence === 'absent') return result(false, null, `no tag seen within ${waitMs} ms`);
    if (presence === 'reader-gone') return result(false, null, 'the reader was disconnected');

    let card: PcscCardHandle;
    try {
      card = await reader.connect();
    } catch (err) {
      const seen = presence === 'mute' ? 'it does not answer activation, and connecting again failed' : 'connecting failed';
      return result(false, null, `${seen}: ${describePcscError(err)}`);
    }
    try {
      const response = new Uint8Array(await card.transmit(getUidApdu()));
      if (sw(response) !== SW_OK) {
        return result(false, null, `connected, but the reader refused the UID read with status 0x${sw(response).toString(16)}`);
      }
      const after = presence === 'mute' ? ', after the tool connected to a mute tag' : '';
      const normalised = normaliseUid(body(response));
      if (!normalised) return result(false, hex(body(response)), `not an ISO 15693 UID, so not an ST25TV02KC${after}`);
      if (!isStMicroelectronics(normalised.uid)) {
        const maker = (normalised.uid[1] ?? 0).toString(16).padStart(2, '0');
        return result(false, hex(normalised.uid), `ISO 15693, manufacturer code 0x${maker}, so not STMicroelectronics${after}`);
      }
      return result(true, hex(normalised.uid), `ISO 15693, STMicroelectronics${after}`);
    } catch (err) {
      return result(false, null, `connected, but the UID read failed: ${describePcscError(err)}`);
    } finally {
      await card.disconnectUnpower().catch(() => undefined);
    }
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
        'If this is a tag from order SO4731, it is write protected and needs the ST25TV area password, which Trevean does not hold. Use a blank tag. See "Decision log", D45.',
      );
    }
  }

  // -------------------------------------------------------------------------
  // Protection.
  //
  // Every byte below is from the ST25TV02KC datasheet, DS13304 Rev 7, since Sunday 25
  // October 2026. See chip/st-custom.ts for what that corrected. The datasheet is not the
  // part, so the design that makes this shippable is unchanged: the non destructive
  // commands are probed against the physical chip, and the probe's result decides
  // whether the irreversible pair is allowed to run at all.
  // -------------------------------------------------------------------------

  /**
   * Runs `body` inside one ACS transparent session and closes it whatever happens. Throws,
   * with nothing further sent, when the session start, the optional RF cycle or the
   * protocol switch is refused, including a refusal hidden in a C0 object under a 90 00.
   * A transport error throws too, and clears the proof.
   *
   * One session per operation, so the GetRandomNumber that cover codes a password and the
   * password command it codes always travel in the same RF power up (DS13304 5.1.3: the
   * random number must have been fetched "since the latest boot").
   */
  private async inSession<T>(step: string, body: (exchange: (frame: Uint8Array) => Promise<TagAnswer>) => Promise<T>, options: { rfCycle?: boolean } = {}): Promise<T> {
    requireControlOk(await this.transmit(ACS_SESSION_START, 2), `start transparent session for ${step}`, []);
    try {
      if (options.rfCycle === true) {
        requireControlOk(await this.transmit(ACS_RF_CYCLE, 2), `turn the RF field off for ${RF_OFF_US / 1000} ms and on again before ${step}`, []);
      }
      requireControlOk(await this.transmit(ACS_SWITCH_ISO15693, 2), `switch protocol to ISO 15693 for ${step}`, [TLV_SWITCH_RESPONSE, TLV_ATR]);
      return await body(async (frame) => parseTransceiveAnswer(await this.transmit(transparentExchangeApdu(frame), 32)));
    } finally {
      // Always closes, even on failure. A reader left in a transparent session stops
      // auto polling and looks broken to the next person who picks it up.
      await this.transmit(ACS_SESSION_END, 2).catch(() => undefined);
    }
  }

  /** Sends one raw ISO 15693 frame in its own transparent session. See `inSession`. */
  private transceive(frame: Uint8Array, step: string, options: { rfCycle?: boolean } = {}): Promise<TagAnswer> {
    return this.inSession(step, (exchange) => exchange(frame), options);
  }

  /** The selected tag's UID as bytes, MSB first, or a refusal naming the command that was therefore not sent. */
  private selectedUidBytes(step: string): Uint8Array {
    const uid = this.currentUid;
    if (!this.connected || uid === null) {
      throw new ChipError(
        'PROTECT_FAILED',
        `No tag is selected, so ${step} has no UID to be addressed to. This command was not sent.`,
        'Select the tag again. This is a bug in the caller if it repeats.',
        { step },
      );
    }
    return uidBytes(uid);
  }

  /** Builds one ST custom frame addressed to the selected tag (review finding F1). */
  private stFrame(command: StCommand, params: readonly number[] = []): Uint8Array {
    return stRequest(command, this.selectedUidBytes(command.name), params);
  }

  /**
   * GetRandomNumber, inside a session. Returns RND_NUMBER, sent LSB first (Table 167 and
   * the 5.1.3 note), or throws: without it no password can be cover coded, so the
   * password command that was to follow is not sent.
   */
  private async randomNumber(exchange: (frame: Uint8Array) => Promise<TagAnswer>, step: string): Promise<number> {
    const answer = await exchange(this.stFrame(ST_COMMANDS.GET_RANDOM_NUMBER));
    if (answer.kind !== 'ok' || answer.data.length !== 2) {
      throw new ChipError(
        'PROTECT_FAILED',
        `GetRandomNumber before ${step} got no usable answer: ${describeAnswer(answer, 2)}. The password command was not sent.`,
        'Nothing irreversible reached the tag. Set the tag aside and record this message for the bring up notes.',
        { step },
      );
    }
    return (answer.data[0] ?? 0) | ((answer.data[1] ?? 0) << 8);
  }

  /** GetRandomNumber then PresentPassword, cover coded, inside a session. Returns the tag's answer to PresentPassword and the random number used. */
  private async presentIn(
    exchange: (frame: Uint8Array) => Promise<TagAnswer>,
    passwordId: number,
    passwordMsbFirst: Uint8Array,
  ): Promise<{ answer: TagAnswer; rnd: number }> {
    const rnd = await this.randomNumber(exchange, `PresentPassword ${passwordId}`);
    const answer = await exchange(this.stFrame(ST_COMMANDS.PRESENT_PASSWORD, [passwordId, ...coverCode(passwordMsbFirst, rnd)]));
    return { answer, rnd };
  }

  /** ReadConfiguration of one register, inside a session (Table 144). */
  private readConfigIn(exchange: (frame: Uint8Array) => Promise<TagAnswer>, register: ConfigRegister): Promise<TagAnswer> {
    return exchange(this.stFrame(ST_COMMANDS.READ_CONFIGURATION, [register.fid, register.pid]));
  }

  /**
   * Proves the command path on the tag in front of you, without changing it.
   *
   * This is the bring up step README section 6.3 asks for, made executable, and it runs
   * inside `--protect` itself, immediately before the first irreversible command (see
   * `UnitSession.protect`). In one transparent session, every frame addressed to the
   * selected UID, it sends:
   *
   *   1. GetRandomNumber, then PresentPassword 1 with a deliberately wrong password, cover
   *      coded. Required: error 0Fh (Table 155). "All security sessions are closed if an
   *      invalid value of Password_data is presented."
   *   2. GetRandomNumber again, which 5.1.3 requires after a failed presentation, then
   *      PresentPassword 1 with the factory default. Required: a plain success.
   *   3. GetRandomNumber, then PresentPassword 0 (PWD_CFG) with its factory value.
   *      Required: a plain success, because protection is written in the CONFIG session.
   *   4. ReadConfiguration of RW_PROTECTION_A1, END_A1 and LCK_CONFIG. Required: 00h, 4Fh,
   *      and LCK_A1 and LCK_A2 clear. See `judgeProbePreconditions`.
   *
   * Then it re-reads the UID from the field and requires it to be the selected tag. Only
   * then are the opcodes, the IC Mfg byte, the flags, the address, the cover coding, the
   * transparent session framing and the reader transceive wrapper shown to be right,
   * because nothing else produces that set of answers. GetRandomNumber, PresentPassword
   * and ReadConfiguration change nothing that matters (Table 24: the random number
   * register only).
   *
   * Any timeout, CRC error, transport error or unexpected shape at any step means NOT
   * proven. The proof is recorded against this tag's UID and is lost when any tag is
   * selected, when the tag is released, and on reopen or any transport error.
   *
   * It passes only on a tag whose password 1 AND configuration password are still the
   * factory default, and whose AREA1 is unprotected and unlocked. It presents password 1
   * and the configuration password and no other (review finding F6). Run it on a
   * SACRIFICIAL tag. Every run presents one wrong password, and the part has a failed
   * attempt limiter whose settings are only in ST application note AN5577, which is not
   * public (DS13304 5.1.2).
   */
  async verifyOpcodes(): Promise<{ proven: boolean; detail: string }> {
    this.resetProof();
    const uid = this.currentUid;
    if (!this.connected || uid === null) {
      return { proven: false, detail: 'No tag is selected, so there is nothing to prove the command path on.' };
    }

    const AREA1 = PASSWORD_ID.AREA1;
    let verdict: { proven: boolean; detail: string };
    try {
      verdict = await this.inSession('the opcode probe', async (exchange) => {
        const wrong = (await this.presentIn(exchange, AREA1, DELIBERATELY_WRONG_PASSWORD)).answer;
        const right = (await this.presentIn(exchange, AREA1, FACTORY_DEFAULT_PASSWORD)).answer;
        const pair = judgeOpcodeProbe(wrong, right);
        if (!pair.proven) return pair;
        const rest = judgeProbePreconditions({
          configPassword: (await this.presentIn(exchange, PASSWORD_ID.CONFIG, FACTORY_DEFAULT_CONFIG_PASSWORD)).answer,
          rwProtectionA1: await this.readConfigIn(exchange, CONFIG_REGISTERS.RW_PROTECTION_A1),
          endA1: await this.readConfigIn(exchange, CONFIG_REGISTERS.END_A1),
          lckConfig: await this.readConfigIn(exchange, CONFIG_REGISTERS.LCK_CONFIG),
        });
        return rest.proven ? { proven: true, detail: `${pair.detail} ${rest.detail}` } : { proven: false, detail: `${pair.detail} ${rest.detail}` };
      });
    } catch (cause) {
      this.resetProof();
      return {
        proven: false,
        detail: `The probe did not complete: ${cause instanceof Error ? cause.message : String(cause)} The irreversible commands stay locked.`,
      };
    }
    if (!verdict.proven) return verdict;

    // The answers came from whatever answered to the selected UID. Require it to be the
    // tag that was selected, read from the field now rather than remembered.
    const now = await this.readUidNow();
    if (now !== uid) {
      this.resetProof();
      return {
        proven: false,
        detail: `The probe answered correctly, but the tag in the field now reads uid ${now ?? 'unreadable'} and the selected tag was ${uid}. Nothing is proven.`,
      };
    }
    this.provenUid = uid;
    // The probe's last presentation opened the CONFIG session, so no AREA1 password is
    // known to be presented now. UnitSession presents it again before Write Password.
    this.presentedPasswords.clear();
    return verdict;
  }

  /**
   * GetRandomNumber then PresentPassword, cover coded, in one session. Non destructive.
   * Remembers the password for this tag and connection, so Write Password can present it
   * again in its own session (see `writePassword`).
   */
  async presentPassword(passwordNumber: number, password: Uint8Array): Promise<void> {
    assertPasswordLength(password);
    if (passwordNumber !== PASSWORD_ID.AREA1) {
      throw new ChipError('PROTECT_FAILED', `Password ${passwordNumber} is not one this tool presents. It presents PWD_A1, Password_id 01h.`, 'This is a bug in the caller. Report it.', { passwordNumber });
    }
    const { answer } = await this.inSession(ST_COMMANDS.PRESENT_PASSWORD.name, (exchange) => this.presentIn(exchange, passwordNumber, password));

    if (answer.kind === 'error' && answer.errorCode === ERROR_INVALID_PASSWORD_DATA) {
      this.presentedPasswords.delete(passwordNumber);
      throw new ChipError(
        'PASSWORD_REJECTED',
        `The tag refused password ${passwordNumber} with error 0x0f, "Invalid Password_data value" (DS13304 Table 155).`,
        'The password is wrong. On an SO4731 tag it is wrong, and Trevean does not hold the right one. See "Decision log", D45.',
        { passwordNumber, errorCode: answer.errorCode },
      );
    }
    if (answer.kind !== 'ok' || answer.data.length !== 0) {
      this.presentedPasswords.delete(passwordNumber);
      throw new ChipError(
        'PROTECT_FAILED',
        `PresentPassword got no usable answer from the tag: ${describeAnswer(answer, 0)}.`,
        'This is not evidence of a wrong password, and nothing was written. It is the ST command path through the reader failing. Set the tag aside and record this message for the bring up notes.',
        { passwordNumber },
      );
    }
    this.presentedPasswords.set(passwordNumber, Uint8Array.from(password));
    // Before any WritePassword this is the password that opens AREA1. After one, only the
    // check inside `writePassword` may say which value opens it.
    if (this.writtenPassword === null) this.area1Opens = Uint8Array.from(password);
  }

  /**
   * WritePassword. **IRREVERSIBLE.** Gated.
   *
   * In one session: GetRandomNumber, PresentPassword with the password this connection
   * last presented successfully, then WritePassword with the new value cover coded with
   * the same random number. "WritePassword command is applicable and successful, if and
   * only if it preceded by a successful PresentPassword command with same password
   * selected" (6.4.18), and the random number may be reused after a successful
   * presentation (5.1.3 note). Doing both in one session means the AREA1 security session
   * cannot have closed in between, whatever the reader does to the field between
   * transparent sessions. If the presentation is refused, WritePassword is not sent.
   */
  async writePassword(passwordNumber: number, password: Uint8Array): Promise<void> {
    assertPasswordLength(password);
    await this.requireProvenOpcodes('change a password');
    // Two guards, each with its own message, so a test can tell which one held (review
    // finding N5, mutation X7): the password id first, then the current value.
    if (passwordNumber !== PASSWORD_ID.AREA1) {
      throw new ChipError(
        'PROTECT_FAILED',
        `Refusing to change password ${passwordNumber}: this tool changes only PWD_A1, Password_id 01h. This command was not sent.`,
        'This is a bug in the caller. Report it.',
        { passwordNumber },
      );
    }
    const current = this.presentedPasswords.get(passwordNumber);
    if (current === undefined) {
      throw new ChipError(
        'PROTECT_FAILED',
        `Refusing to change password ${passwordNumber}: its current value has not been presented successfully on this tag in this connection. This command was not sent.`,
        'This is a bug in the caller. Report it.',
        { passwordNumber },
      );
    }

    const result = await this.inSession(ST_COMMANDS.WRITE_PASSWORD.name, async (exchange) => {
      const presented = await this.presentIn(exchange, passwordNumber, current);
      if (presented.answer.kind !== 'ok' || presented.answer.data.length !== 0) {
        throw new ChipError(
          'PROTECT_FAILED',
          `The current password was not accepted immediately before WritePassword: ${describeAnswer(presented.answer, 0)}. WritePassword was not sent.`,
          'The password was not changed. Set the tag aside and record this message for the bring up notes.',
          { passwordNumber },
        );
      }
      const frame = this.stFrame(ST_COMMANDS.WRITE_PASSWORD, [passwordNumber, ...coverCode(password, presented.rnd)]);
      // From here the old password may no longer open the tag, whatever comes back.
      this.presentedPasswords.delete(passwordNumber);
      this.area1Opens = null;
      this.writtenPassword = Uint8Array.from(password);
      this.irreversibleSent += 1;
      const written = await exchange(frame);
      if (written.kind !== 'ok' || written.data.length !== 0) return { written, check: null };
      // Review finding N1. A plain 00 to WritePassword says the tag stored something, not
      // what: "If a plain value is mistakenly used in the Password_data field of the
      // WritePassword command, the presentation of its encrypted value with the
      // PresentPassword command fails" (6.4.18). So present the new value now, in the same
      // session, which stays open after a successful WritePassword (Table 151), and require
      // a plain success before anything else is sent. A fresh GetRandomNumber, so the check
      // does not reuse the random number B1 was coded with.
      // Any throw here, a GetRandomNumber with no usable answer included, is the same
      // outcome: the new password is not shown to open the tag (review finding L2).
      let check: TagAnswer;
      try {
        check = (await this.presentIn(exchange, passwordNumber, password)).answer;
      } catch (cause) {
        return { written, check: null, checkFailure: (cause instanceof Error ? cause.message : String(cause)).replace(/\.$/, '') };
      }
      if (check.kind === 'ok' && check.data.length === 0) {
        this.presentedPasswords.set(passwordNumber, Uint8Array.from(password));
        this.area1Opens = Uint8Array.from(password);
      }
      return { written, check };
    });
    const { written, check } = result;
    const checkFailure = 'checkFailure' in result ? result.checkFailure : undefined;
    if (written.kind !== 'ok' || written.data.length !== 0) {
      throw new ChipError(
        'PROTECT_FAILED',
        `Writing password ${passwordNumber} was not confirmed by the tag: ${describeAnswer(written, 0)}.`,
        'Set the tag aside, label it, and do not record it as protected. If the tag gave no answer, it may or may not now hold the new password, which is the one in the secret store: write down the fingerprint the tool printed with this run. DS13304 6.4.18: "There is no anti-tearing mechanism while operating the WritePassword command". Do not retry on this tag.',
        { passwordNumber },
      );
    }
    if (check === null || check.kind !== 'ok' || check.data.length !== 0) {
      throw new ChipError(
        'PROTECT_FAILED',
        `WritePassword was accepted but the new password does not open the tag. Area protection was NOT applied; the tag is still writable; its password 1 is unknown. PresentPassword with the new password, straight after WritePassword, ${checkFailure !== undefined ? `failed: ${checkFailure}` : `got ${check === null ? 'nothing' : describeAnswer(check, 0)}`}.`,
        'STOP, and stop the batch. Do not protect, ship or retry this tag: label it "PASSWORD UNKNOWN, NOT PROTECTED". It still reads and its URL is right, but no one holds its password 1. This means the tool, the reader or the part codes WritePassword differently from the PresentPassword the probe proved, so it would happen again on every tag. Copy this whole message into the bring up notes and report it the same day.',
        { passwordNumber, passwordUnknown: true, areaProtectionSent: false },
      );
    }
  }

  /**
   * Writes RW_PROTECTION_A1 = 01b, "write allowed if AREA1 security session is open"
   * (Table 11). **IRREVERSIBLE without PWD_A1.** Gated.
   *
   * In one session: GetRandomNumber, PresentPassword 0 with the factory configuration
   * password (the probe has just shown it is the factory value), then WriteConfiguration
   * FID 00h PID 00h value 01h (Tables 4, 10 and 147). There is no password number in the
   * register: PWD_A1 always governs AREA1 (Table 26), so anything but area 1 under
   * password 1 is refused. Only write protection is ever written: 10b and 11b would make
   * the area unreadable to a phone.
   *
   * "W effective time : on next RF boot sequence" (Table 10). The value is readable at
   * once (6.4.17), and the tag enforces it only from its next power up, which is why the
   * proof write cycles the field first.
   *
   * **What this does not do.** PWD_CFG stays at its factory value, and LCK_CONFIG is never
   * written. So anyone who presents the factory configuration password can write
   * RW_PROTECTION_A1 back to 00b, and could also use the Kill command, which takes PWD_CFG
   * (6.4.20). Changing PWD_CFG or locking the configuration is a separate decision for
   * Trevean, README section 11.
   */
  async setAreaProtection(area: number, protection: AreaProtection, passwordNumber: number): Promise<void> {
    await this.requireProvenOpcodes('apply area protection');
    if (area !== 1 || passwordNumber !== PASSWORD_ID.AREA1 || protection !== 'write_protected') {
      throw new ChipError(
        'PROTECT_FAILED',
        `Refusing to set area ${area} to "${protection}" under password ${passwordNumber}: this tool writes only RW_PROTECTION_A1 = 01b, write protection of area 1 under PWD_A1 (DS13304 Tables 11 and 26). This command was not sent.`,
        'This is a bug in the caller. Report it.',
        { area, passwordNumber },
      );
    }

    // Review finding N1: protection is applied only under a password this connection has
    // seen open AREA1, and after a WritePassword only under the value it wrote, checked
    // straight after it. Otherwise a wrong WritePassword would end in a protected tag whose
    // password nobody holds, which is the SO4731 failure.
    const opens = this.area1Opens;
    const written = this.writtenPassword;
    if (opens === null || (written !== null && hex(opens) !== hex(written))) {
      throw new ChipError(
        'PROTECT_FAILED',
        `Refusing to apply area protection: ${written === null ? 'no password 1 has been shown to open AREA1 on this tag in this connection' : 'the password written by WritePassword has not been shown to open the tag since'}. This command was not sent.`,
        'This is a bug in the caller. Report it. Area protection was not applied.',
        { area, passwordNumber },
      );
    }

    const answer = await this.inSession(ST_COMMANDS.WRITE_CONFIGURATION.name, async (exchange) => {
      const config = (await this.presentIn(exchange, PASSWORD_ID.CONFIG, FACTORY_DEFAULT_CONFIG_PASSWORD)).answer;
      if (config.kind !== 'ok' || config.data.length !== 0) {
        throw new ChipError(
          'PROTECT_FAILED',
          `The factory configuration password was not accepted immediately before WriteConfiguration: ${describeAnswer(config, 0)}. WriteConfiguration was not sent.`,
          'Area protection was not applied.',
          { area },
        );
      }
      const r = CONFIG_REGISTERS.RW_PROTECTION_A1;
      const frame = this.stFrame(ST_COMMANDS.WRITE_CONFIGURATION, [r.fid, r.pid, RW_PROTECTION_WRITE_PROTECTED]);
      this.irreversibleSent += 1;
      return exchange(frame);
    });
    // The CONFIG session closed any AREA1 session.
    this.presentedPasswords.clear();
    if (answer.kind !== 'ok' || answer.data.length !== 0) {
      throw new ChipError(
        'PROTECT_FAILED',
        `Setting protection on area ${area} was not confirmed by the tag: ${describeAnswer(answer, 0)}.`,
        'Set the tag aside, label it, and do not record it as protected. If the tag gave no answer, the area may or may not now be protected under the password in the secret store. Do not retry on this tag.',
        { area, passwordNumber },
      );
    }
  }

  /**
   * Reads RW_PROTECTION_A1 with ReadConfiguration A0h, FID 00h PID 00h (Tables 4 and 144).
   *
   * **Still GATED,** although the datasheet now documents a safe read ("R : always
   * possible", Table 10). Taking the gate off is a change to D66 and is left for review:
   * see the report of Sunday 25 October 2026. The value read is the stored one, which
   * "is immediately readable with a ReadConfiguration request" after it is written, while
   * the tag enforces it only from its next RF boot (6.4.17).
   */
  async readAreaProtection(area = 1): Promise<AreaProtectionState> {
    await this.requireProvenOpcodes('read area protection');
    if (area !== 1) {
      throw new ChipError('PROTECT_FAILED', `This tool reads the protection of area 1 only, not area ${area}. This command was not sent.`, 'This is a bug in the caller. Report it.', { area });
    }

    const answer = await this.inSession(ST_COMMANDS.READ_CONFIGURATION.name, (exchange) => this.readConfigIn(exchange, CONFIG_REGISTERS.RW_PROTECTION_A1));
    const value = answer.kind === 'ok' && answer.data.length === 1 ? (answer.data[0] ?? 0) : null;
    if (value === null || (value & 0xfc) !== 0) {
      throw new ChipError(
        'PROTECT_FAILED',
        `The tag did not report protection for area ${area}: ${value === null ? describeAnswer(answer, 1) : `RW_PROTECTION_A1 reads 0x${hex2(value)}, with reserved bits b7 to b2 set`}.`,
        'The protection command before it may still have taken effect. Set the tag aside, label it LOCKED?, and do not record it as protected.',
        { area },
      );
    }

    const bits = value & 0x03;
    return {
      protection: bits === 0x00 ? 'none' : bits === 0x01 ? 'write_protected' : 'read_and_write_protected',
      // Table 26: PWD_A1 governs AREA1. The register carries no password number.
      passwordNumber: PASSWORD_ID.AREA1,
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
   * Three things make sure the verdict is about the right tag in the right state:
   *   - `expectedUid`, the UID the unit selected at the start, must be the selected UID
   *     and the UID read from the field now (review finding F8). Nothing is sent otherwise;
   *   - inside the proof's own session, before the write, the RF field is turned off for
   *     10 ms and on again by the manual's bytes, `ACS_RF_CYCLE`, so no password presented
   *     earlier can still apply (review finding F3);
   *   - the write is addressed to that UID, so no other tag in the field takes it (F1).
   *
   * It is not gated by the probe. It cannot be: the proof runs after the tag has left the
   * field, which clears the probe, and after the password has changed, so the probe cannot
   * pass again. It writes nothing that is not already there, so it is no more dangerous
   * than the Update Binary it replaces.
   */
  async proveWriteRefused(block: number, data: Uint8Array, expectedUid: string | null): Promise<'refused' | 'accepted'> {
    if (data.length !== PART.blockSizeBytes) {
      throw new ChipError('PROTECT_FAILED', `The proof write must be exactly ${PART.blockSizeBytes} bytes.`, 'This is a bug in the caller. Report it.');
    }
    const uid = await this.requireUnitTag(expectedUid, 'The proof write');
    const answer = await this.transceive(writeSingleBlockFrame(uidBytes(uid), block, data), 'Write Single Block', { rfCycle: true });
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
   * The unlock proof, after the refusal proof (review finding N1, the optional check made
   * part of every run). In a new transparent session: GetRandomNumber, PresentPassword 1
   * with `password`, the value this run wrote, then the same addressed Write Single Block of
   * the bytes the block already holds. Both must be a plain success. That shows the
   * password the operator records opens this tag after protection, which neither the probe
   * (factory default only) nor the refusal proof can show.
   *
   * Like the refusal proof it is not gated, for the same reason, and it checks the UID the
   * same way before sending anything. After a successful write it cycles the RF field in a
   * session of its own, so the tag is left with every security session closed and does not
   * rely on the reader dropping the field on release (review finding L1).
   */
  async proveWriteUnlocked(block: number, data: Uint8Array, passwordNumber: number, password: Uint8Array, expectedUid: string | null): Promise<void> {
    assertPasswordLength(password);
    if (data.length !== PART.blockSizeBytes || passwordNumber !== PASSWORD_ID.AREA1) {
      throw new ChipError('PROTECT_FAILED', `The unlock proof takes exactly ${PART.blockSizeBytes} bytes and password 1.`, 'This is a bug in the caller. Report it.');
    }
    const uid = await this.requireUnitTag(expectedUid, 'The unlock proof write');
    const { presented, write } = await this.inSession('the unlock proof', async (exchange) => {
      const answer = (await this.presentIn(exchange, passwordNumber, password)).answer;
      if (answer.kind !== 'ok' || answer.data.length !== 0) return { presented: answer, write: null };
      return { presented: answer, write: await exchange(writeSingleBlockFrame(uidBytes(uid), block, data)) };
    });
    if (presented.kind !== 'ok' || presented.data.length !== 0) {
      throw new ChipError(
        'PROTECT_FAILED',
        `After protection, the password this run wrote did not open the tag: PresentPassword ${passwordNumber} got ${describeAnswer(presented, 0)}. The unlock proof write was not sent.`,
        'STOP. The tag refuses writes and the recorded password does not open it. Label it LOCKED? and report it the same day.',
        { passwordNumber },
      );
    }
    if (write === null || write.kind !== 'ok' || write.data.length !== 0) {
      throw new ChipError(
        'PROTECT_FAILED',
        `With the password this run wrote presented, the unlock proof write to block ${block} got ${write === null ? 'nothing' : describeAnswer(write)} rather than a plain success.`,
        'STOP. Label the tag LOCKED? and report it the same day. The block was rewritten with the bytes it already held, if at all.',
        { block, passwordNumber },
      );
    }
    await this.inSession('close the unlock session', async () => undefined, { rfCycle: true });
  }

  /**
   * The unit's own tag, read from the field now, or a refusal with nothing else sent
   * (review finding F8). `what` names the command that was therefore not sent.
   */
  private async requireUnitTag(expectedUid: string | null, what: string): Promise<string> {
    const selected = this.currentUid;
    const now = this.connected && selected !== null ? await this.readUidNow() : null;
    if (expectedUid === null || selected !== expectedUid || now !== expectedUid) {
      throw new ChipError(
        'TAG_CHANGED',
        `${what} was not sent: this unit's tag is uid ${expectedUid ?? 'unknown'}, the selected tag is uid ${selected ?? 'none'} and the tag in the field reads uid ${now ?? 'unreadable'}.`,
        'Set every tag in reach aside and label them. Do not record any of them as protected.',
        { expectedUid, selectedUid: selected, fieldUid: now },
      );
    }
    return expectedUid;
  }

  /**
   * The gate. The irreversible commands (WritePassword, WriteConfiguration) and the
   * protection read do not run unless the probe passed on the tag that is in the field
   * right now.
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

  /**
   * Ends the connection to the tag. `unpower`, the default, is the only one the write and
   * protection paths use. `leave` is for letting go after a read only detection, the Tag
   * Tool's polls and a tag that was not ready, and for nothing else.
   */
  async releaseTag(disposition: ReleaseDisposition = 'unpower'): Promise<void> {
    this.resetProof();
    const card = this.card;
    if (!this.reader || !this.connected || !card) return;

    // Unpower rather than leave: dropping the field is what makes a presented password
    // stop applying, which is how the verify step proves protection actually took hold
    // rather than merely being accepted. A failure to disconnect is ignored, as before:
    // the connection is gone either way.
    //
    // Leave, when asked, because unpowering after every read only poll makes the ACR1552U
    // drop the tag and find it again, and the next poll's connect races that. It sent a
    // tag that had answered nothing yet round that loop on Dan's machine, 26 October 2026.
    await (disposition === 'leave' ? card.disconnectLeave() : card.disconnectUnpower()).catch(() => undefined);
    this.card = null;
    this.connected = false;
    this.currentUid = null;
  }

  private resetProof(): void {
    this.provenUid = null;
    this.presentedPasswords.clear();
    this.writtenPassword = null;
    this.area1Opens = null;
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
  private async transmit(apdu: Uint8Array, expectedLen: number, step?: string): Promise<Uint8Array> {
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
      // The PC/SC error and the step go in the detail, so a caller can tell a tag that was
      // not ready from a reader that failed. The message and the code are as they were.
      const pcscError = describePcscError(err);
      throw new ChipError(
        'TRANSPORT_UNAVAILABLE',
        `The reader rejected a command: ${pcscError}`,
        'Reseat the tag. If it repeats, close any other application holding the reader.',
        { pcscCode: pcscErrorCode(err), pcscError, step: step === undefined ? null : `${step} (${hexSpaced(apdu)})` },
      );
    }
  }
}

/** "FF CA 00 00 00", as the ACS manual writes an APDU. */
function hexSpaced(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
}

function describeAnswer(answer: TagAnswer, expectedBytes = 0): string {
  if (answer.kind === 'no-answer') return answer.reason;
  if (answer.kind === 'error') return `tag error code 0x${answer.errorCode.toString(16).padStart(2, '0')}`;
  return `success flags with ${answer.data.length} byte(s) after them where ${expectedBytes} were expected`;
}

function gateRefusal(action: string, reason: string): ChipError {
  return new ChipError(
    'PROTECT_FAILED',
    `Refusing to ${action}: ${reason}. This command was not sent.`,
    'The opcode probe runs automatically as part of --protect, on the tag in the field, immediately before the first irreversible command, and passes only on a tag whose password 1 and configuration password are still the factory default. Use a sacrificial tag for bring up. The commands come from the ST25TV02KC datasheet and have never run on the part, and an irreversible command sent on an unproven path can lock a tag with a value nobody holds. See README section 6.4, chip/st-custom.ts and "Decision log", D45 and D66.',
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
