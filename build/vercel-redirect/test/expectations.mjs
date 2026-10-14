/**
 * What the redirect must do, transcribed by hand from the contract documents.
 *
 * Nothing in this file is derived from the redirect table, from the compiler, or
 * from dist/. That is the whole point. A test whose expectations are generated
 * from the thing under test cannot catch a transposed pair, and a transposed
 * pair is the failure that matters: it produces a fast, successful, 200
 * returning page showing the wrong blend, and it passes every smoke test that
 * looks at status codes.
 *
 * Sources, by title and section, per the repository convention:
 *   Scope, section "Tag code map", for the code to blend mapping and for which
 *     codes are on physical tags.
 *   "M1 Deliverable 3: Redirect-Serving Decision and Apex Domain Routing",
 *     section 5, for the status, the Location shape and the normalisation rules.
 *   "M1 Deliverable 14: QR attribution", section 10, for the /q/{code} route.
 */

/** Scope, section "Tag code map". Five codes, four of them encoded onto silicon. */
export const CODE_TO_SLUG = {
  ps: 'persian-sunrise',
  cs: 'caribbean-sunset',
  sr: 'silk-road',
  nm: 'north-african-night-market',
  kg: 'kyoto-garden'
};

/** Scope, section "Tag code map". Kyoto Garden is reserved and was never encoded. */
export const ON_PHYSICAL_TAGS = ['ps', 'cs', 'sr', 'nm'];
export const RESERVED = ['kg'];
export const UNITS_PER_ENCODED_CODE = 250;
export const TOTAL_UNITS_ENCODED = 1000;

/** "M1 Deliverable 3", section 5, "The table". */
export const EXPECTED_LOCATION = {
  ps: '/blend.html?blend=persian-sunrise&via=nfc',
  cs: '/blend.html?blend=caribbean-sunset&via=nfc',
  sr: '/blend.html?blend=silk-road&via=nfc',
  nm: '/blend.html?blend=north-african-night-market&via=nfc',
  kg: '/blend.html?blend=kyoto-garden&via=nfc'
};

/** "M1 Deliverable 14: QR attribution", section 10, "The artwork sheet, for the next print run". */
export const EXPECTED_QR_LOCATION = {
  ps: '/blend.html?blend=persian-sunrise&via=qr',
  cs: '/blend.html?blend=caribbean-sunset&via=qr',
  sr: '/blend.html?blend=silk-road&via=qr',
  nm: '/blend.html?blend=north-african-night-market&via=qr',
  kg: '/blend.html?blend=kyoto-garden&via=qr'
};

export const CODES = Object.keys(EXPECTED_LOCATION);

/** "M1 Deliverable 3", section 5, "Status code". */
export const EXPECTED_STATUS = 307;
export const FORBIDDEN_STATUSES = [301, 302, 308];
