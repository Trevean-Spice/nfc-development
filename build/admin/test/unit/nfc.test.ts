import { describe, expect, it } from 'vitest';
import { groupIntoBatches, groupIntoRuns } from '../../src/routes/nfc.js';
import type { TagRecord } from '../../src/api/types.js';

function tag(overrides: Partial<TagRecord>): TagRecord {
  return {
    code: 'ps',
    blendSlug: 'persian-sunrise',
    requestPath: '/t/ps',
    targetPath: '/blend.html?blend=persian-sunrise&via=nfc',
    redirectStatus: 307,
    unitsEncoded: 250,
    status: 'encoded',
    encodedOn: '2026-07-24',
    supplierOrderRef: 'SO4731',
    chipPartNumber: 'ST25TV02KC',
    writeProtected: null,
    ndefUri: 'https://treveanspice.com/t/ps',
    lastVerifiedAgainstPhysicalTag: null,
    ...overrides,
  };
}

const SHIPPED: TagRecord[] = [
  tag({}),
  tag({ code: 'cs', blendSlug: 'caribbean-sunset', requestPath: '/t/cs' }),
  tag({ code: 'sr', blendSlug: 'silk-road', requestPath: '/t/sr' }),
  tag({ code: 'nm', blendSlug: 'north-african-night-market', requestPath: '/t/nm' }),
  tag({
    code: 'kg',
    blendSlug: 'kyoto-garden',
    requestPath: '/t/kg',
    status: 'reserved',
    unitsEncoded: 0,
    encodedOn: null,
    supplierOrderRef: null,
    chipPartNumber: null,
    ndefUri: null,
  }),
];

describe('tag batches', () => {
  it('group by supplier order and count 1,000 units across the four encoded codes', () => {
    const batches = groupIntoBatches(SHIPPED);
    expect(batches).toHaveLength(1);
    expect(batches[0]?.supplierOrderRef).toBe('SO4731');
    expect(batches[0]?.units).toBe(1000);
    expect(batches[0]?.codes.map((c) => c.code)).toEqual(['ps', 'cs', 'sr', 'nm']);
  });

  it('exclude the reserved fifth code, because no tag in this run carries it', () => {
    const batches = groupIntoBatches(SHIPPED);
    expect(batches[0]?.codes.some((c) => c.code === 'kg')).toBe(false);
  });

  it('report write protection as unknown rather than as false', () => {
    expect(groupIntoBatches(SHIPPED)[0]?.writeProtected).toBeNull();
  });

  it('report a mixed batch as unknown rather than picking a side', () => {
    const mixed = [tag({ writeProtected: true }), tag({ code: 'cs', writeProtected: false })];
    expect(groupIntoBatches(mixed)[0]?.writeProtected).toBeNull();
  });
});

describe('encoding runs', () => {
  it('are one supplier order encoded on one date', () => {
    const runs = groupIntoRuns(SHIPPED);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.runKey).toBe('SO4731 on 2026-07-24');
    expect(runs[0]?.units).toBe(1000);
  });

  it('split when the same order was encoded on two dates', () => {
    const runs = groupIntoRuns([tag({}), tag({ code: 'cs', encodedOn: '2026-07-25' })]);
    expect(runs).toHaveLength(2);
  });

  it('never produce a per tag row, because attribution is per SKU', () => {
    const runs = groupIntoRuns(SHIPPED);
    // A run is a set of codes and a count. There is no identifier per unit anywhere in it,
    // because per SKU encoding produces none and the chip UID is not available.
    for (const run of runs) {
      expect(Object.keys(run)).not.toContain('tags');
      expect(run.codes.length).toBeLessThanOrEqual(5);
    }
  });
});
