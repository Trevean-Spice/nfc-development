// Ground truth that the specification and the implementation are both checked against.
//
// These values are deliberately written out rather than read from the OpenAPI document.
// They are the facts of the engagement: five blends, four encoded tag codes plus one
// reserved, 1,000 tags encoded on 24 July 2026 with treveanspice.com/t/{code}. If someone
// renames a slug in the specification, the specification stops matching this file and the
// suite fails. That is the only way a rename gets noticed before it strands inventory.
//
// Source: the Data model document, section 7.2, and the frozen API contract, section 10.

export const REAL_BLEND_SLUGS = [
  'persian-sunrise',
  'caribbean-sunset',
  'north-african-night-market',
  'silk-road',
  'kyoto-garden',
] as const;

export type BlendSlug = (typeof REAL_BLEND_SLUGS)[number];

/** The two blends with real launch content. The other three are seeded. */
export const LAUNCH_BLEND_SLUGS: BlendSlug[] = ['persian-sunrise', 'caribbean-sunset'];

export interface TagMapEntry {
  code: string;
  blendSlug: BlendSlug;
  requestPath: string;
  targetPath: string;
  unitsEncoded: number;
  status: 'encoded' | 'reserved';
}

/**
 * The deployed redirect table. A one character mismatch between a code, its NDEF URI and
 * its target path opens the wrong blend on 250 jars, which is why every field is stated
 * here in full rather than derived.
 */
export const TAG_CODE_MAP: TagMapEntry[] = [
  {
    code: 'ps',
    blendSlug: 'persian-sunrise',
    requestPath: '/t/ps',
    targetPath: '/blend.html?blend=persian-sunrise&via=nfc',
    unitsEncoded: 250,
    status: 'encoded',
  },
  {
    code: 'cs',
    blendSlug: 'caribbean-sunset',
    requestPath: '/t/cs',
    targetPath: '/blend.html?blend=caribbean-sunset&via=nfc',
    unitsEncoded: 250,
    status: 'encoded',
  },
  {
    code: 'sr',
    blendSlug: 'silk-road',
    requestPath: '/t/sr',
    targetPath: '/blend.html?blend=silk-road&via=nfc',
    unitsEncoded: 250,
    status: 'encoded',
  },
  {
    code: 'nm',
    blendSlug: 'north-african-night-market',
    requestPath: '/t/nm',
    targetPath: '/blend.html?blend=north-african-night-market&via=nfc',
    unitsEncoded: 250,
    status: 'encoded',
  },
  {
    code: 'kg',
    blendSlug: 'kyoto-garden',
    requestPath: '/t/kg',
    targetPath: '/blend.html?blend=kyoto-garden&via=nfc',
    unitsEncoded: 0,
    status: 'reserved',
  },
];

/** Four codes at 250 units each, received 24 July 2026. */
export const TOTAL_TAGS_ENCODED = 1000;

/** NFC Forum Type 5 / ISO 15693. Not NTAG21x and not Type 2. */
export const CHIP_PART_NUMBER = 'ST25TV02KC';

/** 307 preserves the method and is explicitly temporary. A 301 would strand inventory. */
export const REDIRECT_STATUS = 307;

/** A slug that is well formed but is not one of the five. Used for the 404 checks. */
export const UNKNOWN_BLEND_SLUG = 'persian-sunrize';

/** A blend that exists but is not published, so an unauthenticated read must 404. */
export const UNPUBLISHED_BLEND_SLUG = 'kyoto-garden';

let dedupCounter = 0;

/** A fresh 128 bit lowercase hex dedup token, the shape a browser generates. */
export function newDedupToken(): string {
  const bytes = new Uint8Array(16);
  const now = BigInt(Date.now()) * 1000n + BigInt(dedupCounter++);
  for (let index = 0; index < 8; index += 1) {
    bytes[index] = Number((now >> BigInt(index * 8)) & 0xffn);
  }
  for (let index = 8; index < 16; index += 1) {
    bytes[index] = Math.floor(Math.random() * 256);
  }
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function isoNow(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** A well formed beacon body, the exact shape navigator.sendBeacon posts after paint. */
export function scanEventBody(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    blendSlug: 'persian-sunrise',
    tagCode: 'ps',
    channel: 'nfc',
    dedupToken: newDedupToken(),
    occurredAt: isoNow(),
    platform: 'ios',
    deviceFamily: 'iPhone',
    connectionType: '4g',
    cacheStatus: 'hit',
    ttfbMs: 184,
    timeToReadableMs: 1120,
    pageVersion: 12,
    redirected: true,
    ...overrides,
  };
}
