/**
 * The dashboard package has no dependencies of its own. See MANIFEST.md.
 *
 * Running the whole thing locally needs a DynamoDB compatible server and a DynamoDB client,
 * and both already exist in the API package next door. They are borrowed from there rather
 * than installed a second time, so there is exactly one copy of the AWS SDK in the tree and
 * exactly one thing to list at handoff.
 */

import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export const API_DIR = resolve(here, '../../../api');

export function apiDependenciesInstalled() {
  return existsSync(join(API_DIR, 'node_modules', 'dynalite')) && existsSync(join(API_DIR, 'node_modules', '@aws-sdk'));
}

export function requireApiDependenciesOrExplain() {
  if (apiDependenciesInstalled()) return;
  throw new Error(
    'The API package next door has no node_modules, so there is no local DynamoDB to run against. ' +
      `Run "npm install" in ${API_DIR} first. This package installs nothing of its own by design.`,
  );
}

const requireFromApi = createRequire(join(API_DIR, 'package.json'));

export function loadDynalite() {
  requireApiDependenciesOrExplain();
  const mod = requireFromApi('dynalite');
  return mod.default ?? mod;
}

export function loadDynamoClients() {
  requireApiDependenciesOrExplain();
  const client = requireFromApi('@aws-sdk/client-dynamodb');
  const lib = requireFromApi('@aws-sdk/lib-dynamodb');
  return { DynamoDBClient: client.DynamoDBClient, DynamoDBDocumentClient: lib.DynamoDBDocumentClient, PutCommand: lib.PutCommand, BatchWriteCommand: lib.BatchWriteCommand };
}

export const TSX_CLI = join(API_DIR, 'node_modules', 'tsx', 'dist', 'cli.mjs');
