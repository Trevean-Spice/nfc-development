/**
 * Order attribution and purchasability.
 *
 * Both of these guard defects that were live in `routes/webhooks.ts` until Friday
 * 17 September 2026, and both would have produced a confidently wrong answer rather
 * than an obvious failure.
 */

import { describe, it, expect } from 'vitest';
import { slugForSku, isPurchasable, tokenise } from '../../src/services/skuAttribution.js';

// The REAL slug set, matching the frozen contract's Slug enum and the redirect
// table. An earlier version of this file used "the-silk-road", which is not a slug
// this project has ever had, and the false cases it "proved" were therefore
// invented. Read from the two authoritative sources rather than typed out.
const SLUGS = ['persian-sunrise', 'caribbean-sunset', 'silk-road', 'north-african-night-market', 'kyoto-garden'];
const CODES = { ps: 'persian-sunrise', cs: 'caribbean-sunset', sr: 'silk-road', nm: 'north-african-night-market' };
const opts = { slugs: SLUGS, codeToSlug: CODES };

describe('the regression this file exists for', () => {
  /**
   * The old rule was `sku.includes(slug.split('-')[0])`, so the five first segments
   * `persian`, `caribbean`, `silk`, `north` and `kyoto` were matched as substrings
   * ANYWHERE in a SKU. Each of these is a real English word containing one of them,
   * and each was misattributed. Measured against the real slug list, not assumed.
   */
  it.each([
    ['NORTHERN-SPICE-50G', 'north-african-night-market', 'NORTHern'],
    ['NORTH-STAR-BUNDLE', 'north-african-night-market', 'NORTH star'],
    ['SILKY-SMOOTH-01', 'silk-road', 'SILKy'],
  ])('%s no longer resolves to %s (%s)', (sku, wrongSlug) => {
    expect(slugForSku(sku, opts)).not.toBe(wrongSlug);
    expect(slugForSku(sku, opts)).toBeUndefined();
  });

  it.each([
    ['TS-PS-100G', 'persian-sunrise'],
    ['TS-NAM-100G', undefined],
  ])('%s: the real SKUs the old rule silently missed', (sku, expected) => {
    // TS-PS-100G now resolves through the tag code. TS-NAM-100G still does not,
    // because the tag code is "nm" and nobody has told us what "NAM" means. That is
    // the correct answer today: decline rather than guess. See extraCodes.
    expect(slugForSku(sku, opts)).toBe(expected);
  });
});

describe('whole token matching', () => {
  it.each([
    ['TS-PS-100G', 'persian-sunrise'],
    ['ts_cs_250g', 'caribbean-sunset'],
    ['SR-500', 'silk-road'],
    ['nm-100', 'north-african-night-market'],
  ])('%s resolves through its tag code', (sku, expected) => {
    expect(slugForSku(sku, opts)).toBe(expected);
  });

  it.each([
    ['TREVEAN-PERSIAN-SUNRISE-100G', 'persian-sunrise'],
    ['persian-sunrise', 'persian-sunrise'],
    ['kyoto-garden-gift', 'kyoto-garden'],
  ])('%s resolves through the full slug', (sku, expected) => {
    expect(slugForSku(sku, opts)).toBe(expected);
  });

  it('prefers the longest slug, so a shorter one that is a prefix cannot shadow it', () => {
    // Guards the case where one slug is a prefix of another. Not true of today's five,
    // which is exactly why it is worth asserting before a sixth blend arrives.
    const slugs = ['silk', 'silk-road-reserve'];
    expect(slugForSku('TREVEAN-SILK-ROAD-RESERVE-100G', { slugs })).toBe('silk-road-reserve');
  });

  it('a tag code embedded inside a word is NOT a match', () => {
    // "ps" appears inside "chips" and "crisps". Under the old rule this class of thing
    // is what broke; under this one it must not match at all.
    expect(slugForSku('CHIPS-BUNDLE', opts)).toBeUndefined();
    expect(slugForSku('CRISPS-01', opts)).toBeUndefined();
  });

  it.each([[''], ['   '], ['---'], [null], [undefined], [12345], [{}]])(
    'refuses %s rather than throwing or guessing',
    (sku) => {
      expect(slugForSku(sku, opts)).toBeUndefined();
    },
  );

  it('an unknown SKU returns undefined so the caller can log the gap', () => {
    expect(slugForSku('MYSTERY-BOX-2026', opts)).toBeUndefined();
  });

  it('extraCodes extends the scheme without loosening the matching', () => {
    // Where the client's real SKU scheme goes, once somebody sends one.
    expect(slugForSku('TS-NAM-100G', { ...opts, extraCodes: { nam: 'north-african-night-market' } })).toBe(
      'north-african-night-market',
    );
    // Still a whole token. Adding a code does not reintroduce substring matching.
    expect(slugForSku('NAMASTE-TEA', { ...opts, extraCodes: { nam: 'north-african-night-market' } })).toBeUndefined();
  });

  it('tokenises on any non alphanumeric run', () => {
    expect(tokenise('TS-PS_100g/XL')).toEqual(['ts', 'ps', '100g', 'xl']);
  });
});

describe('isPurchasable, which is live today because every blend is a draft', () => {
  it('a draft product is never purchasable, whatever the variant says', () => {
    // The client on 17 September: "The blends are drafts at the moment." This is the
    // case that would have rendered a working button into a refusing checkout.
    expect(isPurchasable('draft', true)).toBe(false);
    expect(isPurchasable('draft', undefined)).toBe(false);
  });

  it('an archived product is never purchasable', () => {
    expect(isPurchasable('archived', true)).toBe(false);
  });

  it('an active product follows the variant', () => {
    expect(isPurchasable('active', true)).toBe(true);
    expect(isPurchasable('active', false)).toBe(false);
  });

  it('an absent availability is not a reason to claim in stock', () => {
    // The old handler defaulted this to true.
    expect(isPurchasable('active', undefined)).toBe(false);
    expect(isPurchasable('active', null)).toBe(false);
  });

  it('an unrecognised status is treated as not purchasable', () => {
    expect(isPurchasable('pending_review', true)).toBe(false);
    expect(isPurchasable(42, true)).toBe(false);
  });

  it('a missing status falls back to the variant, since older payloads omit it', () => {
    expect(isPurchasable(undefined, true)).toBe(true);
    expect(isPurchasable(undefined, false)).toBe(false);
  });
});
