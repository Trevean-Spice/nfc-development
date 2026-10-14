/**
 * Cart permalink derivation.
 *
 * The property under test is not "does it build a URL". It is **does it refuse to
 * build one it is not certain about**, because a wrong permalink renders as a live
 * reorder button that takes a customer into a broken checkout, and a null renders
 * as a disabled button that tells the truth. Most of these cases assert null.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import {
  buildCartPermalink,
  normaliseStoreDomain,
  normaliseVariantId,
} from '../../src/services/cartPermalink.js';

const DOMAIN = 'treveanliving.com';
const VARIANT = '43215678901234';

describe('normaliseVariantId', () => {
  it('accepts a bare numeric id, which is what REST and CSV exports give', () => {
    expect(normaliseVariantId(VARIANT)).toBe(VARIANT);
  });

  it('accepts a GraphQL global id and reduces it to the number the URL needs', () => {
    expect(normaliseVariantId(`gid://shopify/ProductVariant/${VARIANT}`)).toBe(VARIANT);
  });

  it('trims, because a pasted id carries whitespace more often than not', () => {
    expect(normaliseVariantId(`  ${VARIANT}\n`)).toBe(VARIANT);
  });

  it.each([
    ['empty', ''],
    ['whitespace only', '   '],
    ['a product gid rather than a variant gid', 'gid://shopify/Product/43215678901234'],
    ['an SKU', 'PS-100G'],
    ['a handle', 'persian-sunrise'],
    ['a decimal', '4321.5678'],
    ['a negative', '-43215678901234'],
    ['digits with a path attached', '43215678901234/1'],
    ['null', null],
    ['undefined', undefined],
    ['an object', { id: VARIANT }],
  ])('refuses %s', (_label, input) => {
    expect(normaliseVariantId(input)).toBeNull();
  });

  it('refuses a number that has already lost precision rather than emitting a wrong variant', () => {
    // Shopify ids are 64 bit. Parsed as a JS number, a realistic id silently rounds, and
    // the rounded value is a syntactically perfect permalink for a variant that does not
    // exist. This is the failure mode that would be hardest to spot in a browser.
    const unsafe = Number('12345678901234567890');
    expect(Number.isSafeInteger(unsafe)).toBe(false);
    expect(normaliseVariantId(unsafe)).toBeNull();
  });

  it('accepts a safe integer supplied as a number', () => {
    expect(normaliseVariantId(4321567)).toBe('4321567');
  });
});

describe('normaliseStoreDomain', () => {
  it.each([
    ['a bare hostname', DOMAIN],
    ['an https prefix', `https://${DOMAIN}`],
    ['an http prefix', `http://${DOMAIN}`],
    ['a trailing slash', `https://${DOMAIN}/`],
    ['mixed case', `HTTPS://TreveanLiving.COM`],
    ['surrounding whitespace', `  ${DOMAIN} `],
  ])('accepts %s', (_label, input) => {
    expect(normaliseStoreDomain(input)).toBe(DOMAIN);
  });

  it('accepts a myshopify host and a subdomain, both of which are realistic here', () => {
    expect(normaliseStoreDomain('trevean.myshopify.com')).toBe('trevean.myshopify.com');
    expect(normaliseStoreDomain('shop.treveanspice.com')).toBe('shop.treveanspice.com');
  });

  it.each([
    ['empty, which is what unconfigured looks like', ''],
    ['a path', `${DOMAIN}/collections/all`],
    ['a port', `${DOMAIN}:8080`],
    ['credentials', `user:pass@${DOMAIN}`],
    ['a query string', `${DOMAIN}?a=1`],
    ['a single label with no TLD', 'localhost'],
    ['inner whitespace', 'trevean living.com'],
    ['a leading dot', `.${DOMAIN}`],
    ['a double dot', 'treveanliving..com'],
    ['a label opening with a hyphen', '-trevean.com'],
    ['null', null],
    ['a number', 12345],
  ])('refuses %s', (_label, input) => {
    expect(normaliseStoreDomain(input)).toBeNull();
  });
});

describe('buildCartPermalink', () => {
  it('builds the permalink Shopify documents, defaulting to one jar', () => {
    expect(buildCartPermalink({ storeDomain: DOMAIN, variantId: VARIANT })).toBe(
      `https://${DOMAIN}/cart/${VARIANT}:1`,
    );
  });

  it('honours an explicit quantity', () => {
    expect(buildCartPermalink({ storeDomain: DOMAIN, variantId: VARIANT, quantity: 3 })).toBe(
      `https://${DOMAIN}/cart/${VARIANT}:3`,
    );
  });

  it('normalises both halves in one call, so a pasted gid and a pasted URL both work', () => {
    expect(
      buildCartPermalink({
        storeDomain: `https://${DOMAIN}/`,
        variantId: `gid://shopify/ProductVariant/${VARIANT}`,
      }),
    ).toBe(`https://${DOMAIN}/cart/${VARIANT}:1`);
  });

  it('returns null when the store domain is unconfigured, which is the normal state today', () => {
    expect(buildCartPermalink({ storeDomain: '', variantId: VARIANT })).toBeNull();
  });

  it('returns null when the blend has no variant id, which is the normal state today', () => {
    expect(buildCartPermalink({ storeDomain: DOMAIN, variantId: null })).toBeNull();
  });

  it.each([
    ['zero', 0],
    ['negative', -1],
    ['fractional', 1.5],
    ['above the Shopify line limit', 1000],
    ['not a number', 'two'],
  ])('returns null for a %s quantity rather than clamping it', (_label, quantity) => {
    expect(buildCartPermalink({ storeDomain: DOMAIN, variantId: VARIANT, quantity })).toBeNull();
  });

  it('never throws, on any input, because a thrown error would fail a page render', () => {
    const hostile: unknown[] = [null, undefined, '', 0, NaN, {}, [], Symbol('x'), () => {}];
    for (const storeDomain of hostile) {
      for (const variantId of hostile) {
        expect(() => buildCartPermalink({ storeDomain, variantId })).not.toThrow();
      }
    }
  });

  it('emits only https, so a downgraded domain cannot produce an http checkout link', () => {
    const url = buildCartPermalink({ storeDomain: `http://${DOMAIN}`, variantId: VARIANT });
    expect(url?.startsWith('https://')).toBe(true);
  });
});

/**
 * The real variant IDs, as supplied by the client on Thursday 17 September 2026 at
 * 6:11 PM.
 *
 * Locked here deliberately. These five numbers are the entire per blend input the
 * reorder button needs, they took three days and four messages to obtain, and a
 * fixture edit could silently blank one without any other test noticing. **The
 * failure this guards is a single blend whose reorder button quietly stops
 * working while the other four keep going**, which is exactly the kind of thing
 * that survives a demo and is found by a customer.
 *
 * If Shopify ever reissues one, change it here and in the fixture together.
 */
const VARIANT_IDS: Record<string, string> = {
  'persian-sunrise': '44647379337319',
  'caribbean-sunset': '44647352336487',
  'kyoto-garden': '44647354794087',
  'north-african-night-market': '44647378321511',
  'silk-road': '44647355252839',
};

describe('the blend fixtures carry the client supplied variant IDs', () => {
  const dir = new URL('../../../content/fixtures/blends/', import.meta.url);
  const blends = readdirSync(dir).map((f) => JSON.parse(readFileSync(new URL(f, dir), 'utf8')).blend);

  it('every fixture has a variant id', () => {
    expect(blends).toHaveLength(5);
    for (const blend of blends) {
      expect(blend.shopify?.variantId, `${blend.slug} has no variant id`).toBeTruthy();
    }
  });

  it('each variant id is the one the client sent', () => {
    for (const blend of blends) {
      expect(blend.shopify.variantId, `${blend.slug}`).toBe(VARIANT_IDS[blend.slug]);
    }
  });

  it('every variant id survives normalisation, so none is a typo or a product id', () => {
    // A product id would normalise fine too, so this is not a type check. What it
    // catches is a pasted GID, a stray space, or a digit lost in transcription.
    for (const blend of blends) {
      expect(normaliseVariantId(blend.shopify.variantId)).toBe(blend.shopify.variantId);
    }
  });

  it('cartPermalinkUrl stays null in the fixtures, because the domain is still moving', () => {
    // The permalink is derived at read time from SHOPIFY_STORE_DOMAIN. Freezing one
    // into a fixture would bake in a domain the client is in the middle of changing.
    for (const blend of blends) {
      expect(blend.shopify.cartPermalinkUrl, `${blend.slug}`).toBeNull();
    }
  });

  it('produces no permalink today, because the store domain is not configured yet', () => {
    for (const blend of blends) {
      expect(buildCartPermalink({ storeDomain: '', variantId: blend.shopify.variantId })).toBeNull();
    }
  });

  it('produces the real checkout links once the domain is set', () => {
    for (const blend of blends) {
      expect(buildCartPermalink({ storeDomain: 'shop.treveanspice.com', variantId: blend.shopify.variantId })).toBe(
        `https://shop.treveanspice.com/cart/${VARIANT_IDS[blend.slug]}:1`,
      );
    }
  });
});
