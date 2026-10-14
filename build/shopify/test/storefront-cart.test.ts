import { describe, expect, it } from 'vitest';
import { buildCartCreate, CART_CREATE_MUTATION, StorefrontCartError } from '../src/storefront/cart.js';
import { HttpStorefrontTransport, RecordedStorefrontTransport } from '../src/storefront/transport.js';
import { StaticCredentialProvider } from '../src/config.js';

/*
 * The Storefront API builders. Pure, so they are testable now; the transport that sends
 * them is not, and awaits store access.
 */

describe('cartCreate request building', () => {
  it('builds a single line cart with the merchandise GID Shopify expects', () => {
    const { query, variables } = buildCartCreate({ lines: [{ variantId: '41802938471233', quantity: 1 }] });
    expect(query).toBe(CART_CREATE_MUTATION);
    expect(variables).toEqual({
      input: { lines: [{ merchandiseId: 'gid://shopify/ProductVariant/41802938471233', quantity: 1 }] },
    });
  });

  it('accepts either identifier form and always emits the GID', () => {
    const { variables } = buildCartCreate({
      lines: [{ variantId: 'gid://shopify/ProductVariant/41802938471233', quantity: 2 }],
    });
    expect((variables['input'] as { lines: unknown[] }).lines[0]).toEqual({
      merchandiseId: 'gid://shopify/ProductVariant/41802938471233',
      quantity: 2,
    });
  });

  it('attaches a selling plan, which is the thing a cart permalink cannot do', () => {
    const { variables } = buildCartCreate({
      lines: [{ variantId: '41802938471233', quantity: 1, sellingPlanId: '610632' }],
    });
    expect((variables['input'] as { lines: Array<Record<string, unknown>> }).lines[0]?.['sellingPlanId']).toBe(
      'gid://shopify/SellingPlan/610632',
    );
  });

  it('builds a multi item cart with discount codes and attributes', () => {
    const { variables } = buildCartCreate({
      lines: [
        { variantId: '41802938471233', quantity: 1 },
        { variantId: '41802938536769', quantity: 2 },
      ],
      discountCodes: ['WELCOME10'],
      attributes: { channel: 'nfc', blend: 'persian-sunrise' },
      note: 'Reordered from the jar',
    });
    expect(variables['input']).toEqual({
      lines: [
        { merchandiseId: 'gid://shopify/ProductVariant/41802938471233', quantity: 1 },
        { merchandiseId: 'gid://shopify/ProductVariant/41802938536769', quantity: 2 },
      ],
      discountCodes: ['WELCOME10'],
      // Sorted, so a cart built twice from the same inputs produces the same request.
      attributes: [
        { key: 'blend', value: 'persian-sunrise' },
        { key: 'channel', value: 'nfc' },
      ],
      note: 'Reordered from the jar',
    });
  });

  it('takes a country code on buyerIdentity and nothing else', () => {
    const { variables } = buildCartCreate({
      lines: [{ variantId: '41802938471233', quantity: 1 }],
      buyerIdentity: { countryCode: 'us' },
    });
    expect((variables['input'] as Record<string, unknown>)['buyerIdentity']).toEqual({ countryCode: 'US' });
    // No email, no phone, no customer access token. Widening this object is how "Shopify
    // holds the customer relationship and this system holds none of it" stops being true.
    expect(JSON.stringify(variables)).not.toMatch(/email|phone|customerAccessToken/i);
  });

  it.each([
    ['no lines', { lines: [] }],
    ['a malformed variant id', { lines: [{ variantId: 'x', quantity: 1 }] }],
    ['a zero quantity', { lines: [{ variantId: '41802938471233', quantity: 0 }] }],
    ['a fractional quantity', { lines: [{ variantId: '41802938471233', quantity: 1.5 }] }],
    ['a malformed selling plan', { lines: [{ variantId: '41802938471233', quantity: 1, sellingPlanId: 'nope' }] }],
  ])('refuses %s', (_label, options) => {
    expect(() => buildCartCreate(options as Parameters<typeof buildCartCreate>[0])).toThrow(StorefrontCartError);
  });

  it('omits empty optionals rather than sending nulls Shopify would reject', () => {
    const { variables } = buildCartCreate({
      lines: [{ variantId: '41802938471233', quantity: 1 }],
      discountCodes: [],
      attributes: {},
      note: null,
    });
    expect(Object.keys(variables['input'] as object)).toEqual(['lines']);
  });
});

describe('the storefront transport boundary', () => {
  it('builds the endpoint from a pinned API version', () => {
    const transport = new HttpStorefrontTransport({
      storefrontDomain: 'shop.treveanspice.com',
      apiVersion: '2025-01',
      accessTokenSecretName: 'trevean/shopify/storefront-access-token',
      credentials: new StaticCredentialProvider({ 'trevean/shopify/storefront-access-token': 'not-a-real-token' }),
    });
    expect(transport.endpoint).toBe('https://shop.treveanspice.com/api/2025-01/graphql.json');
  });

  it('replays a recorded response without a network', async () => {
    const transport = new RecordedStorefrontTransport([
      { data: { cartCreate: { cart: { id: 'gid://shopify/Cart/abc', checkoutUrl: 'https://shop.treveanspice.com/checkout' }, userErrors: [] } } },
    ]);
    const response = await transport.execute(buildCartCreate({ lines: [{ variantId: '41802938471233', quantity: 1 }] }));
    expect((response.data as { cartCreate: { cart: { checkoutUrl: string } } }).cartCreate.cart.checkoutUrl).toContain('/checkout');
    expect(transport.requests).toHaveLength(1);
  });
});
