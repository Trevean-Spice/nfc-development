/**
 * What a tag already holds, read before anything is written to it.
 *
 * Staff put written tags back on the reader. On the call of Tuesday 17 November 2026 a tag
 * that had been written and locked answered a second write with errors that did not say
 * so. This file names a tag that already carries a Trevean URL by its product code and
 * blend before any write, and turns a write such a tag refuses into "this tag is locked",
 * in those words, instead of a write that did not finish.
 *
 * **Read only.** It reads blocks and nothing else: no password, no ST custom command, no
 * write. So it changes nothing about the protection path or its gate.
 *
 * **What it cannot do: read the protection itself.** On the reader the protection read,
 * ReadConfiguration of RW_PROTECTION_A1, is sent only behind the opcode probe, and the probe
 * passes only on a tag whose passwords are still the factory default ("Decision log", D66,
 * and README section 6.4). A locked tag never passes it. So "locked" is worked out from the
 * tag refusing a write, as `explainRefusedWrite` says, and never read before one.
 */

import { ChipError, isChipError } from '../chip/errors.js';
import { CC_BLOCK, CC_BYTES, PART, READ_SPAN_MAX_BLOCKS } from '../chip/st25tv02kc.js';
import { decodeUriMessage } from '../ndef/decode.js';
import { unwrapNdefTlv } from '../ndef/tlv.js';
import type { RedirectTable, TagCodeEntry } from '../table/redirect-table.js';
import type { TagTransport } from '../transport/transport.js';
import { planEncoding } from './unit.js';

export interface ExistingContent {
  /** The URL the tag decodes to, or null when it holds no single URI record. */
  readonly uri: string | null;
  /** The table row whose URL that is exactly, or null when it is not a Trevean product URL. */
  readonly entry: TagCodeEntry | null;
}

/**
 * Block 0 and as much of the area as the longest URL in the table takes, in one Read Binary.
 * A tag holding a Trevean URL holds one of these, so it always fits; anything longer is not
 * a Trevean URL and is reported as holding something else.
 */
export function existingSpanBlocks(table: RedirectTable): number {
  let tlvBytes = 0;
  for (const entry of table.encodable()) {
    if (entry.ndefUri !== null) tlvBytes = Math.max(tlvBytes, planEncoding(entry.ndefUri).tlv.length);
  }
  return Math.min(READ_SPAN_MAX_BLOCKS, 1 + Math.ceil(tlvBytes / PART.blockSizeBytes));
}

/** Decodes an area image against the table. Never throws: a tag holding nothing usable is `uri: null`. */
export function classifyArea(area: Uint8Array, table: RedirectTable): ExistingContent {
  let uri: string;
  try {
    uri = decodeUriMessage(unwrapNdefTlv(area)).uri;
  } catch {
    return { uri: null, entry: null };
  }
  return { uri, entry: table.encodable().find((e) => e.ndefUri === uri) ?? null };
}

/**
 * Reads what the selected tag holds. Null when it could not be read, which is "not known"
 * and never "blank": the caller then says nothing about it and carries on as before.
 */
export async function readExisting(transport: TagTransport, table: RedirectTable): Promise<ExistingContent | null> {
  let image: Uint8Array;
  try {
    image = await transport.readBlocks(CC_BLOCK, existingSpanBlocks(table));
  } catch {
    return null;
  }
  return classifyArea(image.subarray(CC_BYTES), table);
}

/** "ps (Persian Sunrise)", or the URL itself when it is not one of the table's. Null for a tag holding no URL. */
export function describeExisting(existing: ExistingContent | null): string | null {
  if (existing === null || existing.uri === null) return null;
  if (existing.entry !== null) return `${existing.entry.code} (${existing.entry.blendName})`;
  return `${existing.uri}, which is not a Trevean product URL`;
}

/**
 * A write the tag refused, said plainly when the tag is locked.
 *
 * The write plan puts a terminator into block 1 first (`buildWritePlan`), so on a tag that
 * refuses writes the very first block write fails and nothing on the tag changes. When the
 * tag held a URL before the write, the write failed with WRITE_FAILED or AREA_PROTECTED, and
 * the same URL reads back straight after, the tag refused a write while still answering
 * reads. On this part that is area write protection: "write allowed if AREA1 security
 * session is open" (DS13304 Rev 7, Table 11).
 *
 * On the reader this is worked out, not read: Update Binary has one error row for every
 * cause, "6X XXh Fail" (ACR1552U manual 5.3.3.5), and the protection read is behind the
 * D66 gate. So the reader's own message is kept on the last line of the new one.
 *
 * Anything else is returned unchanged: another error code, a tag that held no URL before,
 * a tag that could not be read again, and a tag that now reads differently, which is a
 * partial write and keeps its own remedy.
 */
export async function explainRefusedWrite(
  cause: unknown,
  before: ExistingContent | null,
  transport: TagTransport,
  table: RedirectTable,
  wantedCode: string,
): Promise<unknown> {
  if (!isChipError(cause) || (cause.code !== 'WRITE_FAILED' && cause.code !== 'AREA_PROTECTED')) return cause;
  const held = describeExisting(before);
  if (before === null || held === null) return cause;
  const after = await readExisting(transport, table);
  if (after === null || after.uri !== before.uri) return cause;

  const same = before.entry !== null && before.entry.code === wantedCode;
  const label = before.entry !== null ? `${before.entry.code} LOCKED` : 'LOCKED';
  return new ChipError(
    'TAG_LOCKED',
    [
      `This tag is locked, and it was written already: it holds ${held}${same ? ', the code being written' : ''}. It refused the write and still reads exactly as before, so nothing on it changed.`,
      `The reader said: ${cause.message}`,
    ].join('\n'),
    same
      ? 'Nothing to do: this tag is finished. Do not write it again. Take it off and put the next tag on.'
      : `Do not try again: a locked tag refuses every write until it is opened with the password it was locked with. Set it aside and label it "${label}".`,
    { heldCode: before.entry?.code ?? null, heldUri: before.uri, wantedCode, readerErrorCode: cause.code },
  );
}
