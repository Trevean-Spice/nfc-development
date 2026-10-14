import { describe, expect, it } from 'vitest';
import {
  buildCartPermalink,
  buildReorderPermalink,
  CartPermalinkError,
  normaliseStorefrontBase,
} from '../src/permalink.js';

/*
 * Cart permalink construction is pure string building, so it is fully provable today with
 * no Shopify Plus store access. That makes this file the strongest evidence in the
 * deliverable, and it is written to earn that rather than to decorate it.
 *
 * Three groups: the shape the frozen contract specifies, the inputs that must be refused,
 * and the properties the pre-rendered page depends on.
 */

const BASE = 'https://shop.treveanspice.com';

describe('the shape the frozen API contract specifies', () => {
  it('reproduces the CatalogEntry example from the frozen contract exactly', () => {
    // Frozen M1 API contract, version 1.0.0, components.schemas.CatalogEntry, example
    // persianSunrise. If this assertion ever fails, either the contract moved or we did,
    // and both are things somebody has to be told about rather than fix quietly.
    expect(
      buildReorderPermalink({ storefrontBase: BASE, variantId: '41802938471233' }),
    ).toBe('https://shop.treveanspice.com/cart/41802938471233:1?channel=nfc');
  });

  it('accepts the GID form the contract stores and emits the numeric form the URL needs', () => {
    expect(
      buildReorderPermalink({
        storefrontBase: BASE,
        variantId: 'gid://shopify/ProductVariant/41802938471233',
      }),
    ).toBe('https://shop.treveanspice.com/cart/41802938471233:1?channel=nfc');
  });

  it('builds a multi item cart', () => {
    expect(
      buildCartPermalink({
        storefrontBase: BASE,
        lines: [
          { variantId: '41802938471233', quantity: 2 },
          { variantId: 'gid://shopify/ProductVariant/41802938536769', quantity: 1 },
        ],
      }),
    ).toBe('https://shop.treveanspice.com/cart/41802938471233:2,41802938536769:1');
  });

  it('carries a discount code', () => {
    expect(
      buildCartPermalink({
        storefrontBase: BASE,
        lines: [{ variantId: '41802938471233', quantity: 1 }],
        discountCode: 'WELCOME10',
      }),
    ).toBe('https://shop.treveanspice.com/cart/41802938471233:1?discount=WELCOME10');
  });

  it('emits cart attributes only in cart-attributes mode, because only those reach the order', () => {
    expect(
      buildReorderPermalink({ storefrontBase: BASE, variantId: '41802938471233', attributionMode: 'cart-attributes' }),
    ).toBe('https://shop.treveanspice.com/cart/41802938471233:1?attributes%5Bchannel%5D=nfc');
  });

  it('refuses attributes in contract mode rather than silently dropping them', () => {
    expect(() =>
      buildCartPermalink({
        storefrontBase: BASE,
        lines: [{ variantId: '41802938471233', quantity: 1 }],
        attributes: { channel: 'nfc' },
      }),
    ).toThrow(CartPermalinkError);
  });
});

describe('inputs that must be refused, because the output is an href on a customer page', () => {
  it.each([
    ['http, not https', 'http://shop.treveanspice.com', 'storefront_base_not_https'],
    ['a path', 'https://shop.treveanspice.com/collections', 'storefront_base_not_origin'],
    ['a query string', 'https://shop.treveanspice.com/?x=1', 'storefront_base_not_origin'],
    ['a fragment', 'https://shop.treveanspice.com/#x', 'storefront_base_not_origin'],
    ['embedded credentials', 'https://user:pass@shop.treveanspice.com', 'storefront_base_has_credentials'],
    ['a port', 'https://shop.treveanspice.com:8443', 'storefront_base_has_port'],
    ['not a URL at all', 'shop.treveanspice.com', 'storefront_base_invalid'],
    ['empty', '', 'storefront_base_missing'],
  ])('rejects a storefront base with %s', (_label, base, code) => {
    try {
      normaliseStorefrontBase(base);
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(CartPermalinkError);
      expect((error as CartPermalinkError).code).toBe(code);
    }
  });

  it('enforces the host allowlist, which is what stops one wrong environment variable pointing every jar at another checkout', () => {
    expect(() =>
      buildReorderPermalink({
        storefrontBase: 'https://shop.attacker.example',
        variantId: '41802938471233',
        allowedHosts: ['shop.treveanspice.com'],
      }),
    ).toThrow(/not on the allowlist/);
  });

  it.each([
    ['a path traversal', '../../evil'],
    ['a second path segment', '41802938471233/evil'],
    ['a query terminator', '41802938471233?x=1'],
    ['a fragment terminator', '41802938471233#x'],
    ['a quantity separator', '41802938471233:9'],
    ['a line separator', '41802938471233,1'],
    ['whitespace and a segment', '41802938471233 /evil'],
    ['a leading zero', '041802938471233'],
    ['a non digit', '4180293847123x'],
    ['empty', ''],
    ['a bare zero', '0'],
    ['21 digits', '123456789012345678901'],
  ])('refuses a variant id carrying %s, rather than interpolating it', (_label, variantId) => {
    // Every one of these, interpolated rather than validated, produces a working link to
    // somewhere other than a Trevean cart.
    expect(() =>
      buildCartPermalink({ storefrontBase: BASE, lines: [{ variantId, quantity: 1 }] }),
    ).toThrow(CartPermalinkError);
    expect(buildReorderPermalink({ storefrontBase: BASE, variantId })).toBeNull();
  });

  it.each([
    ['zero', 0],
    ['negative', -1],
    ['fractional', 1.5],
    ['above the cap', 1000],
    ['not a number', '1' as unknown as number],
  ])('refuses a %s quantity', (_label, quantity) => {
    expect(() =>
      buildCartPermalink({ storefrontBase: BASE, lines: [{ variantId: '41802938471233', quantity }] }),
    ).toThrow(CartPermalinkError);
  });

  it('refuses a selling plan, because a permalink cannot carry one and dropping it silently sells a one off as a subscription', () => {
    expect(() =>
      buildCartPermalink({
        storefrontBase: BASE,
        lines: [{ variantId: '41802938471233', quantity: 1, sellingPlanId: '12345' }],
      }),
    ).toThrow(/selling plan/i);
  });

  it('refuses an empty cart', () => {
    expect(() => buildCartPermalink({ storefrontBase: BASE, lines: [] })).toThrow(CartPermalinkError);
  });

  it('encodes a query value that tries to graft on a parameter of its own', () => {
    const url = buildCartPermalink({
      storefrontBase: BASE,
      lines: [{ variantId: '41802938471233', quantity: 1 }],
      discountCode: 'X&discount=Y#z',
    });
    const parsed = new URL(url);
    expect(parsed.searchParams.get('discount')).toBe('X&discount=Y#z');
    expect([...parsed.searchParams.keys()]).toEqual(['discount']);
    expect(parsed.hash).toBe('');
  });
});

describe('properties the pre-rendered page depends on', () => {
  it('is deterministic: the same inputs produce byte identical output, so a rebuild is not a diff', () => {
    const build = () =>
      buildCartPermalink({
        storefrontBase: BASE,
        lines: [{ variantId: '41802938471233', quantity: 1 }],
        discountCode: 'WELCOME10',
        ref: 'jar',
        note: 'from the lid',
        extraParams: { channel: 'nfc' },
      });
    expect(build()).toBe(build());
  });

  it('orders query parameters by key regardless of the order they were supplied', () => {
    const a = buildCartPermalink({
      storefrontBase: BASE,
      lines: [{ variantId: '41802938471233', quantity: 1 }],
      extraParams: { channel: 'nfc', zeta: '1', alpha: '2' },
    });
    expect(a).toBe('https://shop.treveanspice.com/cart/41802938471233:1?alpha=2&channel=nfc&zeta=1');
  });

  it('produces a URL that parses back to the same cart, which is the only end to end check available without a store', () => {
    const url = buildReorderPermalink({ storefrontBase: BASE, variantId: '41802938471233', quantity: 3 });
    const parsed = new URL(url as string);
    expect(parsed.protocol).toBe('https:');
    expect(parsed.hostname).toBe('shop.treveanspice.com');
    expect(parsed.pathname).toBe('/cart/41802938471233:3');
    expect(parsed.searchParams.get('channel')).toBe('nfc');
  });

  it('returns null rather than throwing when there is no variant id, because that is every blend today', () => {
    expect(buildReorderPermalink({ storefrontBase: BASE, variantId: null })).toBeNull();
    expect(buildReorderPermalink({ storefrontBase: BASE, variantId: undefined })).toBeNull();
  });

  it('normalises a trailing slash on the storefront base rather than emitting a double slash', () => {
    expect(buildReorderPermalink({ storefrontBase: 'https://shop.treveanspice.com/', variantId: '41802938471233' })).toBe(
      'https://shop.treveanspice.com/cart/41802938471233:1?channel=nfc',
    );
  });
});
