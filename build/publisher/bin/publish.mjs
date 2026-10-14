#!/usr/bin/env node
/*
 * One shot publish, from a terminal or from CI.
 *
 * This is what replaces the `aws s3 sync` that put the current pages in the bucket by hand.
 * The difference that matters is not automation, it is that a sync has no idea what a blend
 * page is: it cannot apply the placeholder guard, it cannot tell a document from an asset
 * when it sets Cache-Control, and it cannot invalidate the CDN at all. The one sync this
 * project has already run set a one year max-age on every object including HTML, which is
 * the single change that would have defeated the five minute requirement outright.
 *
 * Usage:
 *   node bin/publish.mjs --all
 *   node bin/publish.mjs --blend persian-sunrise
 *   node bin/publish.mjs --path /blends/silk-road --path /sitemap.xml
 *   node bin/publish.mjs --all --dry-run
 */

import { config } from '../src/config.mjs';
import { fail, newJob, toWire } from '../src/jobs.mjs';
import { runPublish } from '../src/publish.mjs';
import { createStores } from '../src/stores.mjs';
import { walk } from '../src/tree.mjs';

function parseArgs(argv) {
  const args = { paths: [], all: false, dryRun: false, reason: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--all') args.all = true;
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--blend') args.paths.push(`/blends/${argv[++i]}`);
    else if (arg === '--path') args.paths.push(argv[++i]);
    else if (arg === '--reason') args.reason = argv[++i];
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`unrecognised argument '${arg}'.`);
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));

if (args.help || (!args.all && args.paths.length === 0)) {
  process.stdout.write(
    'node bin/publish.mjs --all | --blend <slug> | --path <path> [--reason <text>] [--dry-run]\n',
  );
  process.exit(args.help ? 0 : 2);
}

const paths = args.all ? walk(config.renderDir).map((key) => `/${key}`) : args.paths;

const { store, cdn } = createStores(config);
const job = newJob({
  revalidationId: `cli_${Date.now()}`,
  paths,
  reason: args.reason ?? 'published from the command line',
  requestedBy: 'cli',
  stage: config.stage,
  target: config.target,
});

if (args.dryRun) {
  process.stdout.write(
    `dry run\n  stage   ${config.stage}\n  target  ${config.target}\n  origin  ${store.name}\n` +
      `  cdn     ${cdn.name}\n  paths   ${paths.length}\n`,
  );
  process.exit(0);
}

try {
  await runPublish(job, { config, store, cdn });
} catch (err) {
  fail(job, err);
}

const wire = toWire(job);
process.stdout.write(`${JSON.stringify(wire, null, 2)}\n`);

if (job.status === 'failed') process.exit(1);
if (job.status === 'published_unconfirmed') process.exit(config.cdn.publicBaseUrl ? 1 : 0);
process.exit(0);
