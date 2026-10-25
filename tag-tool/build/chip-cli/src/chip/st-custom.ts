/**
 * ST custom ISO/IEC 15693 commands, and the reason every byte here is suspect.
 *
 * THE PROVENANCE OF THESE VALUES IS NOT A DATASHEET.
 *
 * On Wednesday 7 October 2026 the ST25TV02KC datasheet and application note AN5658
 * were sought from **five** routes and none produced the document: `st.com` timed
 * out repeatedly and then refused connections outright, the Mouser mirror served an
 * HTML bot block, and two ST community threads discuss the ISO subset without giving
 * command codes.
 *
 * What follows therefore comes from **secondary sources that agree with each other
 * and with the documented ST25DV family convention.** That is better than memory and
 * it is **worse than the datasheet**, which is why none of it is trusted at runtime
 * until the tag itself has confirmed it. See `verifyOpcodes` in the PC/SC transport.
 *
 * THE SPLIT THAT MAKES THIS SAFE TO SHIP AT ALL:
 *
 *   PRESENT_PASSWORD is **non destructive**. A wrong opcode, a wrong framing or a
 *   wrong password all produce an error response and change nothing on the chip. It
 *   can therefore be probed freely, and a probe that behaves correctly is evidence
 *   the opcode and the framing are right.
 *
 *   WRITE_PASSWORD and SET_MEMORY_PROTECTION are **irreversible**. A wrong byte here
 *   does not fail safe: it can leave a tag protected with a value nobody recorded,
 *   which is exactly the state the 1,000 jars of order SO4731 are already in. See
 *   "Decision log", D45.
 *
 * So the destructive pair is gated on the safe one having been proven first, on the
 * physical tag, in the same session. That turns an unverified constant into a
 * measured one before anything irreversible is sent.
 */

/** STMicroelectronics. Second byte of an ISO 15693 UID, and the manufacturer byte in every custom request. */
export const IC_MFG_ST = 0x02;

export type OpcodeConfidence = 'measured' | 'secondary-source';

export interface StCommand {
  readonly code: number;
  readonly name: string;
  /** True when a wrong guess cannot permanently alter the tag. */
  readonly nonDestructive: boolean;
  readonly confidence: OpcodeConfidence;
  readonly source: string;
}

export const ST_COMMANDS = {
  /**
   * Presents a password for the session. **Non destructive**: the chip either accepts
   * it and relaxes the matching protection until the tag leaves the field, or rejects
   * it. Nothing is written either way.
   */
  PRESENT_PASSWORD: {
    code: 0xb3,
    name: 'Present Password',
    nonDestructive: true,
    confidence: 'secondary-source',
    source: 'ST community references, consistent with the ST25DV family convention. Request is flags, 0xB3, 0x02, password number, then eight password bytes.',
  },

  /**
   * Replaces a stored password. **IRREVERSIBLE.** Requires the current password to
   * have been presented first, and writes a value that must be recorded before it is
   * sent, because nothing can read it back.
   */
  WRITE_PASSWORD: {
    code: 0xb1,
    name: 'Write Password',
    nonDestructive: false,
    confidence: 'secondary-source',
    source: 'ST25 family convention. NOT separately corroborated for ST25TV02KC.',
  },

  /**
   * Applies or removes area protection. **IRREVERSIBLE without the governing password.**
   * Noted in a community reference as present on ST25TV02KC and absent on ST25DV04KC,
   * which is a part specific claim and therefore the least transferable value here.
   */
  SET_MEMORY_PROTECTION: {
    code: 0xba,
    name: 'Set Memory Protection',
    nonDestructive: false,
    confidence: 'secondary-source',
    source: 'One ST community reference giving "02 BA" for ST25TV02KC specifically.',
  },
} as const satisfies Record<string, StCommand>;

/** ISO 15693 request flags. High data rate, no addressing: the tag is already selected. */
export const FLAG_HIGH_DATA_RATE = 0x02;

/**
 * Builds an ST custom request frame.
 *
 * Shape: flags, command code, manufacturer code, then the command's own parameters.
 * The manufacturer byte is what makes a code in the 0xA0 to 0xDF custom range mean
 * ST's command rather than another vendor's.
 */
export function stRequest(command: StCommand, params: readonly number[] = []): Uint8Array {
  return Uint8Array.from([FLAG_HIGH_DATA_RATE, command.code, IC_MFG_ST, ...params]);
}

/** A password must be exactly 64 bits. Anything else is a caller bug, not a tag problem. */
export function assertPasswordLength(password: Uint8Array): void {
  if (password.length !== 8) {
    throw new Error(`An ST25TV area password is 64 bits, so 8 bytes. Received ${password.length}.`);
  }
}

/**
 * The factory default password on an unconfigured ST25TV area: eight zero bytes.
 *
 * Used by the opcode probe, because presenting it to a bare tag should SUCCEED while
 * presenting a deliberately wrong value should FAIL. **Two outcomes that differ is the
 * evidence.** A transport that returns the same answer to both has not proven anything,
 * whatever that answer is.
 */
export const FACTORY_DEFAULT_PASSWORD = new Uint8Array(8);

/** A value chosen to be wrong. Used only as the negative half of the probe. */
export const DELIBERATELY_WRONG_PASSWORD = Uint8Array.from([0xde, 0xad, 0xbe, 0xef, 0xde, 0xad, 0xbe, 0xef]);
