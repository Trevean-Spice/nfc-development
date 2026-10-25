/**
 * Output for a person standing at a bench, not for a developer reading a log.
 *
 * Plain ASCII throughout. No colour unless the terminal is interactive and NO_COLOR
 * is unset, no box drawing characters, no symbols that depend on a font. The
 * operator may be reading this over somebody's shoulder on a laptop in a packing
 * room.
 */

import type { ChipError } from '../chip/errors.js';
import type { BatchSummary } from '../workflow/batch.js';
import type { RunHeaderRecord } from '../workflow/journal.js';
import type { EncodingSummary } from '../workflow/unit.js';
import { dumpBlocks } from '../util/hex.js';
import { PART, T5T_AREA_BYTES } from '../chip/st25tv02kc.js';

const useColour = process.stdout.isTTY === true && process.env['NO_COLOR'] === undefined;

export function bold(text: string): string {
  return useColour ? `\u001b[1m${text}\u001b[0m` : text;
}

export function dim(text: string): string {
  return useColour ? `\u001b[2m${text}\u001b[0m` : text;
}

export function rule(width = 68): string {
  return '-'.repeat(width);
}

export function renderError(error: ChipError): string {
  return [
    '',
    bold(`FAILED  ${error.code}`),
    '',
    error.message,
    '',
    `What to do: ${error.remedy}`,
    '',
  ].join('\n');
}

export function renderEncoding(summary: EncodingSummary, tlv: Uint8Array, message: Uint8Array): string {
  const lines: string[] = [];
  lines.push(`URI                 ${summary.uri}`);
  lines.push(
    `URI prefix code     0x${summary.identifierCode.toString(16).padStart(2, '0')} for "${summary.prefix}", saving ${summary.bytesSavedByPrefix} bytes`,
  );
  lines.push(`Remainder on chip   ${summary.remainder}`);
  lines.push(`NDEF payload        ${summary.payloadBytes} bytes`);
  lines.push(`NDEF message        ${summary.messageBytes} bytes`);
  lines.push(`NDEF TLV on chip    ${summary.tlvBytes} bytes`);
  lines.push(
    `Chip area           ${summary.tlvBytes} of ${T5T_AREA_BYTES} bytes used, ${summary.areaBytesFree} free (${PART.totalBytes} byte part)`,
  );
  lines.push(
    `Block writes        ${summary.blocksToWrite} of ${PART.blockSizeBytes} bytes each (worst case: one fewer when the tag already carries a valid capability container)`,
  );
  lines.push('');
  lines.push('NDEF message bytes');
  lines.push(dumpBlocks(message, 0, PART.blockSizeBytes));
  lines.push('');
  lines.push('Tag area as written, from block 1');
  lines.push(dumpBlocks(padToBlock(tlv), 1, PART.blockSizeBytes));
  return lines.join('\n');
}

function padToBlock(bytes: Uint8Array): Uint8Array {
  const size = Math.ceil(bytes.length / PART.blockSizeBytes) * PART.blockSizeBytes;
  const out = new Uint8Array(size);
  out.set(bytes, 0);
  return out;
}

export function renderBatchSummary(summary: BatchSummary): string {
  const lines: string[] = [];
  lines.push('');
  lines.push(rule());
  lines.push(bold(`BATCH ${summary.complete ? 'COMPLETE' : 'NOT COMPLETE'}   ${summary.code}  ${summary.blendName}`));
  lines.push(rule());
  lines.push(`Run id            ${summary.runId}`);
  lines.push(`URL written       ${summary.uri}`);
  lines.push(`Target            ${summary.targetCount} units`);
  if (summary.dryRun) {
    lines.push(`Planned           ${summary.planned.length}`);
  } else {
    const protectedCount = [...summary.outcomeBySeq.values()].filter((o) => o === 'protected').length;
    lines.push(`Verified          ${summary.succeeded.length}`);
    if (protectedCount > 0) lines.push(`Protected         ${protectedCount}`);
  }
  lines.push(`Failed            ${summary.failed.length}`);
  lines.push(`Not attempted     ${summary.notAttempted.length}`);
  lines.push(`Elapsed           ${(summary.elapsedMs / 1000).toFixed(1)} s`);
  lines.push(`Journal           ${summary.journalPath}`);
  lines.push(
    `Transport         ${summary.transport}${summary.transportIsHardware ? '' : '  (no physical tags were written)'}`,
  );

  if (summary.failed.length > 0) {
    lines.push('');
    lines.push(bold(`Units that failed: ${compactRanges(summary.failed)}`));
    lines.push('Each one is in the journal with the reason. Those tags were set aside and are not accounted for.');
  }
  if (summary.notAttempted.length > 0) {
    lines.push('');
    lines.push(bold(`Units not attempted: ${compactRanges(summary.notAttempted)}`));
    lines.push(`Resume with:  chip-cli batch --code ${summary.code} --count ${summary.targetCount} --journal ${summary.journalPath}`);
  }
  if (summary.interrupted) {
    lines.push('');
    lines.push('The run was interrupted. Nothing was lost: every finished unit is on disk.');
  }
  if (summary.aborted) {
    lines.push('');
    lines.push('The run stopped because too many units failed. Check the reader and the tags before resuming.');
  }
  lines.push('');
  return lines.join('\n');
}

/**
 * The command that resumes this journal, and what the operator has to add to it.
 *
 * The printed line used to carry only --code, --count and --journal. On a protected run,
 * running exactly what the tool printed exited 2 with JOURNAL_MISMATCH, because --protect
 * was missing, and after the transport kind was added to the resume checks it failed on
 * hardware runs too. The tool's own recovery instruction was guaranteed to fail on exactly
 * the runs where recovery matters, against an M4 acceptance condition that a member of
 * Trevean staff operates this unaided in under five minutes.
 *
 * The decision, which is what stopped a reviewer fixing it: print every flag the journal
 * can reconstruct, and name the one it cannot rather than pretending it does not exist. A
 * password source cannot be echoed, because a password never reaches this file: the header
 * carries a fingerprint and nothing else. So a protected run prints the command with a
 * placeholder in the password position and a second line saying what to substitute. An
 * operator can copy the line, and on an unprotected run it is complete as printed.
 *
 * The transport flag comes from transportIsHardware rather than from the transport name,
 * because that is the field the resume check compares. A reader swapped for another reader
 * mid run is allowed, and the printed command stays correct across that swap.
 *
 * Returned as an array of lines so a test can assert on the command itself rather than on
 * the paragraph around it.
 */
export function resumeCommand(header: RunHeaderRecord, journalPath: string): string[] {
  const flags = [
    'chip-cli batch',
    `--code ${header.code}`,
    `--count ${header.targetCount}`,
    `--journal ${journalPath}`,
    `--table ${header.tablePath}`,
    `--transport ${header.transportIsHardware ? 'reader' : 'simulator'}`,
  ];
  if (header.dryRun) flags.push('--dry-run');
  if (header.protectRequested) flags.push('--protect --password-env <NAME OF THE VARIABLE HOLDING THIS RUN PASSWORD>');

  const lines = [`Resume with:  ${flags.join(' ')}`];
  if (header.protectRequested) {
    lines.push(
      `              The password is not printed here and is not in the journal. This run used the password with fingerprint ${header.passwordFingerprint ?? 'unknown'}.`,
    );
    lines.push(
      '              If the interruption landed during protection, a tag may already hold that password, in which case add --current-password-env pointing at the same secret.',
    );
  }
  return lines;
}

/** "1, 2, 3, 7, 8" becomes "1 to 3, 7 to 8". Five hundred numbers do not fit on a screen. */
export function compactRanges(numbers: readonly number[]): string {
  if (numbers.length === 0) return 'none';
  const parts: string[] = [];
  let start = numbers[0] as number;
  let previous = start;
  for (let i = 1; i < numbers.length; i += 1) {
    const value = numbers[i] as number;
    if (value === previous + 1) {
      previous = value;
      continue;
    }
    parts.push(start === previous ? String(start) : `${start} to ${previous}`);
    start = value;
    previous = value;
  }
  parts.push(start === previous ? String(start) : `${start} to ${previous}`);
  return parts.join(', ');
}
