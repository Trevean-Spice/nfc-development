import { describe, expect, it } from 'vitest';
import { canonicalVariantGid, isNumericId, normaliseProductId, normaliseVariantId, parseGid, toGid } from '../src/ids.js';
import { decimalToMinorUnits, minorUnitExponent, toMoney } from '../src/money.js';

describe('Shopify identifiers', () => {
  it('parses the GID form the frozen contract stores', () => {
    expect(parseGid('gid://shopify/ProductVariant/41802938471233')).toEqual({
      resource: 'ProductVariant',
      id: '41802938471233',
    });
  });

  it('refuses a GID of the wrong resource, so a product id cannot become a variant id', () => {
    expect(parseGid('gid://shopify/Product/7391043289601', 'ProductVariant')).toBeNull();
    expect(normaliseVariantId('gid://shopify/Product/7391043289601')).toBeNull();
    expect(normaliseProductId('gid://shopify/ProductVariant/41802938471233')).toBeNull();
  });

  it('drops a GID query string rather than concatenating it into an id', () => {
    expect(parseGid('gid://shopify/ProductVariant/41802938471233?namespace=x')).toEqual({
      resource: 'ProductVariant',
      id: '41802938471233',
    });
  });

  it.each([
    'gid://shopify/ProductVariant/',
    'gid://shopify/ProductVariant/abc',
    'gid://shopify/ProductVariant/0',
    'gid://shopify/ProductVariant/041802938471233',
    'gid://shopify/ProductVariant/4180/2938471233',
    'gid://elsewhere/ProductVariant/41802938471233',
    'ProductVariant/41802938471233',
    '',
  ])('rejects the malformed GID %s', (gid) => {
    expect(parseGid(gid)).toBeNull();
  });

  it('round trips numeric to GID and back', () => {
    expect(canonicalVariantGid('41802938471233')).toBe('gid://shopify/ProductVariant/41802938471233');
    expect(normaliseVariantId(canonicalVariantGid('41802938471233'))).toBe('41802938471233');
  });

  it('throws when asked to build a GID from a value that is not an id', () => {
    expect(() => toGid('ProductVariant', 'abc')).toThrow(TypeError);
  });

  it('treats leading zeros and oversized values as not ids', () => {
    expect(isNumericId('0')).toBe(false);
    expect(isNumericId('0123')).toBe(false);
    expect(isNumericId('1'.repeat(21))).toBe(false);
    expect(isNumericId('1'.repeat(20))).toBe(true);
  });

  it('trims surrounding whitespace but does not accept internal whitespace', () => {
    expect(normaliseVariantId('  41802938471233  ')).toBe('41802938471233');
    expect(normaliseVariantId('418029 38471233')).toBeNull();
  });
});

describe('money, converted on the string rather than through a float', () => {
  it('handles the ordinary two decimal cases', () => {
    expect(decimalToMinorUnits('24.00', 'USD')).toBe(2400);
    expect(decimalToMinorUnits('19.99', 'USD')).toBe(1999);
    expect(decimalToMinorUnits('8.20', 'USD')).toBe(820);
    expect(decimalToMinorUnits('0.01', 'USD')).toBe(1);
    expect(decimalToMinorUnits('0', 'USD')).toBe(0);
    expect(decimalToMinorUnits('24', 'USD')).toBe(2400);
    expect(decimalToMinorUnits('24.5', 'USD')).toBe(2450);
  });

  it('gets the currencies a two decimal assumption breaks', () => {
    expect(minorUnitExponent('JPY')).toBe(0);
    expect(minorUnitExponent('KWD')).toBe(3);
    expect(decimalToMinorUnits('1250', 'JPY')).toBe(1250);
    expect(decimalToMinorUnits('12.345', 'KWD')).toBe(12345);
  });

  it('returns null rather than rounding away a digit somebody quoted', () => {
    // The Admin fixture carries 23.995 on North African Night Market precisely so this
    // path is exercised by the sync test as well as here. A price that cannot be
    // represented exactly is stored as no price, and the page degrades to no price.
    expect(decimalToMinorUnits('23.995', 'USD')).toBeNull();
    expect(decimalToMinorUnits('1.2345', 'USD')).toBeNull();
    expect(decimalToMinorUnits('1250.5', 'JPY')).toBeNull();
  });

  it('accepts trailing zeros beyond the currency precision, which lose nothing', () => {
    expect(decimalToMinorUnits('24.000', 'USD')).toBe(2400);
    expect(decimalToMinorUnits('1250.00', 'JPY')).toBe(1250);
  });

  it.each(['', ' ', 'abc', '24.00 USD', '-24.00', '+24.00', '2,400.00', '1e3', '24.', '.24', 'Infinity', 'NaN'])(
    'rejects the malformed amount %s',
    (amount) => {
      expect(decimalToMinorUnits(amount, 'USD')).toBeNull();
    },
  );

  it('does not inherit the float error that Math.round(parseFloat(x) * 100) is built on', () => {
    // 8.20 * 100 is 819.9999999999999 in IEEE 754. Math.round rescues that particular
    // case; this conversion never enters the state that needs rescuing.
    expect(8.2 * 100).not.toBe(820);
    expect(decimalToMinorUnits('8.20', 'USD')).toBe(820);
  });

  it('builds a contract Money, or null when it cannot be built exactly', () => {
    expect(toMoney('24.00', 'usd')).toEqual({ amount: 2400, currency: 'USD' });
    expect(toMoney('24.00', null)).toBeNull();
    expect(toMoney(null, 'USD')).toBeNull();
    expect(toMoney('24.00', 'DOLLARS')).toBeNull();
    expect(toMoney('23.995', 'USD')).toBeNull();
  });
});
