/**
 * Configuration. Everything is read once, at module load, so a misconfiguration is a
 * startup failure rather than a 500 discovered by a customer.
 *
 * Secrets are NOT read here. See secrets.ts: they come from a managed store and never
 * from the repository, per the Architecture document, "Security and privacy".
 */

function str(name: string, fallback: string): string {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}

function int(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

function bool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  return v === 'true' || v === '1';
}

function list(name: string, fallback: string[]): string[] {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  return v.split(',').map((s) => s.trim()).filter(Boolean);
}

export type Stage = 'local' | 'staging' | 'production';

export const STAGES: readonly Stage[] = ['local', 'staging', 'production'];

/**
 * STAGE is the only thing standing between this process and its development affordances.
 * `allowDevSymmetricTokens` and the environment variable secret provider are both gated on
 * it, and both gates are written as a comparison against the exact string 'production'.
 *
 * So an unrecognised value is not a harmless typo. `STAGE=prod` is not 'production', which
 * means every one of those comparisons decides the permissive way, and STAGE unset falls
 * back to 'local', which is the most permissive value there is. Reading it as an unchecked
 * string turned "refused in code" into "refused as long as one environment variable is
 * spelled correctly".
 *
 * A misconfiguration is a startup failure here rather than a 500 discovered by a customer,
 * which is this file's own rule, so an unrecognised stage refuses to start.
 */
function stageFrom(value: string | undefined): Stage {
  const stage = value === undefined || value === '' ? 'local' : value;
  if (!(STAGES as readonly string[]).includes(stage)) {
    throw new Error(
      `STAGE='${stage}' is not a recognised stage. Set it to one of ${STAGES.join(', ')}. ` +
        'Every development affordance in this API is gated on this value, so an unrecognised one is refused rather than treated as non production.',
    );
  }
  return stage as Stage;
}

export interface Config {
  stage: Stage;
  port: number;
  host: string;
  region: string;
  /** Set for DynamoDB Local or the in process test server. Never set against AWS. */
  dynamoEndpoint: string | undefined;
  tables: {
    spiceBlends: string;
    scanEvents: string;
    recipes: string;
    growers: string;
    nfcTags: string;
  };
  indexes: {
    blendsByStatus: string;
    blendsBySlug: string;
    blendsByEntity: string;
    recipeById: string;
    growersByEntityName: string;
  };
  media: {
    bucket: string;
    cdnBaseUrl: string;
    presignExpirySeconds: number;
    maxBytes: number;
    /** Endpoint override for a local S3 compatible server. Unset against AWS. */
    s3Endpoint: string | undefined;
    forcePathStyle: boolean;
  };
  auth: {
    issuer: string;
    audience: string;
    jwksUri: string | undefined;
    /**
     * Local and test only. A symmetric key so the suite can mint tokens without an
     * identity provider. Refused outright when stage is production.
     */
    devSharedSecretName: string;
    allowDevSymmetricTokens: boolean;
  };
  scan: {
    rawRetentionDays: number;
    /** Origins the beacon is expected to come from. A mismatch is recorded, not trusted. */
    allowedOrigins: string[];
    /**
     * A CloudFront origin custom header, which the CDN adds to an origin request and a
     * viewer cannot set. It is the only available signal that a request genuinely arrived
     * through the CDN, which is the precondition for believing its viewer geo headers at
     * all. Unset means geography is read on local and dropped elsewhere: see services/geo.
     */
    geoTrustedHeader: { name: string; value: string } | undefined;
  };
  catalog: {
    staleAfterSeconds: number;
  };
  revalidation: {
    /** Where publish and revalidate post their queued paths. Unset means log only. */
    webhookUrl: string | undefined;
    secretName: string;
  };
  shopify: {
    webhookSecretName: string;
    /**
     * The storefront hostname cart permalinks are built against. Empty means
     * unconfigured, which renders the reorder button disabled rather than
     * pointing it somewhere plausible.
     *
     * **THE CORRECT VALUE IS `dmt009-91.myshopify.com`, VERIFIED WORKING ON
     * WEDNESDAY 7 OCTOBER 2026** against the live store, all four tagged blends
     * adding the right variant at the right price and reaching a real checkout.
     *
     * **The myshopify host is used deliberately in preference to the storefront
     * domain.** It is permanent and cannot be re pointed, whereas the store's
     * primary domain is **`shop.treveanliving.com`** today and the client has
     * said he intends to move it. Shopify 301s the myshopify host to whatever
     * the primary domain is and carries the cart with it, so one extra hop on a
     * reorder click buys immunity from a domain that is still moving. **The tap
     * path is unaffected: this is only followed when a customer presses reorder.**
     *
     * **An earlier version of this comment said the only correct value was
     * `shop.treveanspice.com`. That host does not exist.** The store is still
     * branded Trevean Living, which is why `BlendPage.tsx` no longer names a
     * brand beside the button. See "Decision log", D64.
     */
    storeDomain: string;
  };
  /**
   * Rate limits are enforced at the CDN and WAF per the API contract, section 9, so a
   * flood never reaches a function. This in process limiter is defence in depth for
   * environments with no WAF in front, and is off by default.
   */
  rateLimit: {
    enabled: boolean;
  };
  log: {
    level: 'debug' | 'info' | 'warn' | 'error';
  };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const stage = stageFrom(env.STAGE);
  return {
    stage,
    port: int('PORT', 3001),
    host: str('HOST', '0.0.0.0'),
    region: str('AWS_REGION', 'us-east-1'),
    dynamoEndpoint: env.DYNAMODB_ENDPOINT || undefined,
    tables: {
      spiceBlends: str('TABLE_SPICE_BLENDS', 'SpiceBlends'),
      scanEvents: str('TABLE_SCAN_EVENTS', 'ScanEvents'),
      recipes: str('TABLE_RECIPES', 'Recipes'),
      growers: str('TABLE_GROWERS', 'Growers'),
      nfcTags: str('TABLE_NFC_TAGS', 'NFCTags'),
    },
    indexes: {
      blendsByStatus: str('INDEX_BLENDS_BY_STATUS', 'status-updatedAt-index'),
      blendsBySlug: str('INDEX_BLENDS_BY_SLUG', 'slug-index'),
      blendsByEntity: str('INDEX_BLENDS_BY_ENTITY', 'entity-createdAt-index'),
      recipeById: str('INDEX_RECIPE_BY_ID', 'recipeId-index'),
      growersByEntityName: str('INDEX_GROWERS_BY_ENTITY_NAME', 'entity-name-index'),
    },
    media: {
      bucket: str('MEDIA_BUCKET', 'trevean-media-local'),
      cdnBaseUrl: str('MEDIA_CDN_BASE_URL', 'https://cdn.treveanspice.com'),
      presignExpirySeconds: int('MEDIA_PRESIGN_EXPIRY_SECONDS', 900),
      maxBytes: int('MEDIA_MAX_BYTES', 26214400),
      s3Endpoint: env.S3_ENDPOINT || undefined,
      forcePathStyle: bool('S3_FORCE_PATH_STYLE', Boolean(env.S3_ENDPOINT)),
    },
    auth: {
      issuer: str('AUTH_ISSUER', 'https://auth.local.treveanspice.com'),
      audience: str('AUTH_AUDIENCE', 'trevean-admin'),
      jwksUri: env.AUTH_JWKS_URI || undefined,
      devSharedSecretName: str('AUTH_DEV_SECRET_NAME', 'trevean/api/dev-jwt-secret'),
      allowDevSymmetricTokens: stage !== 'production' && bool('AUTH_ALLOW_DEV_TOKENS', stage === 'local'),
    },
    scan: {
      rawRetentionDays: int('SCAN_RAW_RETENTION_DAYS', 400),
      allowedOrigins: list('SCAN_ALLOWED_ORIGINS', [
        'https://treveanspice.com',
        'https://www.treveanspice.com',
      ]),
      geoTrustedHeader:
        env.GEO_TRUSTED_HEADER_NAME && env.GEO_TRUSTED_HEADER_VALUE
          ? { name: env.GEO_TRUSTED_HEADER_NAME, value: env.GEO_TRUSTED_HEADER_VALUE }
          : undefined,
    },
    catalog: {
      staleAfterSeconds: int('CATALOG_STALE_AFTER_SECONDS', 6 * 60 * 60),
    },
    revalidation: {
      webhookUrl: env.REVALIDATION_WEBHOOK_URL || undefined,
      secretName: str('REVALIDATION_SECRET_NAME', 'trevean/api/revalidation-secret'),
    },
    shopify: {
      webhookSecretName: str('SHOPIFY_WEBHOOK_SECRET_NAME', 'trevean/api/shopify-webhook-secret'),
      storeDomain: str('SHOPIFY_STORE_DOMAIN', ''),
    },
    rateLimit: {
      enabled: bool('RATE_LIMIT_ENABLED', false),
    },
    log: {
      level: str('LOG_LEVEL', 'info') as Config['log']['level'],
    },
  };
}

export const config: Config = loadConfig();
