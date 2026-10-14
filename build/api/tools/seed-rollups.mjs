#!/usr/bin/env node
/**
 * Generates synthetic scan rollups, so the analytics dashboard can be looked at with
 * something on it.
 *
 * WHY THIS EXISTS. The scan pipeline is proven: a beacon posted through the live
 * distribution reached the stream consumer, the counters were written, and the Scans
 * screen read one back. **That is two test taps.** A dashboard with two points on it
 * cannot show whether the date range picker works, whether switching granularity
 * changes anything, whether the per blend filter filters, or whether the platform
 * split adds up. This writes enough rows that all four are visible.
 *
 * WHAT IT IS NOT. It is not a load test and it does not exercise the stream consumer:
 * it writes the rollup rows directly, which is the same place the consumer writes to
 * and nothing further. The consumer is proven separately and by a real beacon. **Do
 * not read a chart produced by this tool as evidence that anything upstream of the
 * rollup table works.**
 *
 * SAFETY, AND IT IS THE POINT OF HALF THIS FILE.
 *
 *   1. Every row it writes carries `synthetic: true`. Real rows never do.
 *   2. `--purge` deletes exactly the rows carrying that flag and nothing else.
 *   3. It refuses a table name that does not contain "dev" or "staging" unless
 *      `--i-understand-this-is-production` is passed, because putting invented
 *      numbers in front of an investor as though they were sales is the single
 *      worst outcome available here.
 *
 * USAGE
 *   node tools/seed-rollups.mjs --table <name> [--days 30] [--region us-east-1]
 *   node tools/seed-rollups.mjs --table <name> --purge
 *   node tools/seed-rollups.mjs --table dev --dry-run   (no AWS, checks the invariants)
 */

import { parseArgs } from 'node:util';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  BatchWriteCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';

const BLENDS = ['persian-sunrise', 'caribbean-sunset', 'the-silk-road', 'north-african-night-market'];

// Deliberately uneven. Persian Sunrise and Caribbean Sunset are the two launch blends
// with printed labels, so they should dominate; a flat split would hide a per blend
// filter that silently ignores its argument.
const BLEND_WEIGHT = {
  'persian-sunrise': 0.42,
  'caribbean-sunset': 0.33,
  'the-silk-road': 0.15,
  'north-african-night-market': 0.1,
};

const KEY = { rollup: 'ROLLUP#' };
const allDayPk = () => `${KEY.rollup}ALL#DAY`;
const allHourPk = () => `${KEY.rollup}ALL#HOUR`;
const blendDayPk = (s) => `${KEY.rollup}BLEND#${s}#DAY`;
const blendHourPk = (s) => `${KEY.rollup}BLEND#${s}#HOUR`;

const { values } = parseArgs({
  options: {
    table: { type: 'string' },
    region: { type: 'string', default: 'us-east-1' },
    days: { type: 'string', default: '30' },
    purge: { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
    'i-understand-this-is-production': { type: 'boolean', default: false },
  },
});

if (!values.table) {
  console.error('--table is required. It is the ScanEvents table name.');
  process.exit(1);
}

const looksNonProduction = /dev|staging|test/i.test(values.table);
if (!looksNonProduction && !values['i-understand-this-is-production']) {
  console.error(
    `Refusing: "${values.table}" does not look like a development table.\n` +
      'This writes invented numbers. If they reach a real dashboard nobody can tell them\n' +
      'from sales. Pass --i-understand-this-is-production only if you are certain.',
  );
  process.exit(2);
}

const doc = DynamoDBDocumentClient.from(new DynamoDBClient({ region: values.region }));

/**
 * A deterministic generator, seeded from the bucket string.
 *
 * Math.random would give a different chart on every run, which makes "did my change to
 * the date range do that, or did the data move" unanswerable. Same inputs, same chart.
 */
function pseudoRandom(seed) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

/** Hour of day shape: nobody taps a spice jar at 4am. A flat line would hide a broken granularity toggle. */
function hourWeight(hour) {
  const shape = [1, 1, 1, 1, 1, 2, 4, 7, 9, 8, 7, 9, 12, 10, 8, 8, 10, 14, 16, 13, 9, 6, 4, 2];
  return shape[hour] / 100;
}

function counters(scans, seed) {
  if (scans <= 0) return null;
  const r = pseudoRandom(seed);

  // iOS majority, matching the device matrix and the fact that the iPhone is the handset
  // with the banner problem. The remainder is Android; "other" stays rare and non zero so
  // a three way chart is actually three way.
  const ios = Math.round(scans * (0.55 + r * 0.1));
  const other = Math.round(scans * 0.02);
  const android = Math.max(0, scans - ios - other);

  // NFC dominates but QR is material, which is the comparison the measurement note exists
  // to support.
  const nfc = Math.round(scans * (0.72 + r * 0.1));
  const qr = Math.max(0, scans - nfc);

  const hit = Math.round(scans * 0.88);

  return {
    scans,
    ch_nfc: nfc,
    ch_qr: qr,
    ch_direct: 0,
    pf_ios: ios,
    pf_android: android,
    pf_other: other,
    reorderClicks: Math.round(scans * (0.05 + r * 0.05)),
    recipeOpens: Math.round(scans * (0.25 + r * 0.2)),
    cache_hit: hit,
    cache_miss: scans - hit,
    cache_stale: 0,
    ttr_count: scans,
    ttr_sum_ms: Math.round(scans * (820 + r * 300)),
    // Weighted well under the 2000 ms criterion, because that is what the bench data
    // actually measured. A histogram invented above the line would be a lie shaped like
    // a failure.
    ttr_b_0_500: Math.round(scans * 0.18),
    ttr_b_500_1000: Math.round(scans * 0.51),
    ttr_b_1000_1500: Math.round(scans * 0.21),
    ttr_b_1500_2000: Math.round(scans * 0.07),
    ttr_b_2000_3000: Math.round(scans * 0.02),
    ttr_b_3000_plus: Math.round(scans * 0.01),
  };
}

function* dayKeys(days) {
  const end = new Date('2026-09-18T00:00:00Z');
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(end);
    d.setUTCDate(d.getUTCDate() - i);
    yield d.toISOString().slice(0, 10);
  }
}

function buildItems(days) {
  const items = [];
  const push = (pk, sk, c) => c && items.push({ pk, sk, ...c, synthetic: true, entityType: 'ROLLUP' });

  for (const day of dayKeys(days)) {
    const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
    const weekend = weekday === 0 || weekday === 6;
    const base = Math.round((weekend ? 55 : 130) * (0.75 + pseudoRandom(day) * 0.5));

    push(allDayPk(), day, counters(base, `all-${day}`));

    for (const blend of BLENDS) {
      const scans = Math.round(base * BLEND_WEIGHT[blend]);
      push(blendDayPk(blend), day, counters(scans, `${blend}-${day}`));
    }

    for (let hour = 0; hour < 24; hour += 1) {
      const sk = `${day}T${String(hour).padStart(2, '0')}`;
      const hourly = Math.round(base * hourWeight(hour) * 24);
      push(allHourPk(), sk, counters(hourly, `all-${sk}`));
      for (const blend of BLENDS) {
        push(blendHourPk(blend), sk, counters(Math.round(hourly * BLEND_WEIGHT[blend]), `${blend}-${sk}`));
      }
    }
  }
  return items;
}

async function writeAll(items) {
  let written = 0;
  for (let i = 0; i < items.length; i += 25) {
    const chunk = items.slice(i, i + 25);
    let request = { [values.table]: chunk.map((Item) => ({ PutRequest: { Item } })) };

    // BatchWrite returns unprocessed items rather than failing, and ignoring that is how
    // a seed reports success having written most of it. Retry until the map is empty.
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const res = await doc.send(new BatchWriteCommand({ RequestItems: request }));
      const unprocessed = res.UnprocessedItems?.[values.table] ?? [];
      written += request[values.table].length - unprocessed.length;
      if (unprocessed.length === 0) break;
      request = { [values.table]: unprocessed };
      await new Promise((r) => setTimeout(r, 2 ** attempt * 50));
    }
    process.stdout.write(`\r  ${written} / ${items.length} rows`);
  }
  process.stdout.write('\n');
  return written;
}

async function purge() {
  const partitions = [allDayPk(), allHourPk(), ...BLENDS.flatMap((b) => [blendDayPk(b), blendHourPk(b)])];
  let deleted = 0;

  for (const pk of partitions) {
    let startKey;
    do {
      const res = await doc.send(
        new QueryCommand({
          TableName: values.table,
          KeyConditionExpression: 'pk = :pk',
          // Only rows this tool wrote. A real row has no synthetic attribute, so it is
          // not matched and cannot be deleted by accident.
          FilterExpression: 'synthetic = :t',
          ExpressionAttributeValues: { ':pk': pk, ':t': true },
          ExclusiveStartKey: startKey,
        }),
      );
      const rows = res.Items ?? [];
      for (let i = 0; i < rows.length; i += 25) {
        const chunk = rows.slice(i, i + 25);
        await doc.send(
          new BatchWriteCommand({
            RequestItems: {
              [values.table]: chunk.map((r) => ({ DeleteRequest: { Key: { pk: r.pk, sk: r.sk } } })),
            },
          }),
        );
        deleted += chunk.length;
      }
      startKey = res.LastEvaluatedKey;
    } while (startKey);
  }
  return deleted;
}

const days = Number(values.days);
if (!Number.isInteger(days) || days < 1 || days > 365) {
  console.error('--days must be a whole number between 1 and 365.');
  process.exit(1);
}

if (values['dry-run']) {
  // Checks the generated rows against the same invariants the dashboard tests assert,
  // without AWS and without credentials. If the splits do not total, the chart would be
  // wrong in a way that looks like a rendering bug rather than a generator bug.
  const items = buildItems(days);
  let worstPlatformDrift = 0;
  let worstChannelDrift = 0;
  for (const it of items) {
    worstPlatformDrift = Math.max(worstPlatformDrift, Math.abs(it.pf_ios + it.pf_android + it.pf_other - it.scans));
    worstChannelDrift = Math.max(worstChannelDrift, Math.abs(it.ch_nfc + it.ch_qr + it.ch_direct - it.scans));
  }
  const partitions = new Set(items.map((i) => i.pk));
  console.log(`${items.length} rows across ${partitions.size} partitions, ${days} days.`);
  console.log(`Total scans (all blends, daily): ${items.filter((i) => i.pk === allDayPk()).reduce((s, i) => s + i.scans, 0)}`);
  console.log(`Worst platform split drift: ${worstPlatformDrift} (must be 0)`);
  console.log(`Worst channel split drift:  ${worstChannelDrift} (must be 0)`);
  process.exit(worstPlatformDrift === 0 && worstChannelDrift === 0 ? 0 : 1);
}

if (values.purge) {
  console.log(`Purging synthetic rollups from ${values.table} ...`);
  const deleted = await purge();
  console.log(`Deleted ${deleted} synthetic row(s). Real rows were not matched and are untouched.`);
} else {
  const items = buildItems(days);
  console.log(`Writing ${items.length} synthetic rollup rows to ${values.table} (${days} days) ...`);
  const written = await writeAll(items);
  console.log(`Wrote ${written} row(s).`);
  console.log('Every row carries synthetic: true. Remove them with --purge before anybody sees this dashboard for real.');
}
