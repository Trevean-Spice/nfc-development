import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EnvCredentialProvider, loadConfig, validateConfig, DEFAULT_CONFIG } from '../src/config.js';

/*
 * "No secrets in the repository. Credentials come from a managed store at runtime."
 *
 * Enforced here rather than remembered, because the way a token gets committed is never a
 * decision. It is a hurried afternoon, a .env file that was going to be deleted, or a
 * fixture pasted from a real response. This test walks the package and fails the build if
 * anything matching a Shopify credential appears.
 */

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'coverage']);

/*
 * Shopify credential prefixes. shpat_ is an admin API access token, shpss_ a shared
 * secret, shpca_ a custom app token, shppa_ a private app token, shpsa_ a storefront app
 * token. Each is followed by a long hex or alphanumeric body, and the length is what
 * distinguishes a real token from the word used as a label in a comment.
 */
const TOKEN_PATTERNS: Array<[string, RegExp]> = [
  ['Shopify admin API access token', /shpat_[0-9a-fA-F]{20,}/],
  ['Shopify shared secret', /shpss_[0-9a-zA-Z]{20,}/],
  ['Shopify custom app token', /shpca_[0-9a-zA-Z]{20,}/],
  ['Shopify private app password', /shppa_[0-9a-zA-Z]{20,}/],
  ['Shopify storefront app token', /shpsa_[0-9a-zA-Z]{20,}/],
  ['A 32 character storefront access token assignment', /storefront[_-]?access[_-]?token["'\s:=]+[0-9a-f]{32}/i],
  ['An AWS access key id', /AKIA[0-9A-Z]{16}/],
  ['A private key block', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

describe('no secrets in the repository', () => {
  const files = walk(ROOT).filter((f) => /\.(ts|js|mjs|json|md|yaml|yml|txt)$/.test(f));

  it('walks a non trivial number of files, so the assertions below are not vacuous', () => {
    expect(files.length).toBeGreaterThan(15);
  });

  it.each(TOKEN_PATTERNS)('contains no %s', (_label, pattern) => {
    const hits = files.filter((file) => pattern.test(readFileSync(file, 'utf8')));
    expect(hits.map((f) => f.slice(ROOT.length))).toEqual([]);
  });

  it('contains no .env file of any kind', () => {
    const envFiles = walk(ROOT).filter((f) => /(^|[\\/])\.env(\..+)?$/.test(f));
    expect(envFiles).toEqual([]);
  });

  it('the configuration carries secret NAMES and never secret VALUES', () => {
    const config = loadConfig({});
    expect(config.secretNames.adminAccessToken).toBe('trevean/shopify/admin-access-token');
    expect(config.secretNames.webhookSharedSecret).toBe('trevean/shopify/webhook-shared-secret');
    // Nothing on the config object looks like a credential.
    expect(JSON.stringify(config)).not.toMatch(/shpat_|shpss_|shpca_/);
  });
});

describe('the background IP manifest', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const manifest = readFileSync(join(ROOT, 'MANIFEST.md'), 'utf8');

  it('has no runtime dependencies at all', () => {
    // The two security critical parts of this component, HMAC verification and URL
    // construction, run on node:crypto and the WHATWG URL globals. Neither is delegated to
    // a package. A supply chain compromise in this tree can affect a test run; it cannot
    // affect a signature check on a production webhook endpoint.
    expect(pkg.dependencies ?? {}).toEqual({});
  });

  it('lists every declared dependency, so the Scope document IP obligation cannot silently fall behind', () => {
    for (const name of Object.keys(pkg.devDependencies ?? {})) {
      expect(manifest).toContain(`\`${name}\``);
    }
  });
});

describe('the credential provider', () => {
  it('refuses to read a credential from the environment in production, in code rather than by convention', async () => {
    const provider = new EnvCredentialProvider('production', { SHOPIFY_SECRET_TREVEAN_SHOPIFY_ADMIN_ACCESS_TOKEN: 'x' });
    await expect(provider.get('trevean/shopify/admin-access-token')).rejects.toThrow(/Refusing/);
  });

  it('reads a local development value outside production', async () => {
    const provider = new EnvCredentialProvider('local', { SHOPIFY_SECRET_TREVEAN_SHOPIFY_ADMIN_ACCESS_TOKEN: 'local-value' });
    await expect(provider.get('trevean/shopify/admin-access-token')).resolves.toBe('local-value');
  });

  it('fails loudly when a local value is absent rather than proceeding with an empty secret', async () => {
    const provider = new EnvCredentialProvider('local', {});
    await expect(provider.get('trevean/shopify/admin-access-token')).rejects.toThrow(/No local value/);
  });
});

describe('configuration validation', () => {
  it('is quiet outside production, where nothing is configured yet and that is expected', () => {
    expect(validateConfig(loadConfig({ STAGE: 'local' }))).toEqual([]);
  });

  it('names every production problem at once rather than one exception at a time', () => {
    const problems = validateConfig(loadConfig({ STAGE: 'production' }));
    expect(problems).toHaveLength(4);
    expect(problems.join(' ')).toMatch(/storefront host allowlist/);
    expect(problems.join(' ')).toMatch(/shop domain allowlist/);
  });

  it('passes a fully configured production stage', () => {
    const problems = validateConfig(
      loadConfig({
        STAGE: 'production',
        SHOPIFY_STOREFRONT_BASE: 'https://shop.treveanspice.com',
        SHOPIFY_ALLOWED_STOREFRONT_HOSTS: 'shop.treveanspice.com',
        SHOPIFY_ALLOWED_SHOP_DOMAINS: 'trevean-spice.myshopify.com',
        SHOPIFY_ADMIN_DOMAIN: 'trevean-spice.myshopify.com',
      }),
    );
    expect(problems).toEqual([]);
  });

  it('pins the API versions rather than tracking latest', () => {
    expect(DEFAULT_CONFIG.adminApiVersion).toMatch(/^\d{4}-\d{2}$/);
    expect(validateConfig(loadConfig({ SHOPIFY_ADMIN_API_VERSION: 'unstable' }))).toContain(
      'Admin API version must be pinned as YYYY-MM.',
    );
  });
});
