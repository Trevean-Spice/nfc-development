/**
 * The other artifacts derived from the canonical table.
 *
 * "M1 Deliverable 2: Data model", section 7.3: one source, derived artifacts,
 * none of them hand edited. The CloudFront Function is the first and is produced
 * by compile.mjs. These are the rest. The QR artwork sheet is the fourth, added
 * by "M1 Deliverable 14: QR attribution", section 4, so the string a print
 * vendor sets into artwork comes off the same row as the string the edge serves.
 *
 * sourceCommit and deployedAt are left null in the committed artifacts so the
 * build is byte for byte reproducible and the CI drift check stays meaningful.
 * The deploy pipeline fills them in as it writes them to DynamoDB.
 */

import { tableId } from './table.mjs';

/**
 * One CSV field, quoted when it has to be, per RFC 4180.
 *
 * QUOTED RATHER THAN REJECTED, and the choice matters because these sheets are handed to a
 * print vendor. A blend name containing a comma, "Kyoto Garden, Limited Edition", used to
 * shift every column to its right by one: the vendor reading the encodeInQr column got
 * " Limited Edition" instead of a URL, the validator returned zero errors, and the artifact
 * test still passed because it only checked that the QR URL appeared somewhere in the row
 * and that the row ended with ",307". Both survive a shift.
 *
 * Rejecting a comma outright was the other defensible option. It is the wrong one: a comma
 * in a marketing name is an ordinary decision, not a mistake, and refusing it pushes
 * whoever needs the sheet back to hand editing a CSV, which is the transcription step this
 * sheet exists to remove. Quoting keeps the generated sheet the only sheet.
 *
 * A carriage return or a line feed IS rejected, in validate.mjs rather than here. RFC 4180
 * permits them inside a quoted field, plenty of vendor tooling does not, and no blend name
 * has any business containing one, so it fails the table rather than being smuggled through
 * quoted into somebody's spreadsheet import.
 */
export function csvField(value) {
  const text = value === null || value === undefined ? '' : String(value);
  if (!/[",\r\n]/.test(text)) return text;
  return `"${text.split('"').join('""')}"`;
}

function csvRow(values) {
  return values.map(csvField).join(',');
}

/**
 * Seed rows for the NFCTags table, whose attributes are fixed by "M1 Deliverable
 * 2: Data model", section 3.4. That table is a mirror for operators and the
 * admin CMS. The redirect itself never reads it: a database read inside the
 * redirect would put a round trip inside the 2.0 second budget for no benefit.
 */
export function nfcTagsSeed(table, notFoundHtml) {
  return {
    $comment:
      'Generated from redirect-table.json. Do not edit. NFCTags is a mirror of the ' +
      'version-controlled table, not a source of truth, and the edge redirect never reads it.',
    tableId: tableId(table, notFoundHtml),
    tableVersion: table.version,
    items: table.entries.map((entry) => ({
      code: entry.code,
      blendSlug: entry.blendSlug,
      requestPath: entry.requestPath,
      targetPath: entry.targetPath,
      qrRequestPath: entry.qrRequestPath,
      qrTargetPath: entry.qrTargetPath,
      qrUrl: entry.qrUrl,
      redirectStatus: table.redirectStatus,
      unitsEncoded: entry.unitsEncoded,
      status: entry.status,
      encodedOn: entry.encodedOn,
      supplierOrderRef: entry.supplierOrderRef,
      chipPartNumber: entry.chipPartNumber,
      writeProtected: entry.writeProtected,
      ndefUri: entry.ndefUri,
      lastVerifiedAgainstPhysicalTag: null,
      sourceCommit: null,
      deployedAt: null
    }))
  };
}

/**
 * Input for the M4 chip programming tooling, so a code encoded onto a physical
 * tag and a code served by the edge can never come from two different lists.
 */
export function tagEncodingCsv(table) {
  // The QR URL is deliberately not on this sheet. This one is the input to the
  // chip programming tooling and a QR is not encoded onto silicon. Mixing the
  // two would put a string that must not change on a sheet whose whole purpose
  // is the run where strings do change. The QR sheet below is the separate one.
  const header = 'code,blendSlug,ndefUri,unitsEncoded,status,chipPartNumber,writeProtected';
  const rows = table.entries.map((entry) =>
    csvRow([
      entry.code,
      entry.blendSlug,
      entry.ndefUri ?? '',
      entry.unitsEncoded,
      entry.status,
      entry.chipPartNumber ?? '',
      entry.writeProtected === null ? 'unknown' : String(entry.writeProtected)
    ])
  );
  return `${[header, ...rows].join('\n')}\n`;
}

/**
 * The exact string Trevean encodes into the on-pack QR artwork, one row per
 * blend, generated from the same rows the edge serves.
 *
 * This exists because the QR artwork is on the critical path, is Trevean's to
 * produce, and is unrecallable once printed. A URL retyped from a document into
 * a design file is the same class of failure as a hand edited redirect table:
 * everything looks right and 250 cartons point somewhere else. Handing over a
 * generated sheet removes the transcription step.
 */
export function qrArtworkCsv(table) {
  const header = 'code,blendSlug,blendName,encodeInQr,resolvesTo,redirectStatus';
  const rows = table.entries.map((entry) =>
    csvRow([
      entry.code,
      entry.blendSlug,
      entry.blendName,
      entry.qrUrl,
      entry.qrTargetPath,
      table.redirectStatus
    ])
  );
  return `${[header, ...rows].join('\n')}\n`;
}
