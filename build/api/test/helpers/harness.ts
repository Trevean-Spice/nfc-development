import { DeleteCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { SignJWT } from 'jose';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { config } from '../../src/config/env.js';
import { db } from '../../src/db/client.js';
import { ensureTables } from '../../src/db/schema.js';
import { seed } from '../../src/db/seed.js';
import { frozenAt, resetClock, setClock } from '../../src/util/clock.js';
import type { Role } from '../../src/auth/roles.js';

/**
 * Test harness.
 *
 * The Scan in truncate() is the only Scan anywhere in this project and it is test code.
 * Application code never scans a table: a Scan in this codebase is a defect regardless of
 * current table size.
 */

/**
 * The instant this suite runs at, always, on every machine and on every date.
 *
 * The scan write derives its partition key, its 30 minute deduplication window and its
 * TTL from server time, and the dashboard reads those keys back. With the real clock, a
 * test that posts a beacon dated 17 August and then queries 17 August is only correct for
 * as long as the real clock stays within the 24 hour skew allowance of that date. It
 * passed on the 18th and failed on the 19th.
 *
 * So the clock is an input here rather than a fact about the machine. The fixture dates
 * stay where they are and the clock is pinned next to them. Bumping the dates to today
 * instead would only have moved the failure to tomorrow.
 *
 * This is one hour and 41 minutes after the seed timestamp below, which keeps the seeded
 * catalog mirror inside its 6 hour freshness window, exactly as it is on a live service a
 * few minutes after a Shopify sync.
 */
export const TEST_NOW = '2026-08-17T09:41:07Z';

/** Pins server time for the calling test file. Pair with unfreezeClock in afterAll. */
export function freezeClock(iso: string = TEST_NOW): void {
  setClock(frozenAt(iso));
}

export function unfreezeClock(): void {
  resetClock();
}

export async function makeApp(): Promise<FastifyInstance> {
  await ensureTables();
  return buildApp();
}

async function truncate(tableName: string, keyNames: string[]): Promise<void> {
  let startKey: Record<string, unknown> | undefined;
  do {
    const out = await db().send(new ScanCommand({ TableName: tableName, ExclusiveStartKey: startKey as never }));
    for (const item of out.Items ?? []) {
      const key: Record<string, unknown> = {};
      for (const name of keyNames) key[name] = item[name];
      await db().send(new DeleteCommand({ TableName: tableName, Key: key as never }));
    }
    startKey = out.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (startKey);
}

export async function resetTables(): Promise<void> {
  await ensureTables();
  await truncate(config.tables.spiceBlends, ['pk', 'sk']);
  await truncate(config.tables.recipes, ['blendSlug', 'sk']);
  await truncate(config.tables.growers, ['growerId']);
  await truncate(config.tables.nfcTags, ['code']);
  await truncate(config.tables.scanEvents, ['pk', 'sk']);
}

/** The instant the seed data is stamped with. Fixed, like TEST_NOW, and earlier than it. */
export const SEED_NOW = '2026-08-17T09:00:00Z';

export async function resetAndSeed(): Promise<void> {
  await resetTables();
  await seed({ sourceCommit: 'testcommit', now: SEED_NOW });
}

/**
 * Mints a token the way the managed identity provider would, using the development
 * symmetric key. Against AWS the same code path verifies an RS256 token from a JWKS
 * endpoint instead: see auth/jwt.ts.
 */
export async function token(
  roles: Role[],
  options: { subject?: string; email?: string; expiresIn?: string; issuer?: string; audience?: string } = {},
): Promise<string> {
  const secret = new TextEncoder().encode(process.env.SECRET_TREVEAN_API_DEV_JWT_SECRET as string);
  return new SignJWT({ roles, email: options.email ?? 'editor@treveanspice.com' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(options.subject ?? 'user_test')
    .setIssuer(options.issuer ?? config.auth.issuer)
    .setAudience(options.audience ?? config.auth.audience)
    .setIssuedAt()
    .setExpirationTime(options.expiresIn ?? '15m')
    .sign(secret);
}

export async function authHeader(roles: Role[]): Promise<Record<string, string>> {
  return { authorization: `Bearer ${await token(roles)}` };
}
