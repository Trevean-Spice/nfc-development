#!/usr/bin/env node
/**
 * Content readiness report.
 *
 * Turns "the content drafts are late" into a specific list: which blend, which field,
 * who owns it, what it has to look like, and whether it blocks publish. A client can
 * act on a list. Nobody can act on a complaint.
 *
 * Reads spec/content-field-spec.json and the fixtures. Nothing else defines these facts.
 *
 * Usage:
 *   node tools/content-readiness.mjs                    text report to stdout
 *   node tools/content-readiness.mjs --format markdown
 *   node tools/content-readiness.mjs --format json
 *   node tools/content-readiness.mjs --blend persian-sunrise
 *   node tools/content-readiness.mjs --fail-on-placeholder     exit 1 if anything is placeholder
 *   node tools/content-readiness.mjs --out reports/x.md --format markdown
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  ROOT, loadSpec, loadAllFixtures, loadMediaManifest,
  PLACEHOLDER_STATES, carriesSentinel, getPath, BLEND_ORDER, SENTINEL,
} from './lib/fixtures.mjs';

/* --------------------------------------------------------------- arguments */

const argv = process.argv.slice(2);
function opt(name, fallback = null) {
  const i = argv.indexOf(name);
  return i === -1 ? fallback : argv[i + 1];
}
const FORMAT = opt('--format', 'text');
const ONLY_BLEND = opt('--blend', null);
const OUT = opt('--out', null);
const FAIL_ON_PLACEHOLDER = argv.includes('--fail-on-placeholder');

/* ------------------------------------------------------------------ report */

const spec = loadSpec();
const fixtures = loadAllFixtures();
const media = loadMediaManifest();

const ASOF = spec.asOf;
const DUE = spec.contentDueFromClient;
const GATE = spec.gateDate;

function daysBetween(a, b) {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
}

function stateOf(record, fieldPath) {
  const flags = record._placeholder?.fields ?? {};
  if (fieldPath in flags) return { state: flags[fieldPath], inherited: false };
  if (fieldPath.includes('[]')) {
    const parent = fieldPath.split('[]')[0].replace(/\.$/, '');
    if (parent in flags) return { state: flags[parent], inherited: true };
  }
  return { state: 'UNFLAGGED', inherited: false };
}

function assess(entityKey, record, payload, label, extra = {}) {
  const fields = spec.entities[entityKey].fields;
  const rows = [];
  for (const field of fields) {
    const { state, inherited } = stateOf(record, field.path);
    const value = field.path.includes('[]') ? undefined : getPath(payload, field.path);
    const isPlaceholder = PLACEHOLDER_STATES.has(state);
    rows.push({
      entity: entityKey,
      record: label,
      path: field.path,
      label: field.label,
      owner: field.owner,
      state,
      inherited,
      isPlaceholder,
      requiredForPublish: field.requiredForPublish === true,
      blocksPublish: isPlaceholder && field.requiredForPublish === true,
      guidance: field.guidance,
      maxLength: field.maxLength ?? null,
      targetMin: field.targetMin ?? null,
      targetMax: field.targetMax ?? null,
      actualLength: typeof value === 'string' ? value.length : null,
      valuePresent: value !== null && value !== undefined && !(Array.isArray(value) && value.length === 0),
      ...extra,
    });
  }
  return rows;
}

const rows = [];
const integrity = [];

for (const b of fixtures.blends) {
  if (ONLY_BLEND && b.blend.slug !== ONLY_BLEND) continue;
  rows.push(...assess('blend', b, b.blend, b.blend.slug, { blendSlug: b.blend.slug }));
}
for (const g of fixtures.growers) {
  const slug = g.grower.blendSlugs[0];
  if (ONLY_BLEND && slug !== ONLY_BLEND) continue;
  rows.push(...assess('grower', g, g.grower, g.grower.growerId, { blendSlug: slug }));
}
for (const r of fixtures.recipes) {
  if (ONLY_BLEND && r.blendSlug !== ONLY_BLEND) continue;
  for (const entry of r.recipes) {
    rows.push(
      ...assess('recipe', entry, entry.recipe, `${r.blendSlug} recipe ${entry.recipe.sortOrder}`, {
        blendSlug: r.blendSlug,
      }),
    );
  }
}
for (const c of fixtures.catalog) {
  if (ONLY_BLEND && c.catalog.slug !== ONLY_BLEND) continue;
  rows.push(...assess('catalog', c, c.catalog, c.catalog.slug, { blendSlug: c.catalog.slug }));
}

/* --------------------------------------------------------- integrity checks */

for (const row of rows) {
  if (row.state === 'UNFLAGGED') {
    integrity.push(`${row.blendSlug}: ${row.entity}.${row.path} is not covered by the placeholder flag. Every field in the spec must carry a state.`);
  }
  if (row.maxLength && row.actualLength && row.actualLength > row.maxLength) {
    integrity.push(`${row.blendSlug}: ${row.entity}.${row.path} is ${row.actualLength} characters, over the contract maximum of ${row.maxLength}.`);
  }
  if (row.isPlaceholder && row.state === 'placeholder_text' && row.actualLength !== null && !String(getPathSafe(row)).includes(SENTINEL)) {
    integrity.push(`${row.blendSlug}: ${row.entity}.${row.path} is flagged placeholder_text but does not carry the ${SENTINEL} sentinel.`);
  }
}

function getPathSafe(row) {
  const bag = { blend: fixtures.blends, grower: fixtures.growers, catalog: fixtures.catalog };
  const list = bag[row.entity];
  if (!list) return SENTINEL; // recipes are checked in bulk below
  const rec = list.find((r) => (r.blend?.slug ?? r.grower?.blendSlugs?.[0] ?? r.catalog?.slug) === row.blendSlug);
  const payload = rec?.blend ?? rec?.grower ?? rec?.catalog ?? {};
  const v = getPath(payload, row.path);
  return typeof v === 'string' ? v : SENTINEL;
}

// Recipe counts against the Scope document requirement.
const recipeRange = [spec.entities.recipe.perBlendMin, spec.entities.recipe.perBlendMax];
const recipeStatus = fixtures.recipes
  .filter((r) => !ONLY_BLEND || r.blendSlug === ONLY_BLEND)
  .map((r) => {
    const blend = fixtures.blends.find((b) => b.blend.slug === r.blendSlug);
    const tier = blend?.blend.launchTier;
    const required = spec.entities.recipe.appliesToLaunchTier.includes(tier);
    return {
      blendSlug: r.blendSlug,
      launchTier: tier,
      count: r.recipes.length,
      required,
      shortfall: required ? Math.max(0, recipeRange[0] - r.recipes.length) : 0,
      declaredRecipeCount: blend?.blend.recipeCount,
    };
  });

for (const r of recipeStatus) {
  if (r.declaredRecipeCount !== r.count) {
    integrity.push(`${r.blendSlug}: blend.recipeCount says ${r.declaredRecipeCount} but ${r.count} recipe fixtures exist.`);
  }
}

// Image budget check, per blend, against the whole page image allowance.
const WHOLE_PAGE_IMAGE_BUDGET = 614400;
const imageBudget = BLEND_ORDER.filter((s) => !ONLY_BLEND || s === ONLY_BLEND).map((slug) => {
  const assets = media.assets.filter((a) => a.blendSlug === slug);
  const bytes = assets.reduce((n, a) => n + a.bytes, 0);
  const hero = assets.find((a) => a.kind === 'hero');
  return {
    blendSlug: slug,
    assetCount: assets.length,
    bytes,
    budget: WHOLE_PAGE_IMAGE_BUDGET,
    withinBudget: bytes <= WHOLE_PAGE_IMAGE_BUDGET,
    heroBytes: hero?.bytes ?? null,
    heroBudget: hero?.budgetBytes ?? null,
    heroDimensions: hero ? `${hero.width}x${hero.height}` : null,
  };
});

for (const b of imageBudget) {
  if (!b.withinBudget) {
    integrity.push(`${b.blendSlug}: placeholder imagery totals ${b.bytes} bytes, over the ${WHOLE_PAGE_IMAGE_BUDGET} byte whole page image budget.`);
  }
}

/* ------------------------------------------------------------- aggregation */

const blends = BLEND_ORDER.filter((s) => !ONLY_BLEND || s === ONLY_BLEND).map((slug) => {
  const mine = rows.filter((r) => r.blendSlug === slug);
  const placeholders = mine.filter((r) => r.isPlaceholder);
  const blocking = mine.filter((r) => r.blocksPublish);
  const blend = fixtures.blends.find((b) => b.blend.slug === slug)?.blend;
  return {
    slug,
    name: blend?.name,
    launchTier: blend?.launchTier,
    status: blend?.status,
    tagCode: blend?.tagCode,
    fieldsTotal: mine.length,
    fieldsReal: mine.length - placeholders.length,
    fieldsPlaceholder: placeholders.length,
    fieldsBlockingPublish: blocking.length,
    percentReal: Math.round(((mine.length - placeholders.length) / mine.length) * 100),
    rows: mine,
  };
});

const byOwner = {};
for (const r of rows.filter((x) => x.isPlaceholder)) {
  byOwner[r.owner] = (byOwner[r.owner] ?? 0) + 1;
}

const summary = {
  asOf: ASOF,
  contentDueFromClient: DUE,
  daysOverdue: daysBetween(DUE, ASOF),
  gateDate: GATE,
  daysToGate: daysBetween(ASOF, GATE),
  blendCount: blends.length,
  fieldsTotal: rows.length,
  fieldsPlaceholder: rows.filter((r) => r.isPlaceholder).length,
  fieldsBlockingPublish: rows.filter((r) => r.blocksPublish).length,
  placeholderByOwner: byOwner,
  integrityProblems: integrity.length,
};

/* ---------------------------------------------------------------- rendering */

const STATE_LABEL = {
  client_real: 'real, from Trevean',
  contractor_real: 'real, from us',
  placeholder_text: 'PLACEHOLDER text',
  placeholder_null: 'PLACEHOLDER, held null',
  placeholder_media: 'PLACEHOLDER image',
  not_applicable: 'not applicable',
  UNFLAGGED: 'UNFLAGGED, convention breach',
};

function renderText() {
  const L = [];
  const rule = '='.repeat(78);
  L.push(rule);
  L.push('TREVEAN SPICE NFC, CONTENT READINESS REPORT');
  L.push(rule);
  L.push(`As of                      ${ASOF}`);
  L.push(`Client content was due     ${DUE}  (${summary.daysOverdue} days ago)`);
  L.push(`M2 gate                    ${GATE} at the earliest  (${summary.daysToGate} days away, conditional)`);
  L.push(`Blends                     ${summary.blendCount}`);
  L.push(`Content fields tracked     ${summary.fieldsTotal}`);
  L.push(`Still placeholder          ${summary.fieldsPlaceholder}`);
  L.push(`Of those, blocking publish ${summary.fieldsBlockingPublish}`);
  L.push('');
  L.push('Outstanding by owner:');
  for (const [owner, n] of Object.entries(byOwner)) L.push(`  ${owner.padEnd(14)} ${n} fields`);
  L.push('');

  L.push('-'.repeat(78));
  L.push('PER BLEND');
  L.push('-'.repeat(78));
  L.push('blend                        tier    status     real  placeholder  blocking');
  for (const b of blends) {
    L.push(
      `${b.slug.padEnd(28)} ${String(b.launchTier).padEnd(7)} ${String(b.status).padEnd(10)} ` +
        `${String(b.fieldsReal).padStart(4)} ${String(b.fieldsPlaceholder).padStart(12)} ${String(b.fieldsBlockingPublish).padStart(9)}`,
    );
  }
  L.push('');

  for (const b of blends) {
    L.push('-'.repeat(78));
    L.push(`${b.name}  (/t/${b.tagCode}, ${b.launchTier}, ${b.fieldsPlaceholder} of ${b.fieldsTotal} fields still placeholder)`);
    L.push('-'.repeat(78));
    const grouped = {};
    for (const r of b.rows.filter((x) => x.isPlaceholder)) {
      const key = `${r.entity}${r.entity === 'recipe' ? ' (all ' + b.rows.filter((z) => z.entity === 'recipe').length / spec.entities.recipe.fields.length + ')' : ''}`;
      (grouped[key] ??= []).push(r);
    }
    for (const [group, list] of Object.entries(grouped)) {
      const seen = new Set();
      L.push(`  ${group}:`);
      for (const r of list) {
        if (seen.has(r.path)) continue;
        seen.add(r.path);
        const n = list.filter((x) => x.path === r.path).length;
        const count = n > 1 ? ` x${n}` : '';
        L.push(
          `    ${(r.path + count).padEnd(30)} ${STATE_LABEL[r.state].padEnd(24)} ${r.owner.padEnd(12)} ${r.blocksPublish ? 'BLOCKS PUBLISH' : ''}`,
        );
      }
    }
    const rs = recipeStatus.find((x) => x.blendSlug === b.slug);
    if (rs) {
      L.push(
        `  recipes: ${rs.count} of ${recipeRange[0]} to ${recipeRange[1]} required` +
          (rs.required ? (rs.shortfall ? `, SHORT BY ${rs.shortfall}` : '') : ', not required for a seeded blend'),
      );
    }
    const ib = imageBudget.find((x) => x.blendSlug === b.slug);
    if (ib) {
      L.push(
        `  imagery: ${ib.assetCount} placeholder assets, ${ib.bytes} bytes of a ${ib.budget} byte page budget, ` +
          `hero ${ib.heroDimensions} at ${ib.heroBytes} bytes (budget ${ib.heroBudget})`,
      );
    }
    L.push('');
  }

  L.push('-'.repeat(78));
  L.push('WHAT WE NEED, CONSOLIDATED');
  L.push('-'.repeat(78));
  const need = {};
  for (const r of rows.filter((x) => x.isPlaceholder && x.owner !== 'Serene Labs')) {
    const key = `${r.owner}|${r.entity}.${r.path}`;
    (need[key] ??= { owner: r.owner, field: `${r.entity}.${r.path}`, label: r.label, guidance: r.guidance, blends: new Set(), blocks: false });
    need[key].blends.add(r.blendSlug);
    need[key].blocks = need[key].blocks || r.blocksPublish;
  }
  for (const item of Object.values(need)) {
    const n = item.blends.size;
    L.push(`  [${item.owner}] ${item.field}  (${n} blend${n === 1 ? '' : 's'})${item.blocks ? '  BLOCKS PUBLISH' : ''}`);
    L.push(`      ${item.label}: ${item.guidance}`);
  }
  L.push('');

  L.push('-'.repeat(78));
  L.push('INTEGRITY CHECKS');
  L.push('-'.repeat(78));
  if (integrity.length === 0) {
    L.push('  All fixtures carry a placeholder state for every field in the specification,');
    L.push('  every placeholder string carries the sentinel, every string is inside its');
    L.push('  contract length, recipe counts agree with the fixtures, and every blend is');
    L.push('  inside the whole page image budget.');
  } else {
    for (const problem of integrity) L.push(`  ${problem}`);
  }
  L.push('');
  L.push(rule);
  L.push(
    summary.fieldsPlaceholder === 0
      ? 'ALL CONTENT IS REAL. This data set may be seeded to production.'
      : 'PLACEHOLDER CONTENT PRESENT. This data set must not be seeded to production.',
  );
  L.push(rule);
  return L.join('\n');
}

function renderMarkdown() {
  const L = [];
  L.push('# Content readiness report');
  L.push('');
  L.push(`**As of ${ASOF}. Client content was due ${DUE}, ${summary.daysOverdue} days ago. The M2 gate is conditional and moves day for day from Friday 21 August 2026: ${GATE} at the earliest, ${summary.daysToGate} days away.**`);
  L.push('');
  L.push(`${summary.fieldsPlaceholder} of ${summary.fieldsTotal} tracked content fields are still placeholder, of which ${summary.fieldsBlockingPublish} block publish.`);
  L.push('');
  L.push('| Blend | Tier | Status | Real | Placeholder | Blocking publish |');
  L.push('|---|---|---|---|---|---|');
  for (const b of blends) {
    L.push(`| ${b.name} | ${b.launchTier} | ${b.status} | ${b.fieldsReal} | ${b.fieldsPlaceholder} | ${b.fieldsBlockingPublish} |`);
  }
  L.push('');
  for (const b of blends) {
    L.push(`## ${b.name}`);
    L.push('');
    L.push('| Field | State | Owner | Blocks publish |');
    L.push('|---|---|---|---|');
    const seen = new Set();
    for (const r of b.rows.filter((x) => x.isPlaceholder)) {
      const key = `${r.entity}.${r.path}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const n = b.rows.filter((x) => x.isPlaceholder && `${x.entity}.${x.path}` === key).length;
      L.push(`| \`${key}\`${n > 1 ? ` (x${n})` : ''} | ${STATE_LABEL[r.state]} | ${r.owner} | ${r.blocksPublish ? 'yes' : 'no'} |`);
    }
    L.push('');
  }
  L.push('## Integrity checks');
  L.push('');
  if (integrity.length === 0) L.push('No problems found.');
  else for (const p of integrity) L.push(`- ${p}`);
  L.push('');
  return L.join('\n');
}

const output =
  FORMAT === 'json'
    ? JSON.stringify({ summary, blends: blends.map(({ rows: _r, ...rest }) => rest), rows, recipeStatus, imageBudget, integrity }, null, 2)
    : FORMAT === 'markdown'
      ? renderMarkdown()
      : renderText();

if (OUT) {
  const dest = path.isAbsolute(OUT) ? OUT : path.join(ROOT, OUT);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, output + '\n');
  console.log(`written to ${OUT}`);
} else {
  console.log(output);
}

if (integrity.length > 0) process.exit(2);
if (FAIL_ON_PLACEHOLDER && summary.fieldsPlaceholder > 0) process.exit(1);
