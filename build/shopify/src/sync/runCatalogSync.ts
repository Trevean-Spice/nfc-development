/*
 * One catalog sync run: read the rows, walk the Admin API, plan, write or log.
 *
 * The order is the safety property:
 *
 *   1. Read every CATALOG# row first. A read failure stops the run before Shopify is
 *      called and before anything is written.
 *   2. Walk the Admin API through syncCatalog. Any error it cannot retry through, including
 *      an exhausted throttle budget, throws here, so a failed walk writes nothing rather
 *      than an empty or partial mirror over a good one.
 *   3. Plan every row, then write each plan as its own conditional UpdateItem. One row
 *      failing its condition does not stop the others; it is reported as a failure.
 *
 * Idempotent: the same store state produces the same mirror values every run. Only
 * syncedAt and syncSource advance, and they must, because syncedAt is what the API's
 * staleness rule reads.
 */

import { syncCatalog, type CatalogSyncOptions, type CatalogSyncReport } from '../admin/catalogSync.js';
import type { AdminTransport } from '../admin/transport.js';
import {
  isConditionalCheckFailure,
  planCatalogWrite,
  productMapFromRows,
  readCatalogRows,
  variantPinsFromRows,
  type CatalogTable,
  type SkipReason,
} from './catalogWriter.js';

export interface RunCatalogSyncOptions {
  transport: AdminTransport;
  table: CatalogTable;
  tableName: string;
  knownSlugs: readonly string[];
  dryRun: boolean;
  /** Explicit product (GID or handle) to slug entries. Wins over the map read from the rows. */
  productToSlug?: Record<string, string>;
  productQuery?: string | null;
  defaultCurrency?: string;
  lowStockThreshold?: number | null;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  log?: (entry: Record<string, unknown>) => void;
  /** Passed through to syncCatalog. Tests use it to bound retries. */
  maxRetries?: number;
}

export type RowOutcome =
  | { slug: string; action: 'updated' | 'would_update'; changes: Record<string, { from: unknown; to: unknown }> }
  | { slug: string; action: 'skipped'; reason: SkipReason; detail: string }
  | { slug: string; action: 'failed'; reason: 'condition_failed' | 'write_error'; detail: string };

export interface RunCatalogSyncSummary {
  dryRun: boolean;
  syncSource: string;
  syncedAt: string;
  outcomes: RowOutcome[];
  missingSlugs: string[];
  unmatched: CatalogSyncReport['unmatched'];
  warnings: string[];
  report: CatalogSyncReport;
  failures: number;
}

export async function runCatalogSync(options: RunCatalogSyncOptions): Promise<RunCatalogSyncSummary> {
  const now = options.now ?? (() => new Date());
  const log = options.log ?? (() => {});
  const syncedAt = now().toISOString();
  const syncSource = `shopify-sync-${syncedAt}`;

  const rows = await readCatalogRows(options.table, options.tableName, options.knownSlugs);

  const syncOptions: CatalogSyncOptions = {
    transport: options.transport,
    knownSlugs: options.knownSlugs,
    productToSlug: { ...productMapFromRows(rows), ...(options.productToSlug ?? {}) },
    preferredVariantIdBySlug: variantPinsFromRows(rows),
    // Deliberately no storefront base. cartPermalinkUrl is not written by the sync; the
    // API derives it from SHOPIFY_STORE_DOMAIN. See catalogWriter.ts.
    storefrontBase: null,
    productQuery: options.productQuery ?? null,
    ...(options.defaultCurrency ? { defaultCurrency: options.defaultCurrency } : {}),
    ...(options.lowStockThreshold !== undefined ? { lowStockThreshold: options.lowStockThreshold } : {}),
    ...(options.maxRetries !== undefined ? { maxRetries: options.maxRetries } : {}),
    now,
    ...(options.sleep ? { sleep: options.sleep } : {}),
  };

  const result = await syncCatalog(syncOptions);

  const outcomes: RowOutcome[] = [];
  for (const record of result.records) {
    const plan = planCatalogWrite(record, rows.get(record.slug), {
      tableName: options.tableName,
      syncedAt,
      syncSource,
    });

    if (plan.action === 'skip') {
      outcomes.push({ slug: plan.slug, action: 'skipped', reason: plan.reason, detail: plan.detail });
      log({ level: 'warn', message: 'catalog row skipped', slug: plan.slug, reason: plan.reason, detail: plan.detail });
      continue;
    }

    if (options.dryRun) {
      outcomes.push({ slug: plan.slug, action: 'would_update', changes: plan.changes });
      log({
        level: 'info',
        message: 'DRY RUN: catalog row would be updated',
        slug: plan.slug,
        changes: plan.changes,
        updateExpression: plan.input.UpdateExpression,
        conditionExpression: plan.input.ConditionExpression,
      });
      continue;
    }

    try {
      await options.table.updateItem(plan.input);
      outcomes.push({ slug: plan.slug, action: 'updated', changes: plan.changes });
      log({ level: 'info', message: 'catalog row updated', slug: plan.slug, changes: plan.changes });
    } catch (error) {
      const conditional = isConditionalCheckFailure(error);
      const detail = conditional
        ? `The row for ${plan.slug} changed between read and write, or is no longer a CATALOG row. Not written.`
        : `Write failed: ${(error as Error)?.message ?? String(error)}`;
      outcomes.push({ slug: plan.slug, action: 'failed', reason: conditional ? 'condition_failed' : 'write_error', detail });
      log({ level: 'error', message: 'catalog row not written', slug: plan.slug, detail });
    }
  }

  return {
    dryRun: options.dryRun,
    syncSource,
    syncedAt,
    outcomes,
    missingSlugs: result.missingSlugs,
    unmatched: result.report.unmatched,
    warnings: result.report.warnings,
    report: result.report,
    failures: outcomes.filter((o) => o.action === 'failed').length,
  };
}
