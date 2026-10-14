import { BatchGetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { config } from '../config/env.js';
import { db } from '../db/client.js';
import { redirectTable } from '../services/redirectTable.js';

/**
 * NFCTags is a MIRROR, not a source of truth.
 *
 * It is seeded at deploy time from the version controlled redirect table, and it exists so
 * an operator or the admin CMS can read what is actually live without cloning the
 * repository. The /t/{code} redirect itself is served at the CDN edge and does not read
 * this table, because a database read inside the redirect would put a round trip inside
 * the 2.0 second budget for no benefit.
 *
 * There is no write operation exposed through the API for any role, including Admin.
 *
 * The read is a BatchGetItem over the codes in the deployed redirect table, not a Scan.
 * The table has no secondary index and five rows, and a Scan habit is how a Scan ends up
 * on a path that matters.
 */

export interface TagRecordItem {
  code: string;
  blendSlug: string;
  requestPath: string;
  targetPath: string;
  redirectStatus: number;
  unitsEncoded: number;
  status: 'encoded' | 'reserved';
  encodedOn: string | null;
  supplierOrderRef: string | null;
  chipPartNumber: string | null;
  writeProtected: boolean | null;
  ndefUri: string | null;
  lastVerifiedAgainstPhysicalTag: string | null;
  sourceCommit: string | null;
  deployedAt: string | null;
}

const TABLE = () => config.tables.nfcTags;

export async function listTagRecords(): Promise<TagRecordItem[]> {
  const codes = redirectTable().entries.map((e) => e.code);
  if (codes.length === 0) return [];
  const out = await db().send(
    new BatchGetCommand({ RequestItems: { [TABLE()]: { Keys: codes.map((code) => ({ code })) } } }),
  );
  const items = ((out.Responses?.[TABLE()] ?? []) as TagRecordItem[]).slice();
  items.sort((a, b) => codes.indexOf(a.code) - codes.indexOf(b.code));
  return items;
}

export async function putTagRecord(item: TagRecordItem): Promise<void> {
  await db().send(new PutCommand({ TableName: TABLE(), Item: item }));
}
