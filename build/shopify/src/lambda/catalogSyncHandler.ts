/*
 * The catalog_sync Lambda. Replaces the 848 byte infrastructure placeholder.
 *
 * Packaged by scripts/package-catalog-sync.mjs into an archive whose root index.mjs
 * re-exports `handler`, because the compute module sets handler = "index.handler" on the
 * function and that value is not in its ignore_changes list.
 *
 * Invoked by an EventBridge schedule (when one is enabled) or by hand. The event is
 * otherwise ignored, with one exception: { "dryRun": true } forces a dry run.
 *
 * DRY RUN IS THE DEFAULT. Writes happen only when CATALOG_SYNC_DRY_RUN is exactly "false".
 * That makes every deploy order safe: new code landing before the configuration that
 * enables it reads, plans and logs, and writes nothing. An event cannot turn writes on.
 *
 * Environment, every value a name or a setting and never a secret:
 *
 *   TABLE_SPICE_BLENDS               required; set by the compute module on every function
 *   SHOPIFY_ADMIN_DOMAIN             the myshopify host; falls back to SHOPIFY_STORE_DOMAIN,
 *                                    which since D64 is that same permanent myshopify host
 *   SHOPIFY_ADMIN_TOKEN_SECRET_NAME  defaults to trevean/{TREVEAN_ENV}/shopify-admin-api-token,
 *                                    the name the secrets module creates
 *   SHOPIFY_ADMIN_API_VERSION        defaults to the pinned version in config.ts
 *   CATALOG_SYNC_DRY_RUN             "false" to write; anything else, or unset, is a dry run
 *   CATALOG_SYNC_KNOWN_SLUGS         optional comma list, intersected with the contract enum
 *   CATALOG_SYNC_PRODUCT_MAP         optional JSON {"<product gid or handle>": "<slug>"}
 *   CATALOG_SYNC_PRODUCT_QUERY       optional Shopify search query narrowing the product set
 *
 * A run with any failed row write, or any error before the writes, ends by throwing, so
 * the function's Errors metric and the async retry behaviour see it.
 */

import { HttpAdminTransport, type AdminTransport, type CredentialProvider } from '../admin/transport.js';
import { DEFAULT_CONFIG, loadConfig } from '../config.js';
import { CONTRACT_SLUGS, type CatalogTable } from '../sync/catalogWriter.js';
import { runCatalogSync, type RunCatalogSyncSummary } from '../sync/runCatalogSync.js';
import { SecretsManagerCredentialProvider, awsCatalogTable } from './aws.js';

export interface CatalogSyncSettings {
  tableName: string;
  adminDomain: string;
  apiVersion: string;
  tokenSecretName: string;
  dryRun: boolean;
  knownSlugs: string[];
  productToSlug: Record<string, string>;
  productQuery: string | null;
  defaultCurrency: string;
  lowStockThreshold: number | null;
}

const MYSHOPIFY = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i;

function eventForcesDryRun(event: unknown): boolean {
  return typeof event === 'object' && event !== null && (event as { dryRun?: unknown }).dryRun === true;
}

/** Settings from the environment, with every problem reported at once before anything runs. */
export function catalogSyncSettingsFromEnv(env: NodeJS.ProcessEnv, event?: unknown): CatalogSyncSettings {
  const problems: string[] = [];
  const config = loadConfig(env);

  const tableName = env['TABLE_SPICE_BLENDS'] ?? '';
  if (!tableName) problems.push('TABLE_SPICE_BLENDS is not set.');

  const adminDomain = (env['SHOPIFY_ADMIN_DOMAIN'] || env['SHOPIFY_STORE_DOMAIN'] || '').trim();
  if (!adminDomain) problems.push('Neither SHOPIFY_ADMIN_DOMAIN nor SHOPIFY_STORE_DOMAIN is set.');
  else if (!MYSHOPIFY.test(adminDomain)) problems.push(`${adminDomain} is not a myshopify admin domain.`);

  const tokenSecretName =
    env['SHOPIFY_ADMIN_TOKEN_SECRET_NAME'] ||
    (env['TREVEAN_ENV'] ? `trevean/${env['TREVEAN_ENV']}/shopify-admin-api-token` : DEFAULT_CONFIG.secretNames.adminAccessToken);

  const requested = (env['CATALOG_SYNC_KNOWN_SLUGS'] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const knownSlugs = requested.length > 0
    ? requested.filter((s) => (CONTRACT_SLUGS as readonly string[]).includes(s))
    : [...CONTRACT_SLUGS];
  const refused = requested.filter((s) => !(CONTRACT_SLUGS as readonly string[]).includes(s));
  if (refused.length > 0) problems.push(`CATALOG_SYNC_KNOWN_SLUGS names slugs outside the contract: ${refused.join(', ')}.`);

  let productToSlug: Record<string, string> = {};
  const rawMap = env['CATALOG_SYNC_PRODUCT_MAP'];
  if (rawMap) {
    try {
      const parsed = JSON.parse(rawMap) as unknown;
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('not an object');
      productToSlug = Object.fromEntries(
        Object.entries(parsed as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === 'string'),
      );
    } catch {
      problems.push('CATALOG_SYNC_PRODUCT_MAP is not a JSON object of strings.');
    }
  }

  if (problems.length > 0) throw new Error(`catalog_sync configuration: ${problems.join(' ')}`);

  return {
    tableName,
    adminDomain,
    apiVersion: config.adminApiVersion,
    tokenSecretName,
    dryRun: env['CATALOG_SYNC_DRY_RUN'] !== 'false' || eventForcesDryRun(event),
    knownSlugs,
    productToSlug,
    productQuery: env['CATALOG_SYNC_PRODUCT_QUERY'] || null,
    defaultCurrency: config.defaultCurrency,
    lowStockThreshold: config.lowStockThreshold,
  };
}

export interface CatalogSyncHandlerDeps {
  env?: NodeJS.ProcessEnv;
  /** Injected in tests. In the Lambda, HttpAdminTransport over Secrets Manager. */
  transport?: (settings: CatalogSyncSettings) => AdminTransport;
  table?: () => Promise<CatalogTable>;
  credentials?: () => CredentialProvider;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  log?: (entry: Record<string, unknown>) => void;
  maxRetries?: number;
}

function jsonLog(entry: Record<string, unknown>): void {
  const line = JSON.stringify({ component: 'catalog_sync', ...entry });
  if (entry['level'] === 'error') console.error(line);
  else console.log(line);
}

export function createCatalogSyncHandler(deps: CatalogSyncHandlerDeps = {}) {
  return async function handler(event?: unknown): Promise<RunCatalogSyncSummary> {
    const log = deps.log ?? jsonLog;
    const settings = catalogSyncSettingsFromEnv(deps.env ?? process.env, event);

    const transport = deps.transport
      ? deps.transport(settings)
      : new HttpAdminTransport({
          shopDomain: settings.adminDomain,
          apiVersion: settings.apiVersion,
          accessTokenSecretName: settings.tokenSecretName,
          credentials: deps.credentials ? deps.credentials() : new SecretsManagerCredentialProvider(),
        });
    const table = deps.table ? await deps.table() : await awsCatalogTable();

    log({
      level: 'info',
      message: settings.dryRun ? 'catalog sync starting, DRY RUN, nothing will be written' : 'catalog sync starting',
      adminDomain: settings.adminDomain,
      apiVersion: settings.apiVersion,
      knownSlugs: settings.knownSlugs,
    });

    let summary: RunCatalogSyncSummary;
    try {
      summary = await runCatalogSync({
        transport,
        table,
        tableName: settings.tableName,
        knownSlugs: settings.knownSlugs,
        dryRun: settings.dryRun,
        productToSlug: settings.productToSlug,
        productQuery: settings.productQuery,
        defaultCurrency: settings.defaultCurrency,
        lowStockThreshold: settings.lowStockThreshold,
        log,
        ...(deps.now ? { now: deps.now } : {}),
        ...(deps.sleep ? { sleep: deps.sleep } : {}),
        ...(deps.maxRetries !== undefined ? { maxRetries: deps.maxRetries } : {}),
      });
    } catch (error) {
      log({ level: 'error', message: 'catalog sync failed before any write', error: (error as Error)?.message ?? String(error) });
      throw error;
    }

    log({
      level: summary.failures > 0 ? 'error' : 'info',
      message: 'catalog sync finished',
      dryRun: summary.dryRun,
      syncSource: summary.syncSource,
      outcomes: summary.outcomes.map((o) => ({ slug: o.slug, action: o.action, ...('reason' in o ? { reason: o.reason } : {}) })),
      missingSlugs: summary.missingSlugs,
      unmatched: summary.unmatched,
      warnings: summary.warnings,
      retries: summary.report.retries,
      throttleWaitsMs: summary.report.throttleWaitsMs,
    });

    if (summary.failures > 0) {
      throw new Error(`catalog sync: ${summary.failures} row write(s) failed. See the log line above for which.`);
    }
    return summary;
  };
}

export const handler = createCatalogSyncHandler();
