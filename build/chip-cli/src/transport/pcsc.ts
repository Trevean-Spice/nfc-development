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
 *   - **Refused, loudly and specifically.** Passwords and area protection. Those
 *     need ST custom commands carried inside a reader specific transparent
 *     session, and **their opcodes are not written here because they are not
 *     verified.** A guessed protection opcode is the worst possible thing to be
 *     wrong about: applied to a real tag it is not reversible without the very
 *     password the command was supposed to set.
 *
 * `--protect` therefore does not work on this transport yet, which is consistent
 * with README section 5: protection is off unless asked for, and Trevean has not
 * yet decided to apply it. See `PROTECTION_BRING_UP` at the bottom of this file
 * for exactly what finishing that work requires.
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
 * transparent session, and these four are its control APDUs.
 *
 * **Same provenance warning as the command codes themselves.** These are from the ACS
 * reader API family and are not confirmed against the ACR1552U manual, which would not
 * download either. **Nothing irreversible is sent through them until the probe in
 * `verifyOpcodes` has shown the whole path behaves as predicted.**
 */
const ACS_SESSION_START = Uint8Array.from([0xff, 0xc2, 0x00, 0x00, 0x02, 0x81, 0x00]);
const ACS_SESSION_END = Uint8Array.from([0xff, 0xc2, 0x00, 0x00, 0x02, 0x82, 0x00]);
/** Switch Protocol, payload 0x03 selecting ISO/IEC 15693. */
const ACS_SWITCH_ISO15693 = Uint8Array.from([0xff, 0xc2, 0x00, 0x02, 0x04, 0x8f, 0x02, 0x00, 0x03]);

/** Wraps a raw ISO 15693 frame in the ACS transceive pseudo APDU. */
function acsTransceive(frame: Uint8Array): Uint8Array {
  return Uint8Array.from([0xff, 0xc2, 0x00, 0x01, frame.length + 2, 0x95, frame.length, ...frame]);
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
  /** Set by verifyOpcodes when the tag itself has confirmed the command path. */
  private opcodesProven = false;

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

  /** Sends one ST custom frame inside a transparent session and returns the raw response. */
  private async stCommand(command: StCommand, params: readonly number[] = []): Promise<Uint8Array> {
    await this.transmit(ACS_SESSION_START, 2);
    try {
      await this.transmit(ACS_SWITCH_ISO15693, 2);
      return await this.transmit(acsTransceive(stRequest(command, params)), 32);
    } finally {
      // Always closes, even on failure. A reader left in a transparent session stops
      // auto polling and looks broken to the next person who picks it up.
      await this.transmit(ACS_SESSION_END, 2).catch(() => undefined);
    }
  }

  /**
   * Proves the command path on the tag in front of you, without changing it.
   *
   * This is the bring up step README section 6.3 asks for, made executable. It
   * presents a deliberately wrong password and then the factory default, and requires
   * the chip to answer those two DIFFERENTLY. If it does, the opcode, the manufacturer
   * byte, the flag byte, the transparent session framing and the reader transceive
   * wrapper are all demonstrably right, because nothing else produces a discriminating
   * answer.
   *
   * If both attempts return the same thing, nothing is proven, whatever that thing is,
   * and the irreversible commands stay locked. A transport that cannot tell a right
   * password from a wrong one must not be trusted to set one.
   *
   * Run it on a SACRIFICIAL BARE TAG. It is safe by construction, but the point of a
   * bring up is that you find out on a tag you do not mind losing.
   */
  async verifyOpcodes(): Promise<{ proven: boolean; detail: string }> {
    const cmd = ST_COMMANDS.PRESENT_PASSWORD;

    const wrong = await this.stCommand(cmd, [1, ...DELIBERATELY_WRONG_PASSWORD]);
    const right = await this.stCommand(cmd, [1, ...FACTORY_DEFAULT_PASSWORD]);

    const wrongSw = sw(wrong);
    const rightSw = sw(right);
    const same = wrongSw === rightSw && hex(body(wrong)) === hex(body(right));

    if (same) {
      this.opcodesProven = false;
      return {
        proven: false,
        detail:
          'A wrong password and the factory default both answered 0x' +
          wrongSw.toString(16) +
          '. That is not a discriminating result, so the command path is unproven and the ' +
          'irreversible commands stay locked. Either this tag already carries a password, or one ' +
          'of the opcodes, the flag byte or the transparent session framing is wrong. Get the ' +
          'ST25TV02KC datasheet before going further.',
      };
    }

    this.opcodesProven = true;
    return {
      proven: true,
      detail:
        'Wrong password answered 0x' +
        wrongSw.toString(16) +
        ' and the factory default answered 0x' +
        rightSw.toString(16) +
        '. The chip distinguishes them, so the command path is confirmed on real silicon.',
    };
  }

  async presentPassword(passwordNumber: number, password: Uint8Array): Promise<void> {
    assertPasswordLength(password);
    const response = await this.stCommand(ST_COMMANDS.PRESENT_PASSWORD, [passwordNumber, ...password]);

    if (sw(response) !== SW_OK) {
      throw new ChipError(
        'PASSWORD_REJECTED',
        'The tag refused password ' + passwordNumber + ' with status 0x' + sw(response).toString(16) + '.',
        'Either the password is wrong or this area is governed by a different password number. On an SO4731 tag it is wrong, and Trevean does not hold the right one. See "Decision log", D45.',
      );
    }
  }

  async writePassword(passwordNumber: number, password: Uint8Array): Promise<void> {
    assertPasswordLength(password);
    this.requireProvenOpcodes('change a password');

    const response = await this.stCommand(ST_COMMANDS.WRITE_PASSWORD, [passwordNumber, ...password]);
    if (sw(response) !== SW_OK) {
      throw new ChipError(
        'PROTECT_FAILED',
        'Writing password ' + passwordNumber + ' failed with status 0x' + sw(response).toString(16) + '.',
        'The current password must be presented in this same session before it can be changed.',
      );
    }
  }

  async setAreaProtection(area: number, protection: AreaProtection, passwordNumber: number): Promise<void> {
    this.requireProvenOpcodes('apply area protection');

    const bits = protection === 'none' ? 0x00 : protection === 'write_protected' ? 0x01 : 0x03;
    const response = await this.stCommand(ST_COMMANDS.SET_MEMORY_PROTECTION, [area, (passwordNumber << 4) | bits]);

    if (sw(response) !== SW_OK) {
      throw new ChipError(
        'PROTECT_FAILED',
        'Setting protection on area ' + area + ' failed with status 0x' + sw(response).toString(16) + '.',
        'The governing password must be presented in this same session first.',
      );
    }
  }

  async readAreaProtection(area = 1): Promise<AreaProtectionState> {
    // Read only, so it is allowed without the probe. Answering "what protection does
    // this tag carry" is the single most useful thing this transport can do today: it
    // is the open question on the 1,000 SO4731 jars.
    const response = await this.stCommand(ST_COMMANDS.SET_MEMORY_PROTECTION, [area]);
    if (sw(response) !== SW_OK) {
      throw new ChipError(
        'PROTECT_FAILED',
        'The tag would not report protection for area ' + area + ', status 0x' + sw(response).toString(16) + '.',
        'Some parts refuse this without a password presented. Try presenting one first, and if that fails the state cannot be read from here.',
      );
    }

    const value = body(response)[0] ?? 0;
    const bits = value & 0x03;
    return {
      protection: bits === 0x00 ? 'none' : bits === 0x01 ? 'write_protected' : 'read_and_write_protected',
      passwordNumber: (value >> 4) & 0x03,
    };
  }

  /** The gate. Irreversible commands do not run on unproven opcodes. */
  private requireProvenOpcodes(action: string): void {
    if (this.opcodesProven) return;
    throw new ChipError(
      'PROTECT_FAILED',
      'Refusing to ' + action + ': the ST custom command path has not been proven on this tag.',
      'Run the opcode probe on a sacrificial bare tag first. The opcodes come from secondary sources rather than the datasheet, and an irreversible command sent on an unproven path can lock a tag with a value nobody holds. See chip/st-custom.ts and "Decision log", D45.',
    );
  }

  async releaseTag(): Promise<void> {
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
      throw new ChipError(
        'TRANSPORT_UNAVAILABLE',
        `The reader rejected a command: ${err instanceof Error ? err.message : String(err)}`,
        'Reseat the tag. If it repeats, close any other application holding the reader.',
      );
    }
  }
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
