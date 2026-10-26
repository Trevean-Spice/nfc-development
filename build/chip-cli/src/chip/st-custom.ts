/**
 * ST custom ISO/IEC 15693 commands for the ST25TV02KC, from its datasheet.
 *
 * SOURCE: STMicroelectronics DS13304 Rev 7 (12 February 2025), "ST25TV02KC ST25TV512C",
 * obtained on Sunday 25 October 2026 as the byte for byte Wayback Machine copy of
 * st.com/resource/en/datasheet/st25tv02kc.pdf (sha256 13bfee0e...51923). Section and
 * table numbers below are that document's.
 *
 * WHAT THE DATASHEET CORRECTED. Until Sunday 25 October 2026 this file held values from
 * secondary sources, and three of them were wrong in the irreversible path:
 *
 *   - **0xBA is ToggleDiscreetSilent, not "Set Memory Protection".** Table 163: "BAh 02h
 *     ... Password_id ... 03h". A successful one in Addressed mode puts the tag in the
 *     DISCREET or SILENT state (6.4.23), where it "ignores all incoming requests except"
 *     a few (6.2.9): a phone can no longer read it. This tool must never send it, and a
 *     test fails if any command here uses 0xBA.
 *   - **Area protection is a configuration register, RW_PROTECTION_A1 (FID 00h, PID
 *     00h), written with WriteConfiguration A1h under the CONFIG security session,** which
 *     is opened by presenting PWD_CFG, Password_id 00h (Tables 4, 10 and 26). There is no
 *     password number in the protection byte: PWD_A1 always governs AREA1 (Table 26).
 *   - **Every password travels cover coded,** XORed with the 16 bit number from the latest
 *     GetRandomNumber (B4h), and "The mechanism requires that a call to the
 *     GetRandomNumber command has been issued since the latest boot ... otherwise these
 *     password commands fail" (5.1.3). The old probe never sent B4h, so on a real tag it
 *     could not have passed: the gate held.
 *
 * THE SPLIT THAT MAKES THIS SAFE TO SHIP, which the datasheet does not change:
 *
 *   GET_RANDOM_NUMBER, PRESENT_PASSWORD and READ_CONFIGURATION are **non destructive**:
 *   they open or close a security session, refresh the random number, or read a register.
 *   They can be probed freely, and a probe that behaves correctly is evidence the framing,
 *   the addressing and the cover coding are right.
 *
 *   WRITE_PASSWORD and WRITE_CONFIGURATION are **irreversible** without the password they
 *   install or the configuration password. A wrong byte here can leave a tag protected
 *   with a value nobody recorded, which is exactly the state the 1,000 jars of order
 *   SO4731 are already in. See "Decision log", D45 and D66.
 *
 * The datasheet is still not the part. Nothing here has run on silicon, so the
 * irreversible pair stays gated on the probe passing on the physical tag, in the same
 * connection, exactly as before. See `verifyOpcodes` in the PC/SC transport.
 */

import { PART } from './st25tv02kc.js';

/** STMicroelectronics. Second byte of an ISO 15693 UID, and the IC Mfg code in every custom request (Table 153 and others: "02h"). */
export const IC_MFG_ST = 0x02;

/**
 * Where a byte came from. `datasheet` means quoted from DS13304 Rev 7, which is better
 * than a secondary source and still not a measurement on the part.
 */
export type OpcodeConfidence = 'measured' | 'datasheet' | 'secondary-source';

export interface StCommand {
  readonly code: number;
  readonly name: string;
  /** True when a wrong guess cannot permanently alter the tag's protection or passwords. */
  readonly nonDestructive: boolean;
  readonly confidence: OpcodeConfidence;
  readonly source: string;
}

export const ST_COMMANDS = {
  /**
   * Returns a fresh 16 bit random number, needed to cover code every password. Non
   * destructive: it refreshes the RND_NUMBER register and nothing else (Table 24).
   */
  GET_RANDOM_NUMBER: {
    code: 0xb4,
    name: 'GetRandomNumber',
    nonDestructive: true,
    confidence: 'datasheet',
    source: 'DS13304 Rev 7, 6.4.24, Table 166 "0xxx00xxb B4h 02h 64 bits" (flags, opcode, IC Mfg code, UID). Response Table 167 "00h 16 bits", LSB first (5.1.3 note).',
  },

  /**
   * Opens the security session of one password. **Non destructive**: it is accepted, or it
   * is refused and every security session closes. Nothing is written either way.
   */
  PRESENT_PASSWORD: {
    code: 0xb3,
    name: 'PresentPassword',
    nonDestructive: true,
    confidence: 'datasheet',
    source: 'DS13304 Rev 7, 6.4.19, Table 153 "00xx00xxb B3h 02h 64 bits 8 bits 32 or 64 bits" (flags, opcode, IC Mfg code, UID, Password_id, cover coded Password_data). Wrong password: Table 155 "0Fh Invalid Password_data value".',
  },

  /**
   * Replaces a stored password. **IRREVERSIBLE.** Needs that password's security session
   * open, and writes a value nothing can read back (Table 18, "R : no read access").
   */
  WRITE_PASSWORD: {
    code: 0xb1,
    name: 'WritePassword',
    nonDestructive: false,
    confidence: 'datasheet',
    source: 'DS13304 Rev 7, 6.4.18, Table 150 "0xxx00xxb B1h 02h 64 bits 8 bits 32 or 64 bits". The Password_data is cover coded: "Danger: If a plain value is mistakenly used ... the presentation of its encrypted value with the PresentPassword command fails".',
  },

  /** Reads one configuration register. Non destructive. RW_PROTECTION_A1, END_A1 and LCK_CONFIG read "R : always possible" (Tables 6, 10, 12). */
  READ_CONFIGURATION: {
    code: 0xa0,
    name: 'ReadConfiguration',
    nonDestructive: true,
    confidence: 'datasheet',
    source: 'DS13304 Rev 7, 6.4.16, Table 144 "00xx00xxb A0h 02h 64 bits 8 bits 8 bits" (flags, opcode, IC Mfg code, UID, FID, PID). Response Table 145 "00h 8 to 64 bits".',
  },

  /**
   * Writes one configuration register. **IRREVERSIBLE without the configuration password**,
   * and permanent for LCK_CONFIG, which this tool never writes.
   */
  WRITE_CONFIGURATION: {
    code: 0xa1,
    name: 'WriteConfiguration',
    nonDestructive: false,
    confidence: 'datasheet',
    source: 'DS13304 Rev 7, 6.4.17, Table 147 "0xxx00xxb A1h 02h 64 bits 8 bits 8 bits 8-32 bits" (flags, opcode, IC Mfg code, UID, FID, PID, value). Needs the CONFIG security session (Table 10).',
  },
} as const satisfies Record<string, StCommand>;

/**
 * Opcodes this tool must never send. A test reads this list against `ST_COMMANDS`.
 *   - BAh ToggleDiscreetSilent (6.4.23): puts the tag in a state a phone cannot read.
 *   - A6h Kill (6.4.20): "the ST25TVxxxC permanently enters the KILLED state".
 *   - 22h LockBlock (6.4.5) and 32h Extended Lock Block: permanent block locks.
 */
export const FORBIDDEN_OPCODES: readonly number[] = [0xba, 0xa6, 0x22, 0x32];

/** Table 27, "List of password registers". */
export const PASSWORD_ID = {
  /** PWD_CFG, 4 bytes: opens the CONFIG session, which grants access to configuration registers. */
  CONFIG: 0x00,
  /** PWD_A1: "4 bytes if END_A1 < END_MEM 8 bytes if END_A1 = END_MEM". */
  AREA1: 0x01,
} as const;

/** A configuration register, addressed by FID and PID (Table 4, "List of configuration registers"). */
export interface ConfigRegister {
  readonly name: string;
  readonly fid: number;
  readonly pid: number;
  readonly bytes: number;
}

export const CONFIG_REGISTERS = {
  /** Table 4 row "RW_PROTECTION_A1 00h 00h 1 Y W B": always readable, written under CONFIG, effective at the next RF boot. */
  RW_PROTECTION_A1: { name: 'RW_PROTECTION_A1', fid: 0x00, pid: 0x00, bytes: 1 },
  /** Table 4 row "END_A1 00h 01h 1 Y W' B". */
  END_A1: { name: 'END_A1', fid: 0x00, pid: 0x01, bytes: 1 },
  /** Table 4 row "LCK_CONFIG FFh 00h 2 Y W'' I". Read only by this tool: its locks are permanent (5.1.5). */
  LCK_CONFIG: { name: 'LCK_CONFIG', fid: 0xff, pid: 0x00, bytes: 2 },
} as const satisfies Record<string, ConfigRegister>;

/**
 * Table 11, RW_PROTECTION_A1 b1-b0, "01: read always allowed / write allowed if AREA1
 * security session is open". The only protection value this tool will ever write. 10b and
 * 11b would make the area unreadable to a phone without the password, which is a scrap tag.
 */
export const RW_PROTECTION_WRITE_PROTECTED = 0x01;

/**
 * Table 13, note 1: "END_MEM value is 0Fh / 4Fh for ST25TV512C / ST25TV02KC devices
 * respectively". END_A1 = END_MEM is single area mode. Derived from the part model rather
 * than typed in a second time, so the probe's END_A1 check and its block 79 / block 80
 * geometry read can never disagree (review of Monday 26 October 2026, section 7). A test
 * holds both to the datasheet's 4Fh.
 */
export const END_MEM_ST25TV02KC = PART.blockCount - 1;

/** Table 155: "0Fh Invalid Password_data value", the tag's answer to a wrong password. */
export const ERROR_INVALID_PASSWORD_DATA = 0x0f;

/** ISO/IEC 15693-3 request flag bit 2: high data rate. */
export const FLAG_HIGH_DATA_RATE = 0x02;
/** ISO/IEC 15693-3 request flag bit 6 (with Inventory_flag clear): Address_flag. The UID is in the request. */
export const FLAG_ADDRESS = 0x20;
/**
 * The request flags every frame this tool transceives carries: high data rate and
 * addressed, `22h`. The datasheet allows it for every command used here (the request
 * flags columns "00xx00xxb" and "0xxx00xxb" leave the Address_flag free and fix the
 * Option_flag at 0 only where it must be), and says of PresentPassword and WritePassword:
 * "It is recommended to issue the ... request in Addressed or Select mode ... This ensures
 * that password change is only applied to a specific tag/UID" (6.4.18, 6.4.19). The ACS
 * manual uses the same value: "00h (Default): Sets the flags to 22h" (REF-ACR1552U 1.09,
 * 5.3.4.2).
 *
 * **Why addressed (review finding F1).** "Several VICC may answer to a request in
 * Non-Addressed mode" (6.2.7), so a non addressed frame is executed by every tag in range,
 * and the UID the reader reports belongs to only one of them. Addressed, "Any ST25TVxxxC
 * receiving a request with the Address_flag set to 1 compares the received UID to its own
 * ... Otherwise the device remains silent" (6.2.7). Also, in Non-Addressed mode the tag
 * "remains silent instead of responding a frame with Error_flag set to 1" (6.2.6), so the
 * probe could never see its wrong password refused. There is no builder for a non
 * addressed frame.
 */
export const FLAGS_ADDRESSED = FLAG_HIGH_DATA_RATE | FLAG_ADDRESS;

/**
 * The UID as it goes on the air: least significant byte first. "A field coded on several
 * bytes ... is transmitted in LSB to MSB byte order in ISO15693 request and response
 * frames" (5.1.3 note). Takes the UID most significant byte first, as the transport holds
 * it, and refuses anything that is not an eight byte ST UID, "magic number code E0h ...
 * the IC manufacturer code 'ST 02h'" (7.1, Table 169), so a frame can never be addressed
 * to nothing or to another maker's tag.
 */
export function uidOnAir(uidMsbFirst: Uint8Array): number[] {
  if (uidMsbFirst.length !== 8 || uidMsbFirst[0] !== 0xe0 || uidMsbFirst[1] !== IC_MFG_ST) {
    throw new Error(`An addressed frame needs the tag's eight byte ST UID, E0 02 first. Got ${uidMsbFirst.length} byte(s).`);
  }
  return Array.from(uidMsbFirst).reverse();
}

/**
 * Builds an ST custom request frame, always addressed.
 *
 * Shape, from Tables 144, 147, 150, 153 and 166: Request_flags `22h`, Opcode, IC Mfg code
 * `02h`, the UID LSB first, then the command's own parameters.
 */
export function stRequest(command: StCommand, uidMsbFirst: Uint8Array, params: readonly number[] = []): Uint8Array {
  if (FORBIDDEN_OPCODES.includes(command.code)) {
    throw new Error(`Opcode 0x${command.code.toString(16)} is on the forbidden list and is never sent.`);
  }
  return Uint8Array.from([FLAGS_ADDRESSED, command.code, IC_MFG_ST, ...uidOnAir(uidMsbFirst), ...params]);
}

/**
 * Cover codes a password for PresentPassword or WritePassword (5.1.3, "Password
 * encryption").
 *
 * `passwordMsbFirst` is the plain value, most significant byte first, as the datasheet
 * writes it (b63 to b0 in Table 30) and as the sixteen hex characters of a TagPassword are
 * read. `rnd` is RND_NUMBER from the latest GetRandomNumber. RND_NUMBER_4B and
 * RND_NUMBER_8B are RND_NUMBER repeated (Tables 28 and 29), and "Password_data =
 * XOR(RND_NUMBER_8B , PASSWORD_8B)". The result is returned in air order, LSB first.
 * Table 30's worked example is a test.
 */
export function coverCode(passwordMsbFirst: Uint8Array, rnd: number): number[] {
  if (passwordMsbFirst.length !== 4 && passwordMsbFirst.length !== 8) {
    throw new Error(`An ST25TV02KC password is 4 or 8 bytes (Table 27). Received ${passwordMsbFirst.length}.`);
  }
  if (!Number.isInteger(rnd) || rnd < 0 || rnd > 0xffff) throw new Error('RND_NUMBER is a 16 bit value.');
  const lsbFirst = Array.from(passwordMsbFirst).reverse();
  return lsbFirst.map((b, i) => b ^ (i % 2 === 0 ? rnd & 0xff : (rnd >>> 8) & 0xff));
}

/** A password must be exactly 64 bits. Anything else is a caller bug, not a tag problem. */
export function assertPasswordLength(password: Uint8Array): void {
  if (password.length !== 8) {
    throw new Error(`An ST25TV02KC AREA1 password in single area mode is 64 bits, so 8 bytes (Table 27). Received ${password.length}.`);
  }
}

/** Factory value of PWD_A1, "00000000h" in both halves (Table 19). Eight zero bytes. */
export const FACTORY_DEFAULT_PASSWORD = new Uint8Array(8);

/** Factory value of PWD_CFG, "00000000h" (Table 17). Four zero bytes. */
export const FACTORY_DEFAULT_CONFIG_PASSWORD = new Uint8Array(4);

/** A value chosen to be wrong. Used only as the negative half of the probe. */
export const DELIBERATELY_WRONG_PASSWORD = Uint8Array.from([0xde, 0xad, 0xbe, 0xef, 0xde, 0xad, 0xbe, 0xef]);
