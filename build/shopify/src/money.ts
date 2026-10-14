/*
 * Shopify decimal money strings to integer minor units, without floating point.
 *
 * Shopify returns money as a decimal string: "24.00", "19.99", "8.20". The frozen API
 * contract stores minor units as an integer: 2400, 1999, 820. The obvious conversion is
 * Math.round(parseFloat(s) * 100), and it is obvious because it is nearly right: it holds
 * for every two-decimal value anyone will type into a test.
 *
 * It is not right in general. It silently assumes two decimal places, which is wrong for
 * JPY (zero) and for KWD (three), and it routes an exact decimal through a binary float
 * for no reason at all when the input is already a string of digits. This module does the
 * conversion on the string, so the result is either exact or an explicit failure.
 *
 * The failure case matters as much as the success case. A price that cannot be converted
 * exactly returns null and the mirror stores no price, because the page degrades to no
 * price gracefully and there is no graceful way to degrade to a wrong one.
 */

import type { Money } from './types.js';

/** ISO 4217 currencies with no minor unit. */
const ZERO_DECIMAL = new Set([
  'BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW',
  'PYG', 'RWF', 'UGX', 'UYI', 'VND', 'VUV', 'XAF', 'XOF', 'XPF',
]);

/** ISO 4217 currencies with three minor digits. */
const THREE_DECIMAL = new Set(['BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND']);

export function minorUnitExponent(currency: string): number {
  const code = currency.toUpperCase();
  if (ZERO_DECIMAL.has(code)) return 0;
  if (THREE_DECIMAL.has(code)) return 3;
  return 2;
}

const DECIMAL = /^(\d+)(?:\.(\d+))?$/;

/**
 * "24.00" with USD -> 2400. "1250" with JPY -> 1250. "1.2345" with USD -> null, because
 * rounding it would invent a price nobody quoted.
 */
export function decimalToMinorUnits(amount: string, currency: string): number | null {
  if (typeof amount !== 'string') return null;
  const trimmed = amount.trim();
  const match = DECIMAL.exec(trimmed);
  if (!match) return null;

  const whole = match[1] ?? '';
  const fraction = match[2] ?? '';
  const exponent = minorUnitExponent(currency);

  if (fraction.length > exponent) {
    // Trailing zeros beyond the currency's precision are harmless: "24.000" in USD is 2400.
    // Anything else is a real digit that would be lost.
    const excess = fraction.slice(exponent);
    if (/[^0]/.test(excess)) return null;
  }

  const padded = (fraction + '0'.repeat(exponent)).slice(0, exponent);
  const combined = `${whole}${padded}`;
  // Strip leading zeros so Number.parseInt never sees an oversized string of them.
  const value = Number.parseInt(combined.replace(/^0+(?=\d)/, ''), 10);
  if (!Number.isSafeInteger(value)) return null;
  return value;
}

/** Build a contract Money, or null when the input cannot be converted exactly. */
export function toMoney(amount: string | null | undefined, currency: string | null | undefined): Money | null {
  if (amount === null || amount === undefined) return null;
  if (!currency || !/^[A-Za-z]{3}$/.test(currency)) return null;
  const minor = decimalToMinorUnits(amount, currency);
  if (minor === null) return null;
  return { amount: minor, currency: currency.toUpperCase() };
}
