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

import { ChipError, asChipError, isChipError } from '../chip/errors.js';
import { TagPassword } from '../chip/password.js';
import {
  CC_BLOCK,
  CC_BYTES,
  DEFAULT_AREA,
  DEFAULT_AREA_PASSWORD_NUMBER,
  PART,
  READ_SPAN_MAX_BLOCKS,
  T5T_AREA_BYTES,
  T5T_AREA_FIRST_BLOCK,
  buildWritePlan,
  type CcPolicy,
  type WritePlan,
} from '../chip/st25tv02kc.js';
import { decodeUriMessage } from '../ndef/decode.js';
import { encodeUriRecord, type EncodedUriRecord } from '../ndef/encode.js';
import { unwrapNdefTlv, wrapNdefTlv } from '../ndef/tlv.js';
import type { AreaProtectionState, OpcodeProbeResult, TagIdentity, TagTransport } from '../transport/transport.js';
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
  /**
   * True when, after the refusal, presenting the password this run recorded opened the tag
   * and the same write was accepted (review finding N1). A protected outcome always has it.
   */
  readonly unlockProven: boolean;
  /** 'passed' when the transport's opcode probe ran on this tag before the irreversible commands. */
  readonly opcodeProbe: 'passed' | 'not-applicable';
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
  #irreversibleStarted = false;
  #probePassed = false;

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
   * Reads block 0 and the written part of the area, in one Read Binary.
   *
   * **The one span policy for all three reads of the image:** at verify, immediately before
   * protection, and after protection (review of Monday 26 October 2026, section 7). All three
   * read the same blocks through this method, so an image the verify read can carry, the
   * other two can carry too. An image too long for one Read Binary (more than 63 blocks) is
   * refused here, which happens first at verify, before anything irreversible. If the read
   * after protection were the first to fail, every such tag would end LOCKED?.
   */
  private async readImage(plan: WritePlan): Promise<Uint8Array> {
    const blocks = 1 + plan.areaImage.length / PART.blockSizeBytes;
    if (blocks > READ_SPAN_MAX_BLOCKS) {
      throw new ChipError(
        'READBACK_FAILED',
        `The written image is ${blocks} blocks, block 0 included, and this tool reads it back in one Read Binary of at most ${READ_SPAN_MAX_BLOCKS} blocks. This URI is too long to verify, so the tag is not verified and cannot be protected.`,
        'Do not ship this tag. Use a shorter URL: the URLs in the redirect table are a few dozen bytes.',
        { blocks, maxBlocks: READ_SPAN_MAX_BLOCKS },
      );
    }
    return this.#options.transport.readBlocks(CC_BLOCK, blocks);
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

    let readBack: Uint8Array;
    try {
      readBack = await this.readImage(plan);
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
   * in is a genuine one for this URI. On a transport with an opcode probe, the probe
   * must pass on this tag before the first irreversible command, and a changed password
   * must open the tag before protection is applied (review finding N1). Then proves the
   * protection took by reading the protection state back, dropping the tag out of the
   * field, attempting a write that the tag itself must refuse for protection (after an
   * RF cycle), confirming the NDEF still reads, and finally presenting the password this
   * run recorded and repeating the write, which the tag must now accept.
   *
   * Both proof writes rewrite the bytes that are already there, so if protection somehow
   * did not take, the tag is unchanged and the unit fails loudly instead of being
   * recorded as protected when it is not.
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
      let onReader: Uint8Array;
      try {
        onReader = await this.readImage(plan);
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

    // The opcode probe, on this tag, now, before the first irreversible command. It
    // sends only GetRandomNumber, PresentPassword and ReadConfiguration, so it cannot
    // change the tag's passwords or protection, and on a transport
    // whose protection opcodes are not proven by construction it is the only thing
    // that can unlock WritePassword and WriteConfiguration. A hardware transport
    // that has no probe is refused protection outright rather than trusted.
    let opcodeProbe: ProtectionOutcome['opcodeProbe'] = 'not-applicable';
    if (transport.verifyOpcodes !== undefined) {
      let probe: OpcodeProbeResult;
      try {
        probe = await transport.verifyOpcodes();
      } catch (cause) {
        this.fail(cause, 'PROTECT_FAILED', 'The opcode probe could not run. Nothing has been locked. The tag is written and verified but not protected: set it aside and label it.');
      }
      if (!probe.proven) {
        this.#phase = 'failed';
        throw new ChipError(
          'PROTECT_FAILED',
          `Refusing to protect this tag: the opcode probe did not pass. ${probe.detail}`,
          'Nothing has been locked: the probe sends only GetRandomNumber, PresentPassword and ReadConfiguration, which cannot change a tag\'s protection or passwords. The tag is written and verified but not protected: set it aside and label it. The probe passes only on a tag whose password 1 and configuration password are still the factory default and whose area 1 is unprotected, so a tag that already carries a password cannot be protected by this tool on a reader. If this was a sacrificial tag, record this message for the bring up notes and stop. See README section 6.4.',
          { probe: 'not-proven' },
        );
      }
      opcodeProbe = 'passed';
      this.#probePassed = true;
      // The probe's wrong password may have ended any earlier presentation on the tag.
      this.#presented.clear();
    } else if (transport.isHardware) {
      this.#phase = 'failed';
      throw new ChipError(
        'PROTECT_FAILED',
        `Refusing to protect this tag: the "${transport.name}" transport has no opcode probe, so its protection commands cannot be proven on the tag first.`,
        'Nothing has been locked. This is a gap in the tool, not an operator mistake. Report it. See README section 6.4.',
        {},
      );
    }

    if (!this.#presented.has(passwordNumber)) {
      await this.present(request.currentPassword, passwordNumber);
    }

    const passwordChanged = !request.currentPassword.equals(request.newPassword);
    const fingerprint = request.newPassword.fingerprint();

    // From the moment the first irreversible frame goes to the reader, nothing that goes
    // wrong may be reported as "nothing happened". Whatever fails from there, a transport
    // error, a gate refusal on the second command, a lost tag, a failed proof, is rethrown
    // as PROTECT_FAILED saying the tag may already be locked, with the original message
    // appended (review finding F2). The transport counts those frames as it sends them, so
    // a refusal before the first one, which says itself that its command was not sent, is
    // passed through as it is (review finding N3). A transport that cannot count is
    // treated as though a frame had gone out.
    const sentBefore = transport.irreversibleFramesSent;
    let proof: { refusalProven: boolean; unlockProven: boolean };
    try {
      proof = await this.applyAndProve(receipt, plan, area, passwordNumber, passwordChanged, request);
    } catch (cause) {
      this.#phase = 'failed';
      const sentAfter = transport.irreversibleFramesSent;
      if (sentBefore !== undefined && sentAfter !== undefined && sentAfter === sentBefore) {
        throw asChipError(cause, 'PROTECT_FAILED', 'Neither WritePassword nor WriteConfiguration was sent. Set the tag aside, label it, and record this message for the bring up notes.');
      }
      this.#irreversibleStarted = true;
      // Review finding N1: the new password did not open the tag, and area protection was
      // never sent. That message is exact, so it is not rewritten as "may be locked".
      if (isChipError(cause) && cause.detail['passwordUnknown'] === true) throw cause;
      throw mayBeLocked(cause, { area, passwordNumber, passwordChanged, fingerprint });
    }
    this.#irreversibleStarted = true;

    this.#phase = 'protected';
    return {
      applied: true,
      area,
      passwordNumber,
      passwordFingerprint: fingerprint,
      passwordChanged,
      refusalProven: proof.refusalProven,
      unlockProven: proof.unlockProven,
      opcodeProbe,
    };
  }

  /**
   * True once the opcode probe has passed on this unit's tag, or a protection frame that
   * cannot be taken back has been sent to it. The batch never retries such a unit on its
   * own (review finding F7): from that point the remedies say "Do not retry on this tag",
   * the tag may already be locked, and a second attempt starts on whatever is on the
   * reader, without a prompt.
   */
  get retryForbidden(): boolean {
    return this.#probePassed || this.#irreversibleStarted;
  }

  /** The irreversible commands and the proof that they took. Every failure is wrapped by `protect`. */
  private async applyAndProve(
    receipt: VerificationReceipt,
    plan: WritePlan,
    area: number,
    passwordNumber: number,
    passwordChanged: boolean,
    request: ProtectionRequest,
  ): Promise<{ refusalProven: boolean; unlockProven: boolean }> {
    const transport = this.#options.transport;
    if (passwordChanged) {
      await transport.writePassword(passwordNumber, request.newPassword.toBytes());
    }

    await transport.setAreaProtection(area, 'write_protected', passwordNumber);

    // Read the protection state back while the tag is still the one the probe ran on.
    // On the PC/SC transport the read is gated on that same proof, so after the release
    // below it could not run. On the ST25TV02KC this reads the STORED value, which "is
    // immediately readable with a ReadConfiguration request", while the tag enforces it
    // only "on next RF boot sequence" (DS13304 6.4.17 and Table 10). So a read of "none"
    // here contradicts the datasheet and is NOT evidence the tag is unprotected (review
    // finding F4): the protection may still be stored, or the read may have gone wrong.
    const state = await transport.readAreaProtection(area);
    if (state.protection !== 'write_protected') {
      throw new ChipError(
        'PROTECT_FAILED',
        `The tag reports protection state "${state.protection}" after the protection command was accepted. The tag may already be protected: the datasheet says the stored value reads back at once and takes effect at the next power up, so this read is not evidence either way.`,
        'STOP. Label the tag LOCKED? and set it aside. Do not record it as protected and do not retry on it.',
        { protection: state.protection, area },
      );
    }

    // Prove it took, from a fresh session with no password presented.
    await transport.releaseTag();
    this.#presented.clear();
    await this.reacquire('Keep the tag on the reader until the unit reports done.');

    // The conclusive check: a write to the protected area must now be refused BY THE
    // TAG, for protection, and not merely fail. The bytes attempted are the bytes
    // already there. The transport refuses, sending nothing, unless the tag in the field
    // is the one this unit selected, and on a reader it cycles the RF field first so no
    // password presented earlier can still apply (review findings F3 and F8).
    const headerBlock = plan.areaImage.slice(0, PART.blockSizeBytes);
    const verdict = await transport.proveWriteRefused(T5T_AREA_FIRST_BLOCK, headerBlock, this.#identity?.uid ?? null);
    if (verdict !== 'refused') {
      throw new ChipError(
        'PROTECT_FAILED',
        `The proof write to block ${T5T_AREA_FIRST_BLOCK} was accepted after protection was applied and read back as set. That does not show the tag is unprotected: if a password presented earlier in this run still applied, a protected tag accepts the write too. The tag may be protected${passwordChanged ? ', and its password was changed by this run' : ''}.`,
        'STOP. Label the tag LOCKED? and set it aside. Do not record it as protected and do not retry on it. Report it the same day. The block was rewritten with the bytes it already held.',
        { area, passwordNumber },
      );
    }

    // Confirm protection did not break readability. A protected tag that no phone can read
    // is a scrap tag that passed every other check. This runs after the refusal proof
    // because that proof is what cycles the RF field, and the tag enforces the new
    // protection only from its next RF boot (DS13304 Table 10). Read before it, the tag
    // could still have been in its old, unprotected mode (review finding N2).
    let after: Uint8Array;
    try {
      after = await this.readImage(plan);
    } catch (cause) {
      throw asChipError(cause, 'PROTECT_FAILED', 'The tag could not be read after protection.');
    }
    let uri: string;
    try {
      uri = decodeUriMessage(unwrapNdefTlv(after.subarray(CC_BYTES))).uri;
    } catch (cause) {
      throw asChipError(cause, 'PROTECT_FAILED', 'The tag could not be read after protection.');
    }
    if (uri !== receipt.intendedUri) {
      throw new ChipError('PROTECT_FAILED', `After protection the tag decodes to "${uri}" rather than "${receipt.intendedUri}".`, 'Set this tag aside, label it, and report it.', { uri });
    }

    // The unlock proof (review finding N1): the password this run recorded must open the
    // protected tag, shown by the same write being accepted with it presented. Without
    // this, "protected" could mean protected under a value nobody holds.
    await transport.proveWriteUnlocked(T5T_AREA_FIRST_BLOCK, headerBlock, passwordNumber, request.newPassword.toBytes(), this.#identity?.uid ?? null);
    return { refusalProven: true, unlockProven: true };
  }

  async finish(): Promise<void> {
    await this.#options.transport.completeUnit();
  }
}

/**
 * Rewrites any failure after the first irreversible protection command as PROTECT_FAILED
 * saying the tag may already be locked. Only the password's fingerprint is named, never
 * the password. The original code and message are kept, appended, for the bring up notes.
 */
function mayBeLocked(
  cause: unknown,
  facts: { area: number; passwordNumber: number; passwordChanged: boolean; fingerprint: string },
): ChipError {
  const original = asChipError(cause, 'PROTECT_FAILED', '');
  const what = facts.passwordChanged
    ? `Password ${facts.passwordNumber} may already have been changed by this run (new password fingerprint ${facts.fingerprint}), and area ${facts.area} may already be protected.`
    : `Area ${facts.area} may already be protected under password ${facts.passwordNumber} (fingerprint ${facts.fingerprint}).`;
  return new ChipError(
    'PROTECT_FAILED',
    `Protection did not complete, and its irreversible part had begun. ${what} Label the tag LOCKED? and stop. Original message: ${original.code}: ${original.message}`,
    'STOP. Run nothing else on this tag and do not retry on it. Label it "LOCKED?" with the fingerprint above (on a sacrificial tag with a throwaway password: "LOCKED? password discarded"). Do not record it as protected. Copy this whole message into the bring up notes.',
    {
      mayBeLocked: true,
      originalCode: original.code,
      passwordFingerprint: facts.fingerprint,
      passwordChanged: facts.passwordChanged,
      area: facts.area,
      passwordNumber: facts.passwordNumber,
    },
  );
}
