// Configuration for the contract test suite.
//
// Everything here is settable by environment variable so that the identical suite
// runs against a local stub, the staging host, and later production. Nothing about
// a target host is hard coded anywhere else in the suite.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const thisDir = path.dirname(fileURLToPath(import.meta.url));

/** Root of the contract-tests package, whether running from src or dist. */
export const packageRoot = path.resolve(thisDir, '..');

function str(name: string, fallback: string): string {
  const raw = process.env[name];
  return raw === undefined || raw === '' ? fallback : raw;
}

function optional(name: string): string | undefined {
  const raw = process.env[name];
  return raw === undefined || raw === '' ? undefined : raw;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = optional(name);
  if (raw === undefined) return fallback;
  return raw.toLowerCase() === 'true' || raw === '1' || raw.toLowerCase() === 'yes';
}

function num(name: string, fallback: number): number {
  const raw = optional(name);
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Environment variable ${name} must be a number, got ${JSON.stringify(raw)}.`);
  }
  return parsed;
}

/** The default location of the frozen M1 OpenAPI document inside this repository. */
const defaultSpecPath = path.resolve(
  packageRoot,
  '..',
  '..',
  'deliverables',
  'm1',
  '01-api-contract.openapi.yaml',
);

export const config = {
  /** Base URL of the API under test. No trailing slash. */
  baseUrl: str('CONTRACT_TEST_BASE_URL', 'http://127.0.0.1:3001').replace(/\/+$/, ''),

  /**
   * True only when the target is this package's own stub, which is set by the stub runner
   * and by nothing else. A handful of fixtures depend on values only the stub recognises,
   * such as a token string it treats as expired. Those cannot be constructed against a real
   * API, because minting an expired but correctly signed token needs the signing key. This
   * flag is what gates them. It must not be inferred from the host: a real API run locally
   * is on localhost too, and inferring it there runs stub fixtures against an
   * implementation that has no way to satisfy them.
   */
  isStub: bool('CONTRACT_TEST_STUB', false),

  /** Path to the OpenAPI 3.1 document that governs the wire format. */
  specPath: str('CONTRACT_TEST_SPEC_PATH', defaultSpecPath),

  /** Bearer tokens, one per role. Absent tokens cause the role specific tests to be skipped. */
  tokens: {
    admin: optional('CONTRACT_TEST_TOKEN_ADMIN'),
    editor: optional('CONTRACT_TEST_TOKEN_EDITOR'),
    viewer: optional('CONTRACT_TEST_TOKEN_VIEWER'),
  },

  /**
   * Whether the suite may create, update, publish and delete content on the target.
   * Set to false when pointing the suite at production. The unauthenticated write
   * rejection tests still run, because they are read only in effect: they assert that
   * the server refuses.
   */
  allowWrites: bool('CONTRACT_TEST_ALLOW_WRITES', true),

  /** Origin the blend page is served from. Used for the beacon CORS checks. */
  pageOrigin: str('CONTRACT_TEST_PAGE_ORIGIN', 'https://treveanspice.com'),

  /** Latency probe settings for the content retrieval target in section 6 of the contract. */
  latency: {
    samples: num('CONTRACT_TEST_LATENCY_SAMPLES', 30),
    warmup: num('CONTRACT_TEST_LATENCY_WARMUP', 3),
    budgetMs: num('CONTRACT_TEST_LATENCY_P95_MS', 200),
    /** When false the probe measures and prints but does not fail the build. */
    enforce: bool('CONTRACT_TEST_LATENCY_ENFORCE', true),
  },

  /** Per request timeout in milliseconds. */
  timeoutMs: num('CONTRACT_TEST_TIMEOUT_MS', 10000),

  /**
   * Identifiers used by operations that address a single resource. The suite discovers
   * these from the target at run time and only falls back to these values.
   */
  fallbackIds: {
    recipeId: str('CONTRACT_TEST_RECIPE_ID', 'rcp_01J9Z91B2C3D4E5F6G7H8J9K0M'),
    growerId: str('CONTRACT_TEST_GROWER_ID', 'grw_01J9Z900A1B2C3D4E5F6G7H8J9'),
    mediaId: str('CONTRACT_TEST_MEDIA_ID', 'med_01J9Z8XK4M2Q7T5V3N8R1B6C0D'),
  },

  /**
   * Assert that JSON responses declare charset=utf-8, per section 8.1 of the contract.
   * Separable because it is a prose requirement rather than an OpenAPI one.
   */
  requireCharset: bool('CONTRACT_TEST_REQUIRE_CHARSET', true),
} as const;

export function describeConfig(): string {
  return [
    `base URL          ${config.baseUrl}`,
    `specification     ${config.specPath}`,
    `writes allowed    ${config.allowWrites}`,
    `page origin       ${config.pageOrigin}`,
    `admin token       ${config.tokens.admin ? 'set' : 'not set'}`,
    `editor token      ${config.tokens.editor ? 'set' : 'not set'}`,
    `viewer token      ${config.tokens.viewer ? 'set' : 'not set'}`,
  ].join('\n');
}
