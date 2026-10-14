/*
 * Configuration, and the line between a configuration value and a secret.
 *
 * NOTHING IN THIS FILE HOLDS A SECRET VALUE, and nothing in this package ever will.
 * Configuration carries the NAMES of secrets in the managed store. The values are fetched
 * at the moment of use through a CredentialProvider the caller supplies. That is the
 * Architecture document, "Security and privacy": secrets in a managed store, never in the
 * repo.
 *
 * The concrete AWS Secrets Manager provider is not implemented here, deliberately. It
 * already exists in the API package, which owns the AWS SDK dependency, and duplicating it
 * would put a second copy of credential handling in the tree and a second AWS SDK in this
 * package's dependency manifest for no gain. This package declares the interface and takes
 * one by injection.
 *
 * THREE THINGS THIS PACKAGE NEEDS AND DOES NOT HAVE, all of them client dependencies:
 *
 *   the Shopify Plus admin domain            trevean-spice.myshopify.com or similar
 *   the Admin API access token               an app installed on the store, scoped read_products
 *   the webhook shared secret                created with the webhook subscription
 *
 * Until they land, every value below is either a placeholder, an environment variable that
 * is not set, or a name pointing at a secret that does not exist yet. The package is built
 * so that supplying them is configuration rather than a code change.
 */

import type { CredentialProvider } from './admin/transport.js';
import type { CatalogSyncOptions } from './admin/catalogSync.js';
import type { MapOptions } from './mirror/map.js';
import type { VerifyOptions } from './webhooks/verify.js';
import { normaliseStorefrontBase } from './permalink.js';

export type Stage = 'local' | 'test' | 'staging' | 'production';

export interface ShopifyConfig {
  stage: Stage;
  /** The myshopify admin domain. Admin API only. */
  adminDomain: string | null;
  /** The public storefront origin used in cart permalinks, for example https://shop.treveanspice.com */
  storefrontBase: string | null;
  /** Hostnames a cart permalink is permitted to point at. */
  allowedStorefrontHosts: string[];
  /** Shop domains the webhook endpoints accept, checked after a valid signature. */
  allowedShopDomains: string[];
  adminApiVersion: string;
  storefrontApiVersion: string;
  secretNames: {
    adminAccessToken: string;
    storefrontAccessToken: string;
    webhookSharedSecret: string;
  };
  /** How old a successful sync may be before the entry is served as stale. */
  stalenessMs: number;
  lowStockThreshold: number | null;
  defaultCurrency: string;
}

export const DEFAULT_CONFIG: Omit<ShopifyConfig, 'stage'> = {
  adminDomain: null,
  storefrontBase: null,
  allowedStorefrontHosts: [],
  allowedShopDomains: [],
  // Pinned, never "unstable". An unpinned version changes the payload shape without a
  // deploy, which is a production incident that arrives on Shopify's schedule.
  adminApiVersion: '2025-01',
  storefrontApiVersion: '2025-01',
  secretNames: {
    adminAccessToken: 'trevean/shopify/admin-access-token',
    storefrontAccessToken: 'trevean/shopify/storefront-access-token',
    webhookSharedSecret: 'trevean/shopify/webhook-shared-secret',
  },
  stalenessMs: 3 * 60 * 60 * 1000,
  lowStockThreshold: null,
  defaultCurrency: 'USD',
};

function stageOf(value: string | undefined): Stage {
  return value === 'production' || value === 'staging' || value === 'test' ? value : 'local';
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ShopifyConfig {
  const stage = stageOf(env['STAGE']);
  const hosts = (env['SHOPIFY_ALLOWED_STOREFRONT_HOSTS'] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const shops = (env['SHOPIFY_ALLOWED_SHOP_DOMAINS'] ?? '').split(',').map((s) => s.trim()).filter(Boolean);

  return {
    ...DEFAULT_CONFIG,
    stage,
    adminDomain: env['SHOPIFY_ADMIN_DOMAIN'] || null,
    storefrontBase: env['SHOPIFY_STOREFRONT_BASE'] || null,
    allowedStorefrontHosts: hosts,
    allowedShopDomains: shops,
    adminApiVersion: env['SHOPIFY_ADMIN_API_VERSION'] || DEFAULT_CONFIG.adminApiVersion,
    storefrontApiVersion: env['SHOPIFY_STOREFRONT_API_VERSION'] || DEFAULT_CONFIG.storefrontApiVersion,
    secretNames: {
      adminAccessToken: env['SHOPIFY_ADMIN_TOKEN_SECRET_NAME'] || DEFAULT_CONFIG.secretNames.adminAccessToken,
      storefrontAccessToken:
        env['SHOPIFY_STOREFRONT_TOKEN_SECRET_NAME'] || DEFAULT_CONFIG.secretNames.storefrontAccessToken,
      webhookSharedSecret: env['SHOPIFY_WEBHOOK_SECRET_NAME'] || DEFAULT_CONFIG.secretNames.webhookSharedSecret,
    },
    stalenessMs: Number.parseInt(env['SHOPIFY_STALENESS_MS'] ?? '', 10) || DEFAULT_CONFIG.stalenessMs,
    lowStockThreshold: Number.parseInt(env['SHOPIFY_LOW_STOCK_THRESHOLD'] ?? '', 10) || null,
    defaultCurrency: env['SHOPIFY_DEFAULT_CURRENCY'] || DEFAULT_CONFIG.defaultCurrency,
  };
}

/*
 * BINDING THE ALLOWLISTS TO THE THINGS THEY GUARD.
 *
 * allowedStorefrontHosts and allowedShopDomains used to be read from the environment,
 * reported on by validateConfig, and then consumed by nothing. grep for either name
 * returned only the lines in this file that defined and checked it. An operator could set
 * SHOPIFY_ALLOWED_STOREFRONT_HOSTS, run a deployment check, be told there were no
 * problems, and ship a permalink builder with no allowlist in it at all.
 *
 * A green check on an inert guard is worse than no guard, because it is the shape of check
 * that stops people looking. So: applied, not deleted. Deleting them was the other
 * defensible option and it is the wrong one, because the constraint is real. The storefront
 * base is one environment variable away from pointing every reorder button on every jar at
 * another domain, and the page still looks correct; the shop domain allowlist is the only
 * thing that stops a second Shopify store's correctly signed webhooks being accepted as
 * ours if the secret is ever shared or leaked.
 *
 * This package is a library with no composition root, so it cannot force a consumer to
 * thread anything. What it can do, and now does, is make the wiring a one line call
 * instead of an act of memory, and make validateConfig check the allowlist against the
 * value it is supposed to be constraining rather than merely check that it is non empty.
 * Every test in test/config-wiring.test.ts asserts that a configured allowlist changes an
 * outcome, so deleting the binding fails the suite rather than passing it quietly.
 */

/**
 * CatalogSyncOptions with the storefront base and the host allowlist already bound.
 *
 * Use this rather than passing storefrontBase by hand. The two fields travel together:
 * a base with no allowlist beside it is the exact configuration validateConfig exists to
 * refuse, and it is trivially produced by supplying one and forgetting the other.
 */
export function catalogSyncOptionsFromConfig(
  config: ShopifyConfig,
  options: Omit<CatalogSyncOptions, 'storefrontBase' | 'allowedHosts'>,
): CatalogSyncOptions {
  return {
    ...options,
    storefrontBase: config.storefrontBase,
    allowedHosts: config.allowedStorefrontHosts,
    ...(options.lowStockThreshold === undefined ? { lowStockThreshold: config.lowStockThreshold } : {}),
    ...(options.defaultCurrency === undefined ? { defaultCurrency: config.defaultCurrency } : {}),
  };
}

/** MapOptions with the same two fields bound, for a single product mapped outside a sync. */
export function mapOptionsFromConfig(
  config: ShopifyConfig,
  options: Omit<MapOptions, 'storefrontBase' | 'allowedHosts'>,
): MapOptions {
  return {
    ...options,
    storefrontBase: config.storefrontBase,
    allowedHosts: config.allowedStorefrontHosts,
    ...(options.lowStockThreshold === undefined ? { lowStockThreshold: config.lowStockThreshold } : {}),
    ...(options.defaultCurrency === undefined ? { defaultCurrency: config.defaultCurrency } : {}),
  };
}

/**
 * VerifyOptions with the shop domain allowlist bound.
 *
 * The secret is a parameter rather than a config field because config carries the NAME of
 * the secret and never its value. The caller fetches it through the CredentialProvider at
 * the moment of use and hands it in here.
 */
export function verifyOptionsFromConfig(
  config: ShopifyConfig,
  secret: string,
  extra: Pick<VerifyOptions, 'allowedTopics' | 'hasSeenWebhookId'> = {},
): VerifyOptions {
  return {
    secret,
    allowedShopDomains: config.allowedShopDomains,
    ...(extra.allowedTopics ? { allowedTopics: extra.allowedTopics } : {}),
    ...(extra.hasSeenWebhookId ? { hasSeenWebhookId: extra.hasSeenWebhookId } : {}),
  };
}

/**
 * Configuration problems that would make this package behave badly in production, listed
 * all at once rather than one exception at a time.
 *
 * Returned rather than thrown, so a deployment check can print the whole list and a caller
 * that only builds permalinks is not stopped by a missing admin domain it does not use.
 */
export function validateConfig(config: ShopifyConfig): string[] {
  const problems: string[] = [];

  if (config.stage === 'production') {
    if (!config.storefrontBase) problems.push('No storefront base is configured, so no reorder button will have a destination.');
    if (config.allowedStorefrontHosts.length === 0) {
      problems.push(
        'No storefront host allowlist. Without one, a wrong environment variable points every reorder button at another domain and the page still looks correct.',
      );
    }
    if (config.allowedShopDomains.length === 0) {
      problems.push('No shop domain allowlist on the webhook endpoints.');
    }
    if (!config.adminDomain) problems.push('No Shopify admin domain, so the catalog mirror cannot be synced.');
  }
  if (!/^\d{4}-\d{2}$/.test(config.adminApiVersion)) problems.push('Admin API version must be pinned as YYYY-MM.');
  if (!/^\d{4}-\d{2}$/.test(config.storefrontApiVersion)) problems.push('Storefront API version must be pinned as YYYY-MM.');

  // The allowlist checked against the value it constrains, at any stage, rather than only
  // counted. Two non empty settings that disagree is the failure this pair exists to
  // catch: one wrong environment variable, a base that looks plausible, an allowlist that
  // does not contain it, and a deployment check that previously said nothing because both
  // fields were present. It is run through the same normaliser the permalink builder uses,
  // so the answer here and the answer at build time cannot differ.
  if (config.storefrontBase && config.allowedStorefrontHosts.length > 0) {
    try {
      normaliseStorefrontBase(config.storefrontBase, config.allowedStorefrontHosts);
    } catch (error) {
      problems.push(
        `The configured storefront base ${config.storefrontBase} is refused by the storefront host allowlist: ${(error as Error).message}`,
      );
    }
  }

  return problems;
}

/**
 * A provider backed by environment variables, for local development only.
 *
 * Refused outright when the stage is production, in code rather than by configuration
 * convention, matching the posture the API package takes on its development token. A
 * convention is a thing somebody breaks at 22:00; a throw is not.
 */
export class EnvCredentialProvider implements CredentialProvider {
  constructor(
    private readonly stage: Stage,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}

  async get(name: string): Promise<string> {
    if (this.stage === 'production') {
      throw new Error(
        'Refusing to read a Shopify credential from the environment in production. Credentials come from the managed secret store.',
      );
    }
    const key = `SHOPIFY_SECRET_${name.replace(/[^A-Za-z0-9]+/g, '_').toUpperCase()}`;
    const value = this.env[key];
    if (!value) throw new Error(`No local value for secret ${name}. Expected environment variable ${key}.`);
    return value;
  }
}

/** For tests. Holds values in memory and is never constructed by shipping code. */
export class StaticCredentialProvider implements CredentialProvider {
  constructor(private readonly values: Record<string, string>) {}
  async get(name: string): Promise<string> {
    const value = this.values[name];
    if (!value) throw new Error(`No value for secret ${name}.`);
    return value;
  }
}
