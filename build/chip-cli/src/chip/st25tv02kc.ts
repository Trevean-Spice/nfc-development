/**
 * The ST25TV02KC memory model.
 *
 * STMicroelectronics ST25TV02KC, NFC Forum Type 5, ISO/IEC 15693 vicinity.
 * It is not an NTAG21x, it is not Type 2, and it is not ISO/IEC 14443.
 *
 * Two consequences run through this whole file and the tool around it:
 *
 *   1. User memory is 320 bytes in 80 blocks of 4. Not 888 bytes, which is NTAG216
 *      user memory and the number the previous team's tooling was built around,
 *      and not 256 bytes in 64 blocks, which is what this file said until Sunday
 *      25 October 2026 and which made the reader probe refuse every genuine tag.
 *      Every write is block granular, which is why a partial write is a real
 *      failure mode and why the write plan below is ordered the way it is.
 *
 *   2. Write protection is an area based 64 bit password, held in chip/password.ts.
 *      There are no lock bits in this file, there is no lock bit API anywhere in
 *      this package, and there must never be one. If a change ever needs a lock
 *      bit here, the change is wrong. See README, "What this is not".
 *
 * Reference: the ST25TV02KC datasheet, STMicroelectronics DS13304 Rev 7 (February
 * 2025), and application note AN5658. Values sourced from those documents are
 * marked. Nothing in this file has been confirmed against physical silicon by us.
 * See README, section 6.
 */

import { ChipError } from './errors.js';

export const PART = {
  partNumber: 'ST25TV02KC',
  nfcForumType: 5,
  airInterface: 'ISO/IEC 15693',
  /**
   * User memory. DS13304 Rev 7, page 1: "Up to 2560 bits (320 bytes) of EEPROM",
   * "Accessible by blocks of four bytes". Page 7, figure 5 note 3: "80 blocks of 32
   * bits for ... ST25TV02KC". Page 8, section 4.2: "Value of END_MEM is ... 4Fh for
   * ... ST25TV02KC", so the last block is 4Fh (79) and there are END_MEM+1 = 80.
   */
  totalBytes: 320,
  blockSizeBytes: 4,
  blockCount: 80,
  uidBits: 64,
  passwordBits: 64,
  writeEnduranceCycles: 100_000,
  retentionYears: 60,
} as const;

// A geometry that does not multiply out is a typo that would corrupt every tag.
if (PART.blockCount * PART.blockSizeBytes !== PART.totalBytes) {
  throw new Error('ST25TV02KC geometry is inconsistent: block count times block size must equal total bytes');
}

/** The capability container occupies block 0. */
export const CC_BLOCK = 0;
export const CC_BYTES = PART.blockSizeBytes;

/** T5T capability container magic number for one byte block addressing. */
export const CC_MAGIC_1_BYTE = 0xe1;
/** T5T capability container magic number for two byte block addressing, used by larger parts. */
export const CC_MAGIC_2_BYTE = 0xe2;
/** Mapping version 1.0, read access always granted, write access always granted. */
export const CC_VERSION_AND_ACCESS = 0x40;
/**
 * Additional feature information, byte 3. Bit 0 signals that the tag supports the
 * Read Multiple Block command, which the ST25TV02KC does.
 *
 * This is the one byte in the whole image whose exact value this tool cannot check
 * for itself: a wrong feature flag is invisible to a read back and visible only to
 * a phone. That is why the default policy is to preserve a capability container the
 * tag already carries rather than overwrite it with ours. See `evaluateCc`.
 */
export const CC_FEATURE_FLAGS = 0x01;

/**
 * MLEN is the T5T area size in units of 8 bytes. The 316 bytes after the container
 * round down to 39 (0x27), so a container this tool writes never declares a byte the
 * part does not have after block 0. DS13304 does not state a factory container value,
 * so this is the tool's own figure and not a datasheet one. See `evaluateCc`.
 */
export const CC_MLEN = Math.floor((PART.totalBytes - CC_BYTES) / 8);
/** The area the NDEF TLV lives in: 312 bytes, blocks 1 to 78. Block 79 is never written. */
export const T5T_AREA_BYTES = CC_MLEN * 8;
export const T5T_AREA_FIRST_BLOCK = 1;
export const T5T_AREA_BLOCK_COUNT = T5T_AREA_BYTES / PART.blockSizeBytes;

/** The capability container this tool writes when a tag does not already carry a valid one. */
export function buildCapabilityContainer(): Uint8Array {
  return Uint8Array.from([CC_MAGIC_1_BYTE, CC_VERSION_AND_ACCESS, CC_MLEN, CC_FEATURE_FLAGS]);
}

export interface CcAssessment {
  readonly valid: boolean;
  readonly reason: string;
  /** Area size the container declares, in bytes. */
  readonly declaredAreaBytes: number;
}

/**
 * Decides whether the capability container already on a tag can be kept.
 *
 * Keeping it is the safer default. The 1,000 tags on order SO4731 were formatted by
 * the supplier and measured on 6 August at 79/80 on iPhone and 40/40 on Android, so
 * their container demonstrably works on real handsets. Replacing that with a value
 * this tool computed from a datasheet trades a measured fact for a plausible one.
 */
export function evaluateCc(cc: Uint8Array): CcAssessment {
  if (cc.length < CC_BYTES) {
    return { valid: false, reason: 'shorter than four bytes', declaredAreaBytes: 0 };
  }
  const magic = cc[0] ?? 0;
  const versionAndAccess = cc[1] ?? 0;
  const mlen = cc[2] ?? 0;
  const declaredAreaBytes = mlen * 8;

  if (magic !== CC_MAGIC_1_BYTE && magic !== CC_MAGIC_2_BYTE) {
    return { valid: false, reason: `magic byte 0x${magic.toString(16).padStart(2, '0')} is not 0xE1 or 0xE2`, declaredAreaBytes };
  }
  if ((versionAndAccess & 0xc0) !== 0x40) {
    return {
      valid: false,
      reason: `mapping version nibble 0x${(versionAndAccess >> 6).toString(16)} is not version 1.0`,
      declaredAreaBytes,
    };
  }
  if ((versionAndAccess & 0x03) !== 0x00) {
    return { valid: false, reason: 'the container declares restricted write access', declaredAreaBytes };
  }
  if (mlen === 0) {
    return { valid: false, reason: 'the container declares a zero byte area', declaredAreaBytes };
  }
  // The bound is the whole user memory, not the memory after the container. Formatting
  // tools differ over whether MLEN counts block 0: 0x27 (312 bytes) leaves it out and
  // 0x28 (320 bytes, the "memory size byte for 320 bytes") counts it. Both describe this
  // part, and refusing either would rewrite a container that may be the one measured
  // working on handsets. 0x29 and above describe a bigger part and are refused. The
  // NDEF TLV is still bounded by T5T_AREA_BYTES whatever the container declares.
  if (declaredAreaBytes > PART.totalBytes) {
    return {
      valid: false,
      reason: `the container declares ${declaredAreaBytes} bytes, more than the ${PART.totalBytes} the part has`,
      declaredAreaBytes,
    };
  }
  return { valid: true, reason: 'valid Type 5 capability container', declaredAreaBytes };
}

/* -------------------------------------------------------------------------- */
/* Areas and protection                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Protection state of a memory area.
 *
 * This is a state, not a fuse. Holding the 64 bit password lets you change it back,
 * which is the single most important difference from the NTAG lock bit model that
 * most NFC material describes. The risk here is custody of the password, not
 * permanence: lose the password and the tag is frozen exactly as if it had been
 * fused shut, and there is no reset, no master key and no recovery service.
 */
export type AreaProtection = 'none' | 'write_protected' | 'read_and_write_protected';

/**
 * The ST25TV02KC can be partitioned into up to four areas by configuration.
 *
 * This tool does not repartition. It uses the factory single area layout, in which
 * area 1 covers the whole memory, and it protects area 1 with password 1.
 * Repartitioning changes configuration bytes that would need silicon validation we
 * have not done, and the project has no requirement for it: every tag carries one
 * URI record and one protection state.
 */
export const DEFAULT_AREA = 1;
export const DEFAULT_AREA_PASSWORD_NUMBER = 1;
export const MAX_AREAS = 4;

/* -------------------------------------------------------------------------- */
/* The write plan                                                              */
/* -------------------------------------------------------------------------- */

export type WriteStepPurpose = 'invalidate' | 'area' | 'tlv-header' | 'capability-container';

export interface WriteStep {
  readonly block: number;
  readonly data: Uint8Array;
  readonly purpose: WriteStepPurpose;
  readonly note: string;
}

export interface WritePlan {
  readonly steps: readonly WriteStep[];
  /** The T5T area content after every step, padded to the block boundary. */
  readonly areaImage: Uint8Array;
  /** The capability container after every step, whether preserved or written. */
  readonly capabilityContainer: Uint8Array;
  readonly ccAction: 'preserve' | 'write';
  readonly blocksWritten: number;
  readonly areaBytesUsed: number;
  readonly areaBytesFree: number;
}

export type CcPolicy = 'preserve' | 'rewrite';

export interface BuildWritePlanOptions {
  /** The NDEF TLV block, terminator included, from ndef/tlv.ts. */
  readonly tlv: Uint8Array;
  /** The capability container currently on the tag, or null if the tag was not read. */
  readonly existingCc: Uint8Array | null;
  readonly ccPolicy: CcPolicy;
}

/**
 * Builds the block by block write plan.
 *
 * The ordering is the point of this function, and it is not cosmetic.
 *
 *   Step 1  Block 1 is overwritten with a terminator TLV. The tag now reads as
 *           formatted and empty. Any interruption from here on leaves a tag that
 *           opens nothing, rather than a tag that opens the wrong page.
 *   Step 2  The tail of the TLV is written, blocks 2 upward.
 *   Step 3  Block 1 is written with the real TLV header. The message becomes
 *           readable in a single block write, so there is no window in which a
 *           reader can see a valid header in front of an incomplete message.
 *   Step 4  The capability container, only when the tag does not already carry a
 *           valid one. Written last for the same reason: an interrupted first write
 *           leaves an unformatted tag rather than a half encoded one.
 *
 * ISO/IEC 15693 writes one block at a time and a partial write is a documented
 * failure mode on this air interface. This ordering is what makes a partial write
 * safe rather than merely detectable. It costs one extra block write per tag.
 */
export function buildWritePlan(options: BuildWritePlanOptions): WritePlan {
  const { tlv, existingCc, ccPolicy } = options;

  const blockSize = PART.blockSizeBytes;

  if (tlv.length > T5T_AREA_BYTES) {
    throw new ChipError(
      'CAPACITY_EXCEEDED',
      `The NDEF TLV is ${tlv.length} bytes and the ST25TV02KC area is ${T5T_AREA_BYTES} bytes.`,
      'Shorten the URI.',
      { tlvBytes: tlv.length, areaBytes: T5T_AREA_BYTES },
    );
  }

  // Pad to the block boundary with 0x00, which is a NULL TLV and legal padding.
  const paddedLength = Math.ceil(tlv.length / blockSize) * blockSize;
  const areaImage = new Uint8Array(paddedLength);
  areaImage.set(tlv, 0);

  const blocksNeeded = paddedLength / blockSize;
  if (blocksNeeded < 1) {
    throw new ChipError('NDEF_ENCODE', 'The write plan came out empty.', 'This is a bug in the tool. Report it.', {});
  }
  if (blocksNeeded > T5T_AREA_BLOCK_COUNT) {
    throw new ChipError(
      'CAPACITY_EXCEEDED',
      `The write plan needs ${blocksNeeded} blocks and the area is ${T5T_AREA_BLOCK_COUNT} blocks.`,
      'Shorten the URI.',
      { blocksNeeded, areaBlocks: T5T_AREA_BLOCK_COUNT },
    );
  }

  const ccAssessment = existingCc === null ? null : evaluateCc(existingCc);
  const keepCc =
    ccPolicy === 'preserve' &&
    ccAssessment !== null &&
    ccAssessment.valid &&
    ccAssessment.declaredAreaBytes >= tlv.length;

  const capabilityContainer = keepCc && existingCc !== null ? existingCc.slice(0, CC_BYTES) : buildCapabilityContainer();

  const steps: WriteStep[] = [];

  const invalidate = new Uint8Array(blockSize);
  invalidate[0] = 0xfe; // terminator TLV, the area reads as formatted and empty
  steps.push({
    block: T5T_AREA_FIRST_BLOCK,
    data: invalidate,
    purpose: 'invalidate',
    note: 'terminator first, so an interrupted write cannot leave a readable wrong URL',
  });

  for (let i = 1; i < blocksNeeded; i += 1) {
    steps.push({
      block: T5T_AREA_FIRST_BLOCK + i,
      data: areaImage.slice(i * blockSize, (i + 1) * blockSize),
      purpose: 'area',
      note: 'NDEF message body',
    });
  }

  steps.push({
    block: T5T_AREA_FIRST_BLOCK,
    data: areaImage.slice(0, blockSize),
    purpose: 'tlv-header',
    note: 'TLV type and length, written last so the record becomes readable atomically',
  });

  if (!keepCc) {
    steps.push({
      block: CC_BLOCK,
      data: capabilityContainer,
      purpose: 'capability-container',
      note:
        ccAssessment === null
          ? 'no container was read from the tag'
          : `existing container rejected: ${ccAssessment.reason}`,
    });
  }

  return {
    steps,
    areaImage,
    capabilityContainer,
    ccAction: keepCc ? 'preserve' : 'write',
    blocksWritten: steps.length,
    areaBytesUsed: tlv.length,
    areaBytesFree: T5T_AREA_BYTES - tlv.length,
  };
}
