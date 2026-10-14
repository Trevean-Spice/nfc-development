#!/usr/bin/env node
/**
 * Seed the content fixtures into DynamoDB.
 *
 * Three properties this tool is built around:
 *
 * 1. It matches the key schema in the M1 data model deliverable exactly. Partition and
 *    sort key names, the BLEND# and CATALOG# namespaces, the zero padded recipe sort
 *    key, the GSI attributes. If the audit finds the real tables differ, this is the
 *    one file that changes.
 *
 * 2. It is idempotent. Every item is deterministic: no generated ids, no timestamps
 *    read from the clock, no random values. Running it ten times leaves the same rows,
 *    and it reports created, updated and unchanged separately so you can see that.
 *
 * 3. IT REFUSES TO PUT PLACEHOLDER CONTENT INTO PRODUCTION. Not a warning, a refusal,
 *    with the reason and the exact override printed. The failure it exists to prevent
 *    is a fabricated looking grower profile on a page that 250 jars in customers'
 *    kitchens already point at.
 *
 * Node standard library only. Works against DynamoDB Local with no AWS access.
 *
 * Usage:
 *   node tools/seed-dynamodb.mjs --env local --endpoint-url http://localhost:8000 --create-tables
 *   node tools/seed-dynamodb.mjs --env local --endpoint-url http://localhost:8000
 *   node tools/seed-dynamodb.mjs --env staging --region us-east-1
 *   node tools/seed-dynamodb.mjs --env local --dry-run
 *
 * Options:
 *   --env local|staging|production   required
 *   --endpoint-url URL               DynamoDB endpoint. Required for local.
 *   --region REGION                  default us-east-1
 *   --table-prefix PREFIX            default none, for example trevean-staging-
 *   --dry-run                        build every item, write them to a file, write nothing to a table
 *   --create-tables                  create the five tables if absent. Local endpoints only.
 *   --redirect-table PATH            source for the NFCTags mirror. Default: the edge deliverable's table.
 *   --no-media                       do not seed media library items
 *   --allow-placeholder-in-production  the override. Requires --reason.
 *   --reason "..."                   why the override is being used. Recorded in the run log.
 *   --yes                            do not ask for confirmation on a non local environment
 */

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import {
  ROOT, loadAllFixtures, loadMediaManifest, loadSpec, anyPlaceholder,
  placeholderFields, SENTINEL, carriesSentinel,
} from './lib/fixtures.mjs';
import { createClient, marshalItem, unmarshalItem, resolveCredentials, localCredentials } from './lib/ddb.mjs';

/* --------------------------------------------------------------- arguments */

const argv = process.argv.slice(2);
const opt = (name, fallback = null) => {
  const i = argv.indexOf(name);
  return i === -1 ? fallback : argv[i + 1];
};
const flag = (name) => argv.includes(name);

const ENV = opt('--env');
const ENDPOINT = opt('--endpoint-url');
const REGION = opt('--region', 'us-east-1');
const PREFIX = opt('--table-prefix', '');
const DRY_RUN = flag('--dry-run');
const CREATE_TABLES = flag('--create-tables');
const SEED_MEDIA = !flag('--no-media');
const OVERRIDE = flag('--allow-placeholder-in-production');
const REASON = opt('--reason', null);
const ASSUME_YES = flag('--yes');
// The canonical redirect table is the sibling edge package. The previous default
// pointed at deliverables/m1/build/edge/, where the package used to live, so the
// file was never found and NFCTags was silently skipped on every run. Silently
// skipping the mirror of the artifact that resolves 1,000 shipped tags is exactly
// the kind of quiet miss this project cannot afford, so the fallback below keeps
// the old location working rather than replacing one hard coded guess with another.
const REDIRECT_TABLE = opt(
  '--redirect-table',
  [
    path.resolve(ROOT, '..', 'edge', 'redirect-table.json'),
    path.resolve(ROOT, '..', '..', 'deliverables', 'm1', 'build', 'edge', 'redirect-table.json'),
  ].find((candidate) => fs.existsSync(candidate)) ?? path.resolve(ROOT, '..', 'edge', 'redirect-table.json'),
);

const VALID_ENVS = ['local', 'staging', 'production'];
if (!VALID_ENVS.includes(ENV)) {
  fail(`--env is required and must be one of ${VALID_ENVS.join(', ')}. Run with --help for the full list of options.`);
}

const TABLES = {
  blends: `${PREFIX}SpiceBlends`,
  recipes: `${PREFIX}Recipes`,
  growers: `${PREFIX}Growers`,
  tags: `${PREFIX}NFCTags`,
  scanEvents: `${PREFIX}ScanEvents`,
};

function fail(message, extra = []) {
  console.error('\nREFUSED: ' + message);
  for (const line of extra) console.error('  ' + line);
  console.error('');
  process.exit(1);
}

/* -------------------------------------------------------------- item build */

const spec = loadSpec();
const fixtures = loadAllFixtures();
const media = loadMediaManifest();

const pad4 = (n) => String(n).padStart(4, '0');

function readinessBlock(record) {
  const fields = placeholderFields(record);
  return {
    state: fields.length === 0 ? 'real' : 'placeholder',
    sentinel: SENTINEL,
    placeholderFieldCount: fields.length,
    placeholderFields: fields.map((f) => f.path),
    fieldStates: record._placeholder?.fields ?? {},
    reason: record._placeholder?.reason ?? null,
    contentDueFromClient: spec.contentDueFromClient,
    asOf: spec.asOf,
    conventionVersion: spec.conventionVersion,
  };
}

function buildItems() {
  const items = [];

  for (const rec of fixtures.blends) {
    const b = rec.blend;
    const readiness = readinessBlock(rec);
    const base = {
      entityType: 'BLEND',
      slug: b.slug,
      name: b.name,
      status: b.status,
      tagline: b.tagline,
      launchTier: b.launchTier,
      tagCode: b.tagCode,
      originCountry: b.originCountry,
      originRegion: b.originRegion,
      originCity: b.originCity,
      farm: b.farm,
      storyBlocks: b.storyBlocks,
      heroImageId: b.heroImageId,
      galleryImageIds: b.galleryImageIds,
      freshness: b.freshness,
      growerId: b.growerId,
      shopify: b.shopify,
      recipeCount: b.recipeCount,
      version: b.version,
      publishedAt: b.publishedAt,
      createdAt: b.createdAt,
      updatedAt: b.updatedAt,
      updatedBy: b.updatedBy,
      clientFacts: rec._clientFacts ?? null,
      placeholderContent: readiness.state === 'placeholder',
      contentReadiness: readiness,
    };

    items.push({
      table: TABLES.blends,
      key: { pk: `BLEND#${b.slug}`, sk: 'v0' },
      item: { pk: `BLEND#${b.slug}`, sk: 'v0', ...base },
      label: `blend ${b.slug}`,
    });

    // An immutable published snapshot, per the data model, section 3.1.
    //
    // THE SHAPE HERE MUST MATCH writeSnapshot IN build/api/src/repositories/blends.ts, and
    // it did not until Friday 11 September 2026. This wrote the snapshot with the live row's
    // `status` and `entityType: BLEND` still on it, which put it in the status-updatedAt
    // index alongside the live row, so the admin listed every published blend twice. The
    // API's own publish path has always been correct; only the seed was wrong, which is why
    // it appeared on a seeded environment and would never have appeared from an editor
    // pressing publish.
    //
    // Three things make a snapshot invisible to the list and all three matter:
    //   status is dropped, so the row is absent from the sparse status index
    //   snapshotStatus carries what it was, because the information is still wanted
    //   entityType says BLEND_SNAPSHOT, so nothing mistakes it for a live blend
    //
    // The key is padded to six digits by blendSnapshotSk, so PUB#000001 rather than PUB#1.
    // Unpadded keys sort wrongly the moment there are ten versions: PUB#10 sorts before
    // PUB#2.
    if (b.status === 'published') {
      const { status, ...withoutStatus } = base;
      const sk = `PUB#${String(b.version).padStart(6, '0')}`;
      items.push({
        table: TABLES.blends,
        key: { pk: `BLEND#${b.slug}`, sk },
        item: {
          pk: `BLEND#${b.slug}`,
          sk,
          ...withoutStatus,
          snapshotOf: b.version,
          snapshotStatus: status,
          entityType: 'BLEND_SNAPSHOT',
        },
        label: `blend ${b.slug} published snapshot v${b.version}`,
      });
    }
  }

  for (const rec of fixtures.catalog) {
    const c = rec.catalog;
    const readiness = readinessBlock(rec);
    // Attribute names follow the data model, section 3.1, catalog mirror item:
    // priceAmount, priceCurrency and compareAtAmount are flat, not a nested Money map.
    items.push({
      table: TABLES.blends,
      key: { pk: `CATALOG#${c.slug}`, sk: 'v0' },
      item: {
        pk: `CATALOG#${c.slug}`,
        sk: 'v0',
        entityType: 'CATALOG',
        slug: c.slug,
        sku: c.sku,
        shopifyProductId: c.shopifyProductId,
        shopifyVariantId: c.shopifyVariantId,
        priceAmount: c.price?.amount ?? null,
        priceCurrency: c.price?.currency ?? null,
        compareAtAmount: c.compareAtPrice?.amount ?? null,
        available: c.available,
        inventoryStatus: c.inventoryStatus,
        cartPermalinkUrl: c.cartPermalinkUrl,
        syncedAt: c.syncedAt,
        syncSource: c.syncSource,
        version: c.version,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
        placeholderContent: readiness.state === 'placeholder',
        contentReadiness: readiness,
      },
      label: `catalog mirror ${c.slug}`,
    });
  }

  for (const rec of fixtures.growers) {
    const g = rec.grower;
    const readiness = readinessBlock(rec);
    items.push({
      table: TABLES.growers,
      key: { growerId: g.growerId },
      item: {
        growerId: g.growerId,
        // entityType is the constant partition key of the admin list index. The data
        // model says exactly why a single partition index is the right call at this
        // size, and at what point it stops being.
        entityType: 'GROWER',
        name: g.name,
        farmName: g.farmName,
        country: g.country,
        region: g.region,
        bio: g.bio,
        yearsFarming: g.yearsFarming,
        portraitId: g.portraitId,
        farm: g.farm,
        blendSlugs: g.blendSlugs,
        version: g.version,
        createdAt: g.createdAt,
        updatedAt: g.updatedAt,
        placeholderContent: readiness.state === 'placeholder',
        contentReadiness: readiness,
      },
      label: `grower ${g.growerId} (${g.blendSlugs.join(', ')})`,
    });
  }

  for (const rec of fixtures.recipes) {
    for (const entry of rec.recipes) {
      const r = entry.recipe;
      const readiness = readinessBlock(entry);
      // Sort key: zero padded sortOrder so string order matches numeric order, then
      // the recipe id so carousel order is stable across builds.
      const sk = `${pad4(r.sortOrder)}#${r.recipeId}`;
      items.push({
        table: TABLES.recipes,
        key: { blendSlug: r.blendSlug, sk },
        item: {
          blendSlug: r.blendSlug,
          sk,
          recipeId: r.recipeId,
          title: r.title,
          summary: r.summary,
          servings: r.servings,
          prepMinutes: r.prepMinutes,
          cookMinutes: r.cookMinutes,
          difficulty: r.difficulty,
          ingredients: r.ingredients,
          steps: r.steps,
          imageId: r.imageId,
          sortOrder: r.sortOrder,
          status: r.status,
          version: r.version,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
          placeholderContent: readiness.state === 'placeholder',
          contentReadiness: readiness,
        },
        label: `recipe ${r.blendSlug} ${r.sortOrder}`,
      });
    }
  }

  if (SEED_MEDIA) {
    for (const asset of media.assets) {
      items.push({
        table: TABLES.blends,
        key: { pk: `MEDIA#${asset.mediaId}`, sk: 'v0' },
        item: {
          pk: `MEDIA#${asset.mediaId}`,
          sk: 'v0',
          entityType: 'MEDIA',
          mediaId: asset.mediaId,
          kind: asset.kind,
          blendSlug: asset.blendSlug,
          filename: asset.filename,
          contentType: asset.contentType,
          bytes: asset.bytes,
          width: asset.width,
          height: asset.height,
          sha256: asset.sha256,
          alt: asset.alt,
          status: asset.status,
          localPath: asset.localPath,
          budgetBytes: asset.budgetBytes,
          licence: asset.licence,
          version: 1,
          createdAt: '2026-08-17T09:00:00Z',
          updatedAt: '2026-08-17T09:00:00Z',
          placeholderContent: true,
          contentReadiness: {
            state: 'placeholder',
            sentinel: SENTINEL,
            reason: 'Generated placeholder asset, sized and weighted to the M1 performance budget. Not a photograph.',
            asOf: spec.asOf,
          },
        },
        label: `media ${asset.mediaId} (${asset.kind}, ${asset.blendSlug})`,
      });
    }
  }

  // NFCTags is a mirror of the version controlled redirect table, never a source of
  // truth. If the file is not where we expect, say so and seed nothing rather than
  // inventing rows: a wrong row here points 250 jars at the wrong page.
  if (fs.existsSync(REDIRECT_TABLE)) {
    const table = JSON.parse(fs.readFileSync(REDIRECT_TABLE, 'utf8'));
    for (const e of table.entries) {
      items.push({
        table: TABLES.tags,
        key: { code: e.code },
        item: {
          code: e.code,
          blendSlug: e.blendSlug,
          requestPath: e.requestPath,
          targetPath: e.targetPath,
          // The on-pack QR route, carried on the mirror so an operator can read both
          // routes without cloning the application repository. Same code, same row,
          // same destination page, differing only in the via value. See the document
          // titled "M1 Deliverable 14: QR attribution", section 2.
          qrRequestPath: e.qrRequestPath ?? null,
          qrTargetPath: e.qrTargetPath ?? null,
          qrUrl: e.qrUrl ?? null,
          redirectStatus: table.redirectStatus,
          unitsEncoded: e.unitsEncoded,
          status: e.status,
          encodedOn: e.encodedOn,
          supplierOrderRef: e.supplierOrderRef,
          chipPartNumber: e.chipPartNumber,
          writeProtected: e.writeProtected,
          ndefUri: e.ndefUri,
          lastVerifiedAgainstPhysicalTag: e.lastVerifiedAgainstPhysicalTag ?? null,
          sourceRedirectTableVersion: table.version,
          sourcePath: path.relative(path.resolve(ROOT, '..', '..'), REDIRECT_TABLE).replace(/\\/g, '/'),
        },
        label: `tag ${e.code} -> ${e.blendSlug}`,
      });
    }
  } else {
    console.warn(
      `\nNote: no redirect table at ${REDIRECT_TABLE}. NFCTags will not be seeded.\n` +
        '      NFCTags is a mirror of the version controlled redirect table and is never\n' +
        '      authored here. Pass --redirect-table PATH to point at it.\n',
    );
  }

  return items;
}

/* ------------------------------------------------------------------ guards */

function guard(items) {
  const hits = anyPlaceholder(fixtures);
  const placeholderItems = items.filter((i) => i.item.placeholderContent === true);
  const sentinelItems = items.filter((i) => carriesSentinel(i.item));
  const isPlaceholderData = hits.length > 0 || placeholderItems.length > 0 || sentinelItems.length > 0;

  // Environment and endpoint have to agree. A production run pointed at localhost is a
  // no-op that looks like a success, and a local run pointed at production is worse.
  const endpointIsLocal = ENDPOINT && /^https?:\/\/(localhost|127\.0\.0\.1|host\.docker\.internal|0\.0\.0\.0)(:|\/|$)/.test(ENDPOINT);
  if (ENV === 'local' && !endpointIsLocal) {
    fail('--env local requires a local --endpoint-url.', [
      'Start DynamoDB Local and pass --endpoint-url http://localhost:8000.',
      'We do not have AWS access, so local is the environment this data set is built for.',
    ]);
  }
  if (ENV !== 'local' && endpointIsLocal) {
    fail(`--env ${ENV} was given but --endpoint-url points at a local address.`, [
      'Refusing rather than writing to a local table and reporting success.',
    ]);
  }

  if (ENV === 'production' && isPlaceholderData && !OVERRIDE) {
    fail('this data set contains placeholder content and the target environment is production.', [
      '',
      'WHY THIS IS REFUSED',
      '  The blend pages are reachable from 1,000 encoded tags already in the field, 250',
      '  per code across ps, cs, sr and nm. Content that reaches production reaches a',
      '  customer holding a jar. A placeholder grower profile in production is not a',
      '  cosmetic problem: it is a statement about a real supply chain that nobody made.',
      '',
      'WHAT IS PLACEHOLDER',
      `  ${placeholderItems.length} of ${items.length} items carry placeholderContent: true.`,
      `  ${sentinelItems.length} items carry the ${SENTINEL} sentinel in a value that renders on the page.`,
      '  Run: node tools/content-readiness.mjs   for the field by field list.',
      '',
      'HOW TO PROCEED IF YOU REALLY MEAN IT',
      '  --allow-placeholder-in-production --reason "..." --yes',
      '  The reason is recorded in the run log. Use it for a rehearsal against an empty',
      '  production table before real content exists, and for nothing else.',
    ]);
  }

  if (ENV === 'production' && isPlaceholderData && OVERRIDE && !REASON) {
    fail('--allow-placeholder-in-production requires --reason "...".', [
      'The override is deliberately inconvenient. An override with no recorded reason is',
      'an override nobody can explain a week later.',
    ]);
  }

  if (ENV === 'staging' && isPlaceholderData) {
    console.warn(
      '\nWARNING: seeding placeholder content to staging. That is the intended use of this\n' +
        '         data set, and staging is where the M2 measurements are taken. Every page\n' +
        '         will render the placeholder banner. Nothing here may be promoted.\n',
    );
  }

  if (CREATE_TABLES && ENV !== 'local') {
    fail('--create-tables is refused outside a local environment.', [
      'Staging and production tables come from the infrastructure as code deliverable, not',
      'from a seeding script. A table created by hand is a table that cannot be recreated.',
    ]);
  }

  return { isPlaceholderData, placeholderCount: placeholderItems.length };
}

/* ------------------------------------------------------------ table schema */

const TABLE_DEFINITIONS = [
  {
    TableName: TABLES.blends,
    BillingMode: 'PAY_PER_REQUEST',
    AttributeDefinitions: [
      { AttributeName: 'pk', AttributeType: 'S' },
      { AttributeName: 'sk', AttributeType: 'S' },
      { AttributeName: 'status', AttributeType: 'S' },
      { AttributeName: 'updatedAt', AttributeType: 'S' },
    ],
    KeySchema: [
      { AttributeName: 'pk', KeyType: 'HASH' },
      { AttributeName: 'sk', KeyType: 'RANGE' },
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: 'status-updatedAt-index',
        KeySchema: [
          { AttributeName: 'status', KeyType: 'HASH' },
          { AttributeName: 'updatedAt', KeyType: 'RANGE' },
        ],
        Projection: {
          ProjectionType: 'INCLUDE',
          NonKeyAttributes: ['slug', 'name', 'tagline', 'launchTier', 'tagCode', 'heroImageId', 'recipeCount', 'publishedAt', 'version', 'placeholderContent'],
        },
      },
    ],
  },
  {
    TableName: TABLES.recipes,
    BillingMode: 'PAY_PER_REQUEST',
    AttributeDefinitions: [
      { AttributeName: 'blendSlug', AttributeType: 'S' },
      { AttributeName: 'sk', AttributeType: 'S' },
      { AttributeName: 'recipeId', AttributeType: 'S' },
    ],
    KeySchema: [
      { AttributeName: 'blendSlug', KeyType: 'HASH' },
      { AttributeName: 'sk', KeyType: 'RANGE' },
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: 'recipeId-index',
        KeySchema: [{ AttributeName: 'recipeId', KeyType: 'HASH' }],
        Projection: { ProjectionType: 'ALL' },
      },
    ],
  },
  {
    TableName: TABLES.growers,
    BillingMode: 'PAY_PER_REQUEST',
    AttributeDefinitions: [
      { AttributeName: 'growerId', AttributeType: 'S' },
      { AttributeName: 'entityType', AttributeType: 'S' },
      { AttributeName: 'name', AttributeType: 'S' },
    ],
    KeySchema: [{ AttributeName: 'growerId', KeyType: 'HASH' }],
    GlobalSecondaryIndexes: [
      {
        IndexName: 'entity-name-index',
        KeySchema: [
          { AttributeName: 'entityType', KeyType: 'HASH' },
          { AttributeName: 'name', KeyType: 'RANGE' },
        ],
        Projection: {
          ProjectionType: 'INCLUDE',
          NonKeyAttributes: ['farmName', 'country', 'region', 'portraitId', 'placeholderContent'],
        },
      },
    ],
  },
  {
    TableName: TABLES.tags,
    BillingMode: 'PAY_PER_REQUEST',
    AttributeDefinitions: [{ AttributeName: 'code', AttributeType: 'S' }],
    KeySchema: [{ AttributeName: 'code', KeyType: 'HASH' }],
  },
  {
    TableName: TABLES.scanEvents,
    BillingMode: 'PAY_PER_REQUEST',
    AttributeDefinitions: [
      { AttributeName: 'pk', AttributeType: 'S' },
      { AttributeName: 'sk', AttributeType: 'S' },
    ],
    KeySchema: [
      { AttributeName: 'pk', KeyType: 'HASH' },
      { AttributeName: 'sk', KeyType: 'RANGE' },
    ],
    StreamSpecification: { StreamEnabled: true, StreamViewType: 'NEW_IMAGE' },
  },
];

/* -------------------------------------------------------------------- main */

async function confirm(question) {
  if (ASSUME_YES) return true;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) => rl.question(question, resolve));
  rl.close();
  return answer.trim().toLowerCase() === 'yes';
}

async function main() {
  const items = buildItems();
  const { isPlaceholderData, placeholderCount } = guard(items);

  console.log('');
  console.log(`environment      ${ENV}`);
  console.log(`endpoint         ${ENDPOINT ?? `default AWS endpoint for ${REGION}`}`);
  console.log(`region           ${REGION}`);
  console.log(`table prefix     ${PREFIX || '(none)'}`);
  console.log(`items            ${items.length}`);
  console.log(`placeholder      ${placeholderCount} of ${items.length} items`);
  console.log(`redirect table   ${fs.existsSync(REDIRECT_TABLE) ? REDIRECT_TABLE : 'not found, NFCTags skipped'}`);
  if (OVERRIDE) console.log(`override         allow-placeholder-in-production, reason: ${REASON}`);
  console.log('');

  const byTable = {};
  for (const i of items) byTable[i.table] = (byTable[i.table] ?? 0) + 1;
  for (const [t, n] of Object.entries(byTable)) console.log(`  ${t.padEnd(24)} ${n} items`);
  console.log('');

  if (DRY_RUN) {
    const out = path.join(ROOT, 'reports', 'seed-dry-run.json');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(
      out,
      JSON.stringify(
        {
          $comment: 'Dry run output. Exactly the PutItem requests this tool would issue, in order.',
          generatedOn: spec.asOf,
          environment: ENV,
          endpoint: ENDPOINT,
          tables: byTable,
          placeholderItems: placeholderCount,
          requests: items.map((i) => ({
            TableName: i.table,
            Item: marshalItem(i.item),
          })),
        },
        null,
        2,
      ) + '\n',
    );
    console.log(`DRY RUN. No writes. ${items.length} PutItem requests written to reports/seed-dry-run.json.`);
    console.log('Marshalling was exercised for every item, so a type error would have failed here.');
    return;
  }

  if (ENV !== 'local') {
    const ok = await confirm(`Write ${items.length} items to ${ENV}? Type yes to continue: `);
    if (!ok) fail('cancelled at the confirmation prompt.');
  }

  const credentials = ENV === 'local' ? { ...localCredentials(), ...stripNulls(resolveCredentials()) } : resolveCredentials();
  const client = createClient({
    endpoint: ENDPOINT ?? `https://dynamodb.${REGION}.amazonaws.com`,
    region: REGION,
    credentials,
  });

  if (CREATE_TABLES) {
    for (const def of TABLE_DEFINITIONS) {
      try {
        await client.describeTable(def.TableName);
        console.log(`  table exists   ${def.TableName}`);
      } catch (err) {
        if (err.code !== 'ResourceNotFoundException') throw err;
        await client.createTable(def);
        console.log(`  table created  ${def.TableName}`);
      }
    }
    console.log('');
  }

  let created = 0;
  let updated = 0;
  let unchanged = 0;
  for (const i of items) {
    const res = await client.putItem({
      TableName: i.table,
      Item: marshalItem(i.item),
      ReturnValues: 'ALL_OLD',
    });
    const old = unmarshalItem(res.Attributes);
    if (!old) {
      created++;
    } else if (JSON.stringify(sortKeys(old)) === JSON.stringify(sortKeys(i.item))) {
      unchanged++;
    } else {
      updated++;
    }
  }

  console.log(`created ${created}, updated ${updated}, unchanged ${unchanged}, total ${items.length}`);
  console.log(
    unchanged === items.length
      ? 'Every item was already identical. That is the idempotency property, demonstrated rather than claimed.'
      : 'Run this again with no changes to the fixtures and every item should report unchanged.',
  );

  if (isPlaceholderData) {
    console.log('');
    console.log(`This data set is placeholder content. Every page built from it must render the`);
    console.log(`placeholder banner, and nothing here may be promoted to production.`);
  }
}

function stripNulls(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== null && v !== undefined));
}

function sortKeys(obj) {
  if (Array.isArray(obj)) return obj.map(sortKeys);
  if (obj && typeof obj === 'object') {
    return Object.fromEntries(Object.keys(obj).sort().map((k) => [k, sortKeys(obj[k])]));
  }
  return obj;
}

main().catch((err) => {
  console.error('\nFAILED: ' + err.message);
  process.exit(1);
});
