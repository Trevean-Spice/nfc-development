// The deployed redirect table.
//
// This is the load bearing artifact of the whole design. A thousand encoded, possibly
// write protected tags resolve through it, and the failure it is shaped to prevent is a one
// character mismatch between a row's code, its NDEF URI and its target path: a two key typo
// that passes review, deploys green, and opens the wrong blend on 250 jars.
//
// The suite checks what is actually served against the map in the fixtures. A code that has
// been renamed, repointed or dropped fails here.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { callOperation } from '../client.js';
import { config } from '../config.js';
import { CHIP_PART_NUMBER, REDIRECT_STATUS, TAG_CODE_MAP, TOTAL_TAGS_ENCODED } from '../fixtures.js';

const needsAdmin = config.tokens.admin ? false : 'no admin token configured';

describe('GET /v1/admin/tags', () => {
  it('serves one row per tag code and no more', { skip: needsAdmin }, async () => {
    const result = await callOperation('adminListTagRecords', { role: 'admin', expectStatus: 200 });
    const codes = (result.body.data as any[]).map((row) => row.code).sort();
    assert.deepEqual(
      codes,
      TAG_CODE_MAP.map((entry) => entry.code).sort(),
      'The deployed redirect table no longer carries exactly the codes encoded onto physical tags.',
    );
  });

  it('maps every code to the blend the physical tags were encoded for', { skip: needsAdmin }, async () => {
    const result = await callOperation('adminListTagRecords', { role: 'admin', expectStatus: 200 });
    for (const row of result.body.data as any[]) {
      const expected = TAG_CODE_MAP.find((entry) => entry.code === row.code);
      assert.ok(expected, `Unknown tag code ${row.code} in the deployed table.`);
      assert.equal(
        row.blendSlug,
        expected!.blendSlug,
        `Code ${row.code} now points at ${row.blendSlug}. It was encoded for ${expected!.blendSlug}. ` +
          'Repointing is legitimate but must never happen by accident.',
      );
      assert.equal(row.requestPath, expected!.requestPath);
      assert.equal(row.targetPath, expected!.targetPath);
      assert.equal(row.status, expected!.status);
      assert.equal(row.unitsEncoded, expected!.unitsEncoded);
    }
  });

  it('redirects with 307 on every row', { skip: needsAdmin }, async () => {
    const result = await callOperation('adminListTagRecords', { role: 'admin', expectStatus: 200 });
    for (const row of result.body.data as any[]) {
      assert.equal(
        row.redirectStatus,
        REDIRECT_STATUS,
        `Code ${row.code} redirects with ${row.redirectStatus}. A 301 is cached permanently by browsers ` +
          'and intermediaries, which would destroy the one property the whole design is built on.',
      );
    }
  });

  it('keeps the NDEF URI, the code and the target path in agreement', { skip: needsAdmin }, async () => {
    const result = await callOperation('adminListTagRecords', { role: 'admin', expectStatus: 200 });
    for (const row of result.body.data as any[]) {
      assert.equal(row.requestPath, `/t/${row.code}`);
      assert.ok(
        row.targetPath.includes(`blend=${row.blendSlug}`),
        `Row ${row.code} target path does not carry blend=${row.blendSlug}.`,
      );
      assert.ok(row.targetPath.includes('via=nfc'), `Row ${row.code} target path does not carry via=nfc.`);
      if (row.ndefUri !== null && row.ndefUri !== undefined) {
        assert.ok(
          String(row.ndefUri).endsWith(`/t/${row.code}`),
          `Row ${row.code} has NDEF URI ${row.ndefUri}, which does not end with its own code.`,
        );
      }
    }
  });

  it('accounts for exactly the 1,000 tags encoded on 24 July 2026', { skip: needsAdmin }, async () => {
    const result = await callOperation('adminListTagRecords', { role: 'admin', expectStatus: 200 });
    const encoded = (result.body.data as any[]).filter((row) => row.status === 'encoded');
    const total = encoded.reduce((sum, row) => sum + row.unitsEncoded, 0);
    assert.equal(total, TOTAL_TAGS_ENCODED, 'Encoded units no longer sum to the tags actually shipped.');
    for (const row of encoded) {
      assert.equal(
        row.chipPartNumber,
        CHIP_PART_NUMBER,
        `Row ${row.code} records chip ${row.chipPartNumber}. The tag is ST25TV02KC, NFC Forum Type 5 / ` +
          'ISO 15693. It is not NTAG21x and not Type 2.',
      );
    }
  });

  it('reports the commit the deployed table was built from', { skip: needsAdmin }, async () => {
    const result = await callOperation('adminListTagRecords', { role: 'admin', expectStatus: 200 });
    assert.ok(
      Object.hasOwn(result.body, 'sourceCommit'),
      'The table is a version controlled artifact. An operator has to be able to see which commit is live.',
    );
  });

  it('reports write protection as true on the encoded run and null where no tag exists', { skip: needsAdmin }, async () => {
    const result = await callOperation('adminListTagRecords', { role: 'admin', expectStatus: 200 });
    for (const row of result.body.data as any[]) {
      assert.ok(
        row.writeProtected === null || typeof row.writeProtected === 'boolean',
        `Row ${row.code} reports writeProtected as ${JSON.stringify(row.writeProtected)}.`,
      );
      if (row.status === 'encoded') {
        assert.strictEqual(
          row.writeProtected,
          true,
          `Row ${row.code} is encoded, so it should carry the SO4731 answer rather than null.`,
        );
      }
    }
    const unknown = (result.body.data as any[]).filter((row) => row.writeProtected === null).length;
    console.log(
      `      note: writeProtected is true across the SO4731 run and unknown on ${unknown} of ` +
        `${(result.body.data as any[]).length} rows, which are the reserved codes carrying no tag. ` +
        'Reversed Friday 11 September 2026, decision log D45, superseding D18. Still to confirm by ' +
        'reading back one shipped tag, because that is Dan\'s check rather than Tagstand\'s written one.',
    );
  });
});
