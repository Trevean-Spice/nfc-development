import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { existsSync } from 'node:fs';

/**
 * Configuration, read once at module load so a misconfiguration is a startup failure
 * rather than a 500 an editor discovers halfway through writing a story.
 *
 * The same posture as the API: secrets come from the environment only for local
 * development, and the development signing path is refused outright when the stage is
 * production. See "Frozen API contract", section 5.3.
 */

const here = dirname(fileURLToPath(import.meta.url));

/*
 * The package root, found by looking for package.json rather than by counting directories.
 *
 * This was `resolve(here, '..')`, which is correct when this module is at src/config.ts and
 * wrong when it is at dist/src/config.js, because the compiled tree is one level deeper. So
 * the defaults for CONTRACT_PATH and CONTENT_DIR pointed at build/admin/api/openapi and
 * build/admin/content, neither of which exists, and `node dist/src/index.js` died at startup
 * with ENOENT while `tsx src/index.ts` worked perfectly.
 *
 * Nothing caught it because the tests run from source and set both paths explicitly. It was
 * found on Tuesday 8 September 2026 by running the compiled output for the first time, which
 * is the thing a Lambda does and a developer never does. Counting directories encodes an
 * assumption about the build layout in a file that has no business knowing it.
 */
function findPackageRoot(from: string): string {
  let dir = from;
  for (let depth = 0; depth < 6; depth += 1) {
    if (existsSync(join(dir, 'package.json'))) return dir;
    const parent = resolve(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }
  // Preserves the historic behaviour rather than throwing, because a wrong path produces a
  // clear ENOENT naming the file, and throwing here would produce a worse message earlier.
  return resolve(from, '..');
}

export const packageRoot = findPackageRoot(here);

export type Stage = 'local' | 'staging' | 'production';

export const STAGES: readonly Stage[] = ['local', 'staging', 'production'];

/**
 * Every development affordance in this application is gated on STAGE, and every one of
 * those gates is a comparison against the exact string 'production': the local development
 * identity provider with its published passwords, the symmetric token signing key, and the
 * `secure` flag on the session cookie.
 *
 * `STAGE=prod` is not 'production'. Neither is 'Production', and neither is STAGE unset,
 * which falls back to the most permissive value there is. Read as an unchecked string, one
 * misspelling leaves the seeded accounts live and the session signed with the default key
 * that is printed in this file, which anybody who can read the repository already has.
 *
 * So an unrecognised stage refuses to start. Configuration is read once and a
 * misconfiguration is a startup failure, which is this file's own rule.
 */
function stageFrom(value: string | undefined): Stage {
  const stage = value === undefined || value === '' ? 'local' : value;
  if (!(STAGES as readonly string[]).includes(stage)) {
    throw new Error(
      `STAGE='${stage}' is not a recognised stage. Set it to one of ${STAGES.join(', ')}. ` +
        'The development identity provider and the development signing key are refused on the exact string production, so an unrecognised stage is refused rather than treated as non production.',
    );
  }
  return stage as Stage;
}

/*
 * These take the environment rather than reaching for process.env, and the difference is not
 * cosmetic. loadConfig has always accepted an `env` argument, and these three helpers ignored
 * it and read the real process environment instead. So the parameter advertised an injectable
 * configuration that did not exist: a caller passing a hand built environment got the stage
 * from their argument and every other value from whatever the process happened to have.
 *
 * Found on Tuesday 8 September 2026 by a test that passed `{ ADMIN_DEV_IDENTITY: '1' }` and
 * watched it have no effect. A test asserting a dangerous default is off is worth very little
 * if the function it calls cannot be told anything, so this was worth fixing before relying
 * on the test above it.
 */
function str(env: NodeJS.ProcessEnv, name: string, fallback: string): string {
  const v = env[name];
  return v === undefined || v === '' ? fallback : v;
}

function int(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const v = env[name];
  if (v === undefined || v === '') return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

function bool(env: NodeJS.ProcessEnv, name: string, fallback: boolean): boolean {
  const v = env[name];
  if (v === undefined || v === '') return fallback;
  return v === 'true' || v === '1';
}

export interface AdminConfig {
  stage: Stage;
  /**
   * The seeded local identity provider and self minted API tokens are permitted.
   * Requires ADMIN_DEV_IDENTITY to be set explicitly, and is false in every deployed
   * environment because no deployment sets it. See loadConfig for why this is not a stage.
   */
  devIdentity: boolean;
  /** Mount prefix when served under a path, for example /admin. Empty when at root. */
  basePath: string;
  port: number;
  host: string;
  /** The tap-to-story API. Every content read and write goes through it. */
  apiBaseUrl: string;
  /**
   * The frozen OpenAPI document. The minimum role for every admin operation is read from
   * it at startup rather than retyped here, so the two cannot drift.
   */
  contractPath: string;
  /**
   * The content package. Read only. It carries the placeholder convention, the content
   * field specification and the per field readiness states.
   */
  contentDir: string;
  session: {
    cookieName: string;
    secret: string;
    /** Session lifetime in seconds. Deliberately short: this tool can publish. */
    ttlSeconds: number;
  };
  api: {
    issuer: string;
    audience: string;
    /**
     * Local and staging only. There is no identity provider on a laptop, so the admin
     * mints the API bearer token itself with the same symmetric development key the API
     * accepts. Refused when the stage is production, in code, not by convention.
     */
    devSigningKey: string;
    allowDevSigning: boolean;
    tokenTtlSeconds: number;
    timeoutMs: number;
  };
  users: {
    /** The local development identity provider's user file. */
    file: string;
  };
  /**
   * The managed identity provider. Empty on a laptop, where the seeded store is used
   * instead. Populated by Terraform in every deployed environment.
   */
  cognito: {
    region: string;
    userPoolId: string;
    clientId: string;
  };
  audit: {
    file: string;
  };
  publish: {
    /**
     * Publish returns 202 and does not wait for regeneration, so the admin confirms the
     * new version is being served by re-reading the public route. These two numbers are
     * how long it is willing to wait before saying "not confirmed yet" rather than
     * silently claiming success.
     */
    verifyAttempts: number;
    verifyIntervalMs: number;
    /** The typed phrase that authorises publishing placeholder content. */
    overridePhrase: string;
    /** SOW section 6.2. Stated on screen so the number is never folklore. */
    liveWithinMinutes: number;
    /**
     * The publish pipeline's own base URL, if there is one.
     *
     * The admin's contract legal confirmation re-reads the public content route, which
     * proves the origin is serving the new version and does not prove the CDN regenerated
     * the HTML. The publisher does prove that, because it reads the published document back
     * through the edge and compares its digest, and it can be asked. Unset means the admin
     * reports exactly what it did before and claims nothing more.
     *
     * It is not the API and it is not described by the frozen contract. See the contract
     * errata, E9 gap 4: the additive fix is GET /v1/admin/revalidations/{revalidationId} and
     * it needs Dan's decision, so nothing here invents a /v1 operation in the meantime.
     */
    publisherBaseUrl: string | null;
    /** How long the publish screen waits on the publisher before saying "still running". */
    publisherAttempts: number;
    publisherIntervalMs: number;
  };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AdminConfig {
  const stage = stageFrom(env.STAGE);
  const nonProduction = stage !== 'production';

  /*
   * The development identity provider is OFF unless something explicitly turns it on, and
   * "not production" is no longer enough to turn it on.
   *
   * This used to key off the stage alone, and that was wrong in a way that only showed up
   * when the admin was about to be deployed. The seeded user store in src/auth/users.ts
   * carries three accounts whose passwords are written in the source file, and it refused to
   * load only when the stage was 'production'. Every deployed environment this project has
   * runs STAGE=staging. So the first public deployment of the admin would have put a surface
   * that edits and publishes content for 1,000 encoded jars on the internet behind the
   * password 'admin-local-only', which is in the repository.
   *
   * Keying off an explicit opt in instead means the dangerous path needs somebody to ask for
   * it by name on a laptop, and no deployment can reach it by being misnamed. A stage is a
   * label; this is a decision.
   */
  const devIdentity = bool(env, 'ADMIN_DEV_IDENTITY', false) && nonProduction;

  return {
    devIdentity,
    stage,
    basePath: str(env, 'ADMIN_BASE_PATH', '').replace(/\/+$/, ''),
    port: int(env, 'PORT', 3002),
    host: str(env, 'HOST', '127.0.0.1'),
    apiBaseUrl: str(env, 'API_BASE_URL', 'http://localhost:3001').replace(/\/+$/, ''),
    contractPath: str(env, 'CONTRACT_PATH', resolve(packageRoot, '..', 'api', 'openapi', 'openapi.yaml')),
    contentDir: str(env, 'CONTENT_DIR', resolve(packageRoot, '..', 'content')),
    session: {
      cookieName: str(env, 'SESSION_COOKIE_NAME', 'trevean_admin_session'),
      secret: str(env, 'SESSION_SECRET', 'local-development-session-key-not-for-any-real-environment'),
      ttlSeconds: int(env, 'SESSION_TTL_SECONDS', 8 * 60 * 60),
    },
    api: {
      issuer: str(env, 'AUTH_ISSUER', 'https://auth.local.treveanspice.com'),
      audience: str(env, 'AUTH_AUDIENCE', 'trevean-admin'),
      devSigningKey: str(
        env,
        'API_DEV_JWT_SECRET',
        'local-development-signing-key-not-for-any-real-environment',
      ),
      // Was `nonProduction && bool(env, 'AUTH_ALLOW_DEV_TOKENS', nonProduction)`, which defaulted
      // to ON in staging. It now requires the same explicit opt in as the seeded user store,
      // because a deployed admin that can mint its own API bearer tokens is the same problem
      // wearing a different hat.
      allowDevSigning: devIdentity && bool(env, 'AUTH_ALLOW_DEV_TOKENS', true),
      tokenTtlSeconds: int(env, 'API_TOKEN_TTL_SECONDS', 600),
      timeoutMs: int(env, 'API_TIMEOUT_MS', 10000),
    },
    users: {
      file: str(env, 'USERS_FILE', resolve(packageRoot, 'data', 'users.json')),
    },
    cognito: {
      region: str(env, 'COGNITO_REGION', str(env, 'AWS_REGION', 'us-east-1')),
      userPoolId: str(env, 'COGNITO_USER_POOL_ID', ''),
      clientId: str(env, 'COGNITO_CLIENT_ID', ''),
    },
    audit: {
      file: str(env, 'AUDIT_FILE', resolve(packageRoot, 'data', 'audit.log')),
    },
    publish: {
      verifyAttempts: int(env, 'PUBLISH_VERIFY_ATTEMPTS', 6),
      verifyIntervalMs: int(env, 'PUBLISH_VERIFY_INTERVAL_MS', 700),
      overridePhrase: 'PUBLISH PLACEHOLDER CONTENT',
      liveWithinMinutes: 5,
      publisherBaseUrl: (env.PUBLISHER_BASE_URL ?? '').replace(/\/+$/, '') || null,
      publisherAttempts: int(env, 'PUBLISH_PUBLISHER_ATTEMPTS', 8),
      publisherIntervalMs: int(env, 'PUBLISH_PUBLISHER_INTERVAL_MS', 1000),
    },
  };
}

/**
 * Resolved on first property access rather than on import, and then never again.
 *
 * The intent is unchanged: configuration is read once, and a misconfiguration is a startup
 * failure rather than a 500 an editor discovers halfway through writing a story. What moves
 * is the moment of "once", from module import to first use, and the reason is worth stating
 * because it looks like an over complication otherwise.
 *
 * Importing a module must not be the thing that freezes configuration. The test harness has
 * to start a stand in API on an ephemeral port and then point this application at it, and
 * with eager resolution the mere act of importing a helper that touches any file under `src/`
 * would freeze the base URL first. That bug is not confined to tests: it is the same shape as
 * a deployment where an entry point imports a module before the environment is fully applied,
 * and it fails silently, by pointing at the default.
 */
let resolved: AdminConfig | undefined;

export const config: AdminConfig = new Proxy({} as AdminConfig, {
  get(_target, property) {
    if (!resolved) resolved = loadConfig();
    return (resolved as unknown as Record<string | symbol, unknown>)[property];
  },
  has(_target, property) {
    if (!resolved) resolved = loadConfig();
    return property in (resolved as unknown as Record<string | symbol, unknown>);
  },
  ownKeys() {
    if (!resolved) resolved = loadConfig();
    return Reflect.ownKeys(resolved as unknown as object);
  },
  getOwnPropertyDescriptor(_target, property) {
    if (!resolved) resolved = loadConfig();
    return Reflect.getOwnPropertyDescriptor(resolved as unknown as object, property);
  },
});

