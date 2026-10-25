/**
 * One tag, start to finish.
 *
 * The order is write, read back, verify, then protect, and it is enforced rather
 * than documented. Two mechanisms do that, and they are independent on purpose:
 *
 *   1. A phase machine. `protect` throws PROTECT_BEFORE_VERIFY unless the session
 *      has already reached the verified phase.
 *
 *   2. A verification receipt that only `verify` can produce. It is branded with a
 *      symbol private to this module, so no other file can construct one, and
 *      `protect` re-derives the expected image from the receipt's own intended URI
 *      and checks it against the bytes the receipt says were read. A receipt that
 *      does not contain a genuine matching read back is refused.
 *
 *   3. Identity continuity with the silicon. Mechanisms 1 and 2 prove the session is
 *      self consistent and neither of them touches the tag, so on their own they
 *      cannot tell whether the tag on the reader is still the tag that was verified.
 *      `protect` therefore reads the image once more and requires it to equal the
 *      receipt's bytes before any password or protection command is sent, and every
 *      re-selection after a power cycle checks the UID against the one this unit
 *      started with. A swapped tag is refused with nothing locked, rather than
 *      protected first and noticed afterwards.
 *
 * The reason for the belt and the braces is that a wrong lock is not recoverable in
 * the way a wrong write is. A tag protected around the wrong URL needs its password
 * to fix, and if that tag has left the building the password is the only thing
 * standing between a correct jar and a scrap one. The client's own NFC-SPECS
 * document has this sequence the wrong way round, which is why it is a constraint
 * here rather than a convention.
 */

import { ChipError, asChipError } from '../chip/errors.js';
import { TagPassword } from '../chip/password.js';
import {
  CC_BLOCK,
  CC_BYTES,
  DEFAULT_AREA,
  DEFAULT_AREA_PASSWORD_NUMBER,
  PART,
  T5T_AREA_BYTES,
  T5T_AREA_FIRST_BLOCK,
  buildWritePlan,
  type CcPolicy,
  type WritePlan,
} from '../chip/st25tv02kc.js';
import { decodeUriMessage } from '../ndef/decode.js';
import { encodeUriRecord, type EncodedUriRecord } from '../ndef/encode.js';
import { unwrapNdefTlv, wrapNdefTlv } from '../ndef/tlv.js';
import type { AreaProtectionState, TagIdentity, TagTransport } from '../transport/transport.js';
import { bytesEqual, dumpBlocks, firstDifference, toHex } from '../util/hex.js';
import { createHash } from 'node:crypto';

/** Not exported. Nothing outside this file can put this key on an object. */
const VERIFIED = Symbol('chip-cli.verified-read-back');

export interface VerificationReceipt {
  readonly [VERIFIED]: true;
  readonly intendedUri: string;
  /** Capability container plus the T5T area image, as written. */
  readonly expectedImageHex: string;
  /** The same region, as read back off the tag. */
  readonly readBackHex: string;
  readonly decodedUri: string;
  readonly digest: string;
  readonly verifiedAt: string;
  readonly powerCycled: boolean;
}

export type UnitPhase = 'created' | 'selected' | 'written' | 'verified' | 'protected' | 'failed';

export interface ProtectionRequest {
  /** The password the tag holds now. Factory default on a tag never protected. */
  readonly currentPassword: TagPassword;
  /** The password to set. May be the same object as `currentPassword` to leave it alone. */
  readonly newPassword: TagPassword;
  readonly area?: number;
  readonly passwordNumber?: number;
}

export interface ProtectionOutcome {
  readonly applied: true;
  readonly area: number;
  readonly passwordNumber: number;
  readonly passwordFingerprint: string;
  readonly passwordChanged: boolean;
  /** True when a write to the protected area was attempted after protection and refused. */
  readonly refusalProven: boolean;
}

export interface UnitSessionOptions {
  readonly transport: TagTransport;
  readonly uri: string;
  readonly code: string;
  readonly ccPolicy?: CcPolicy;
  readonly tagTimeoutMs?: number;
  /**
   * Drop the tag out of the field between the write and the read back, so the read
   * back proves the bytes reached EEPROM rather than a reader side buffer.
   * Off by default because it doubles tag handling at pack out. See README.
   */
  readonly verifyAfterPowerCycle?: boolean;
  /** Presented after selecting the tag, so a tag protected by an earlier run can be rewritten. */
  readonly unlockPassword?: TagPassword | undefined;
  readonly now?: () => Date;
}

export interface EncodingSummary {
  readonly uri: string;
  readonly identifierCode: number;
  readonly prefix: string;
  readonly remainder: string;
  readonly payloadBytes: number;
  readonly messageBytes: number;
  readonly tlvBytes: number;
  readonly bytesSavedByPrefix: number;
  readonly areaBytes: number;
  readonly areaBytesFree: number;
  readonly blocksToWrite: number;
  readonly messageHex: string;
  readonly tlvHex: string;
}

/** Everything that can be computed without a tag. Used by dry run and by `chip-cli encode`. */
export function planEncoding(uri: string): { record: EncodedUriRecord; tlv: Uint8Array; summary: EncodingSummary } {
  const record = encodeUriRecord(uri);
  const tlv = wrapNdefTlv(record.message, T5T_AREA_BYTES);
  const plan = buildWritePlan({ tlv: tlv.bytes, existingCc: null, ccPolicy: 'preserve' });
  return {
    record,
    tlv: tlv.bytes,
    summary: {
      uri,
      identifierCode: record.identifierCode,
      prefix: record.prefix,
      remainder: record.remainder,
      payloadBytes: record.payload.length,
      messageBytes: record.message.length,
      tlvBytes: tlv.usedBytes,
      bytesSavedByPrefix: record.bytesSavedByPrefix,
      areaBytes: T5T_AREA_BYTES,
      areaBytesFree: tlv.freeBytes,
      blocksToWrite: plan.blocksWritten,
      messageHex: toHex(record.message),
      tlvHex: toHex(tlv.bytes),
    },
  };
}

export class UnitSession {
  #phase: UnitPhase = 'created';
  #identity: TagIdentity | null = null;
  #plan: WritePlan | null = null;
  #receipt: VerificationReceipt | null = null;
  #presented = new Set<number>();

  readonly #options: UnitSessionOptions;
  readonly #now: () => Date;

  constructor(options: UnitSessionOptions) {
    this.#options = options;
    this.#now = options.now ?? (() => new Date());
  }

  get phase(): UnitPhase {
    return this.#phase;
  }

  get identity(): TagIdentity | null {
    return this.#identity;
  }

  get plan(): WritePlan | null {
    return this.#plan;
  }

  private fail(error: unknown, fallback: Parameters<typeof asChipError>[1], remedy: string): never {
    this.#phase = 'failed';
    throw asChipError(error, fallback, remedy);
  }

  /** Waits for a tag and checks it is the part this tool understands. */
  async selectTag(): Promise<TagIdentity> {
    if (this.#phase !== 'created' && this.#phase !== 'selected') {
      throw new ChipError(
        'USAGE',
        `A tag cannot be selected from the "${this.#phase}" phase.`,
        'This is a bug in the tool. Report it.',
        { phase: this.#phase },
      );
    }
    const timeout = this.#options.tagTimeoutMs ?? 10_000;
    let identity: TagIdentity;
    try {
      identity = await this.#options.transport.waitForTag(timeout);
    } catch (cause) {
      this.fail(cause, 'TAG_ABSENT', 'Place a tag on the reader, centred, and retry this unit.');
    }

    const bytes = identity.blockCount * identity.blockSizeBytes;
    if (bytes !== PART.totalBytes) {
      this.#phase = 'failed';
      throw new ChipError(
        'TAG_NOT_ST25TV02KC',
        `The tag reports ${identity.blockCount} blocks of ${identity.blockSizeBytes} bytes, which is ${bytes} bytes. An ${PART.partNumber} is ${PART.totalBytes} bytes in ${PART.blockCount} blocks of ${PART.blockSizeBytes}.`,
        'This is not the part this tool writes. Check which tags are in front of you. Do not write it.',
        { blockCount: identity.blockCount, blockSizeBytes: identity.blockSizeBytes, reportedPart: identity.partNumber },
      );
    }

    if (this.#options.unlockPassword !== undefined) {
      await this.present(this.#options.unlockPassword, DEFAULT_AREA_PASSWORD_NUMBER);
    }

    this.#identity = identity;
    this.#phase = 'selected';
    return identity;
  }

  /**
   * Selects a tag again after it has been dropped out of the field, and refuses if a
   * different piece of silicon came back.
   *
   * Without this the tool trusts that the tag on the reader after a power cycle is
   * the tag that went into it. At pack out that is one hand movement, and on a tray
   * with more than one tag in range it is the anti collision picking differently.
   * The UID is the only thing that can tell them apart, and a reader that cannot
   * supply one leaves the check unenforceable rather than silently passed, which is
   * why it is skipped only when a UID is genuinely unavailable.
   */
  private async reacquire(fallbackRemedy: string): Promise<void> {
    let identity: TagIdentity;
    try {
      identity = await this.#options.transport.waitForTag(this.#options.tagTimeoutMs ?? 10_000);
    } catch (cause) {
      this.fail(cause, 'TAG_ABSENT', fallbackRemedy);
    }
    const before = this.#identity?.uid ?? null;
    const after = identity.uid;
    if (before !== null && after !== null && before !== after) {
      this.#phase = 'failed';
      throw new ChipError(
        'TAG_CHANGED',
        `The tag on the reader is uid ${after} and this unit selected uid ${before}. A different tag came back into the field.`,
        'Nothing has been locked on the new tag by this step. Set both tags aside, label them, and run this unit again with one tag on the reader.',
        { expectedUid: before, foundUid: after },
      );
    }
  }

  private async present(password: TagPassword, passwordNumber: number): Promise<void> {
    try {
      await this.#options.transport.presentPassword(passwordNumber, password.toBytes());
      this.#presented.add(passwordNumber);
    } catch (cause) {
      this.fail(
        cause,
        'PASSWORD_REJECTED',
        'The tag holds a different password from the one supplied. Check the secret store. There is no reset and no recovery service.',
      );
    }
  }

  /**
   * Writes the tag.
   *
   * The plan's ordering (terminator first, message body, TLV header, capability
   * container last) is what makes an interrupted write safe. See buildWritePlan.
   */
  async write(): Promise<WritePlan> {
    if (this.#phase !== 'selected') {
      throw new ChipError(
        'USAGE',
        `A tag cannot be written from the "${this.#phase}" phase. Select the tag first.`,
        'This is a bug in the tool. Report it.',
        { phase: this.#phase },
      );
    }

    const record = encodeUriRecord(this.#options.uri);
    const tlv = wrapNdefTlv(record.message, T5T_AREA_BYTES);

    let existingCc: Uint8Array | null = null;
    try {
      existingCc = await this.#options.transport.readBlocks(CC_BLOCK, 1);
    } catch {
      // A tag that will not give up its capability container gets a fresh one.
      existingCc = null;
    }

    const plan = buildWritePlan({
      tlv: tlv.bytes,
      existingCc,
      ccPolicy: this.#options.ccPolicy ?? 'preserve',
    });

    for (const step of plan.steps) {
      try {
        await this.#options.transport.writeBlock(step.block, step.data);
      } catch (cause) {
        this.#plan = plan;
        this.fail(
          cause,
          'WRITE_FAILED',
          'Rewrite this tag from the start. The tool writes a terminator first, so a tag interrupted here opens nothing rather than opening the wrong page.',
        );
      }
    }

    this.#plan = plan;
    this.#phase = 'written';
    return plan;
  }

  /**
   * Reads the tag back and proves it carries the intended URI.
   *
   * Three checks, all of which must pass:
   *   1. the bytes read equal the bytes intended, byte for byte
   *   2. the NDEF decodes cleanly as exactly one URI record
   *   3. the decoded URI string equals the intended URI exactly
   *
   * Check 1 alone would pass a tag whose image is right but whose encoding this
   * tool got wrong. Check 3 alone would pass a tag with an extra record after the
   * URI. Both have to hold.
   */
  async verify(): Promise<VerificationReceipt> {
    if (this.#phase !== 'written') {
      throw new ChipError(
        'USAGE',
        `A tag cannot be verified from the "${this.#phase}" phase. Write it first.`,
        'This is a bug in the tool. Report it.',
        { phase: this.#phase },
      );
    }
    const plan = this.#plan;
    if (plan === null) {
      throw new ChipError('USAGE', 'There is no write plan to verify against.', 'This is a bug in the tool. Report it.', {});
    }

    const powerCycled = this.#options.verifyAfterPowerCycle === true;
    if (powerCycled) {
      await this.#options.transport.releaseTag();
      this.#presented.clear();
      await this.reacquire('Keep the tag on the reader through the read back, or turn off --verify-after-power-cycle.');
    }

    const areaBlocks = plan.areaImage.length / PART.blockSizeBytes;
    let readBack: Uint8Array;
    try {
      readBack = await this.#options.transport.readBlocks(CC_BLOCK, 1 + areaBlocks);
    } catch (cause) {
      this.fail(cause, 'READBACK_FAILED', 'Retry this unit with the tag held still and centred on the reader.');
    }

    const expected = new Uint8Array(CC_BYTES + plan.areaImage.length);
    expected.set(plan.capabilityContainer, 0);
    expected.set(plan.areaImage, CC_BYTES);

    if (!bytesEqual(readBack, expected)) {
      const at = firstDifference(readBack, expected);
      this.#phase = 'failed';
      throw new ChipError(
        'READBACK_MISMATCH',
        [
          `The tag does not hold what was written. First difference at byte ${at} (block ${Math.floor(at / PART.blockSizeBytes)}).`,
          'expected:',
          dumpBlocks(expected, CC_BLOCK, PART.blockSizeBytes),
          'read back:',
          dumpBlocks(readBack, CC_BLOCK, PART.blockSizeBytes),
        ].join('\n'),
        'Do not ship this tag. Rewrite it and verify again. If it fails twice, set it aside, label it, and report it.',
        { firstDifferenceAt: at, expectedHex: toHex(expected), readBackHex: toHex(readBack) },
      );
    }

    let decodedUri: string;
    try {
      const area = readBack.subarray(CC_BYTES);
      decodedUri = decodeUriMessage(unwrapNdefTlv(area)).uri;
    } catch (cause) {
      this.fail(cause, 'READBACK_MISMATCH', 'Do not ship this tag. Rewrite it and verify again.');
    }

    if (decodedUri !== this.#options.uri) {
      this.#phase = 'failed';
      throw new ChipError(
        'READBACK_MISMATCH',
        `The tag decodes to "${decodedUri}" and the intended URI is "${this.#options.uri}".`,
        'Do not ship this tag. A tag carrying another blend URL is the worst defect this project can ship, and it is invisible to anyone who only checks that something opened.',
        { decodedUri, intendedUri: this.#options.uri },
      );
    }

    const expectedHex = toHex(expected);
    const receipt: VerificationReceipt = {
      [VERIFIED]: true,
      intendedUri: this.#options.uri,
      expectedImageHex: expectedHex,
      readBackHex: toHex(readBack),
      decodedUri,
      digest: createHash('sha256').update(`${this.#options.uri}\n${expectedHex}`).digest('hex').slice(0, 16),
      verifiedAt: this.#now().toISOString(),
      powerCycled,
    };

    this.#receipt = receipt;
    this.#phase = 'verified';
    return receipt;
  }

  /**
   * Applies area based write protection.
   *
   * Refuses unless the session has verified, and refuses unless the receipt handed
   * in is a genuine one for this URI. Then proves the protection took by dropping
   * the tag out of the field, reading the protection state back, confirming the
   * NDEF still reads, and attempting a write that must be refused.
   *
   * That last attempt writes the bytes that are already there, so if protection
   * somehow did not take, the tag is unchanged and the unit fails loudly instead of
   * being recorded as protected when it is not.
   */
  async protect(receipt: VerificationReceipt, request: ProtectionRequest): Promise<ProtectionOutcome> {
    if (this.#phase !== 'verified') {
      throw new ChipError(
        'PROTECT_BEFORE_VERIFY',
        `Write protection was requested from the "${this.#phase}" phase. A tag is protected only after it has been written, read back and verified.`,
        'This is a bug in the tool, not an operator mistake. Report it. Nothing has been locked.',
        { phase: this.#phase },
      );
    }
    if (receipt !== this.#receipt) {
      throw new ChipError(
        'RECEIPT_INVALID',
        'The verification receipt handed to protect is not the one this session produced.',
        'This is a bug in the tool. Report it. Nothing has been locked.',
        {},
      );
    }
    if (receipt[VERIFIED] !== true) {
      throw new ChipError('RECEIPT_INVALID', 'The verification receipt is not genuine.', 'This is a bug in the tool. Report it.', {});
    }

    // Re-derive from the receipt's own intended URI. A receipt whose bytes do not
    // encode its own URI cannot protect anything, however it was obtained.
    const rederived = wrapNdefTlv(encodeUriRecord(receipt.intendedUri).message, T5T_AREA_BYTES);
    const plan = this.#plan;
    if (plan === null) {
      throw new ChipError('RECEIPT_INVALID', 'There is no write plan for this session.', 'This is a bug in the tool. Report it.', {});
    }
    const rederivedImage = new Uint8Array(CC_BYTES + plan.areaImage.length);
    rederivedImage.set(plan.capabilityContainer, 0);
    rederivedImage.set(rederived.bytes, CC_BYTES);
    if (toHex(rederivedImage) !== receipt.readBackHex) {
      throw new ChipError(
        'RECEIPT_INVALID',
        'The bytes in the verification receipt do not encode the URI the receipt claims.',
        'This is a bug in the tool. Report it. Nothing has been locked.',
        { intendedUri: receipt.intendedUri },
      );
    }
    if (receipt.intendedUri !== this.#options.uri) {
      throw new ChipError(
        'RECEIPT_INVALID',
        `The receipt is for "${receipt.intendedUri}" and this unit is for "${this.#options.uri}".`,
        'This is a bug in the tool. Report it. Nothing has been locked.',
        {},
      );
    }

    const area = request.area ?? DEFAULT_AREA;
    const passwordNumber = request.passwordNumber ?? DEFAULT_AREA_PASSWORD_NUMBER;
    const transport = this.#options.transport;

    // Everything above this line proves the session is self consistent. None of it
    // touches the tag, so none of it can tell whether the silicon on the reader is
    // still the silicon that was verified. Read the image once more and require it
    // to be the bytes the receipt was issued for, before any password or protection
    // command is sent. A protection command is the one step in this tool that
    // commits something to a tag it cannot take back without the password.
    {
      const areaBlocksNow = plan.areaImage.length / PART.blockSizeBytes;
      let onReader: Uint8Array;
      try {
        onReader = await transport.readBlocks(CC_BLOCK, 1 + areaBlocksNow);
      } catch (cause) {
        this.fail(cause, 'PROTECT_FAILED', 'The tag could not be read immediately before protection. Nothing has been locked. Retry this unit.');
      }
      if (toHex(onReader) !== receipt.readBackHex) {
        this.#phase = 'failed';
        throw new ChipError(
          'PROTECT_FAILED',
          'The tag on the reader no longer holds the bytes that were verified. It is either a different tag or it changed after verification.',
          'Nothing has been locked. Set this tag aside, label it, and run the unit again with one tag on the reader.',
          { verifiedDigest: receipt.digest },
        );
      }
    }

    if (!this.#presented.has(passwordNumber)) {
      await this.present(request.currentPassword, passwordNumber);
    }

    const passwordChanged = !request.currentPassword.equals(request.newPassword);
    if (passwordChanged) {
      try {
        await transport.writePassword(passwordNumber, request.newPassword.toBytes());
      } catch (cause) {
        this.fail(
          cause,
          'PROTECT_FAILED',
          'The tag is written and verified but its password was not changed. Set it aside and report it. Do not record it as protected.',
        );
      }
    }

    try {
      await transport.setAreaProtection(area, 'write_protected', passwordNumber);
    } catch (cause) {
      this.fail(
        cause,
        'PROTECT_FAILED',
        'The tag is written and verified but not protected. Set it aside, label it, and report it. Do not ship it as protected.',
      );
    }

    // Prove it took, from a fresh session with no password presented.
    await transport.releaseTag();
    this.#presented.clear();
    await this.reacquire('Keep the tag on the reader until the unit reports done.');

    let state: AreaProtectionState;
    try {
      state = await transport.readAreaProtection(area);
    } catch (cause) {
      this.fail(cause, 'PROTECT_FAILED', 'The protection state could not be read back. Set the tag aside and report it.');
    }
    if (state.protection !== 'write_protected') {
      this.#phase = 'failed';
      throw new ChipError(
        'PROTECT_FAILED',
        `The tag reports protection state "${state.protection}" after the protection command was accepted.`,
        'Set this tag aside, label it, and report it. Do not record it as protected.',
        { protection: state.protection, area },
      );
    }

    // Confirm protection did not break readability. A protected tag that no phone
    // can read is a scrap tag that passed every other check.
    const areaBlocks = plan.areaImage.length / PART.blockSizeBytes;
    try {
      const after = await transport.readBlocks(CC_BLOCK, 1 + areaBlocks);
      const uri = decodeUriMessage(unwrapNdefTlv(after.subarray(CC_BYTES))).uri;
      if (uri !== receipt.intendedUri) {
        this.#phase = 'failed';
        throw new ChipError(
          'PROTECT_FAILED',
          `After protection the tag decodes to "${uri}" rather than "${receipt.intendedUri}".`,
          'Set this tag aside, label it, and report it.',
          { uri },
        );
      }
    } catch (cause) {
      this.fail(cause, 'PROTECT_FAILED', 'The tag could not be read after protection. Set it aside and report it.');
    }

    // The conclusive check: a write to the protected area must now be refused.
    // The bytes attempted are the bytes already there, so a tag that is somehow not
    // protected is left unchanged and the unit fails rather than passing.
    let refusalProven = false;
    const headerBlock = plan.areaImage.slice(0, PART.blockSizeBytes);
    try {
      await transport.writeBlock(T5T_AREA_FIRST_BLOCK, headerBlock);
    } catch (cause) {
      const chip = asChipError(cause, 'PROTECT_FAILED', '');
      if (chip.code === 'AREA_PROTECTED') refusalProven = true;
      else {
        this.fail(cause, 'PROTECT_FAILED', 'The protection proof step failed for an unexpected reason. Set the tag aside and report it.');
      }
    }
    if (!refusalProven) {
      this.#phase = 'failed';
      throw new ChipError(
        'PROTECT_FAILED',
        'The area still accepted a write after protection was applied and read back as set.',
        'Set this tag aside, label it, and report it. Do not record it as protected. The tag content is unchanged.',
        { area, passwordNumber },
      );
    }

    this.#phase = 'protected';
    return {
      applied: true,
      area,
      passwordNumber,
      passwordFingerprint: request.newPassword.fingerprint(),
      passwordChanged,
      refusalProven,
    };
  }

  async finish(): Promise<void> {
    await this.#options.transport.completeUnit();
  }
}
