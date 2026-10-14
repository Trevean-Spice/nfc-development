import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluate } from '../../src/publish/guard.js';
import { loadReadiness } from '../../src/content/readiness.js';
import { reportForBlend, scanForSentinels } from '../../src/content/placeholder.js';
import type { Blend, Grower, Recipe } from '../../src/api/types.js';

/**
 * The placeholder detector.
 *
 * The direction of every judgement here is one way: being wrong towards "this is not real"
 * costs an unnecessary refusal a person can override in one screen. Being wrong the other way
 * puts a fabricated grower in front of a customer, and it survives a publish.
 */

const here = dirname(fileURLToPath(import.meta.url));
const CONTENT_DIR = resolve(here, '..', '..', '..', 'content');
const source = loadReadiness(CONTENT_DIR);
const absent = loadReadiness(resolve(here, 'no-such-content-package'));

function blend(overrides: Partial<Blend> = {}): Blend {
  return {
    slug: 'persian-sunrise',
    name: 'Persian Sunrise',
    status: 'draft',
    launchTier: 'real',
    tagCode: 'ps',
    version: 1,
    updatedAt: '2026-08-22T12:00:00Z',
    tagline: null,
    originCountry: null,
    originRegion: null,
    originCity: null,
    farm: null,
    storyBlocks: [],
    freshness: {},
    growerId: null,
    shopify: {},
    heroImage: null,
    ...overrides,
  };
}

function grower(overrides: Partial<Grower> = {}): Grower {
  return {
    growerId: 'grw_01J9Z900A1B2C3D4E5F6G7H8J9',
    name: 'A real named grower',
    farmName: 'A real farm',
    country: 'IR',
    region: 'Isfahan',
    bio: 'x'.repeat(700),
    yearsFarming: 20,
    portrait: { mediaId: 'med_01J9Z8XK4M2Q7T5V3N8R1B6C0D', cdnUrl: 'https://cdn/x', alt: 'a', width: 1, height: 1 },
    farm: { latitude: 32.6539, longitude: 51.666 },
    blendSlugs: ['persian-sunrise'],
    version: 1,
    updatedAt: '2026-08-22T12:00:00Z',
    ...overrides,
  };
}

describe('the content package loads', () => {
  it('and carries the convention and the field specification', () => {
    expect(source.available).toBe(true);
    expect(source.sentinel).toBe('[PLACEHOLDER]');
    expect(source.secondaryMarker).toBe('NOT REAL CONTENT');
    expect(source.fields.blend.length).toBeGreaterThan(20);
    expect(source.fields.grower.length).toBeGreaterThan(5);
    expect(source.fields.recipe.length).toBeGreaterThan(5);
  });

  it('and records per field readiness for every one of the five blends', () => {
    for (const slug of [
      'persian-sunrise',
      'caribbean-sunset',
      'north-african-night-market',
      'silk-road',
      'kyoto-garden',
    ]) {
      expect(source.blendStates.has(slug)).toBe(true);
    }
  });
});

describe('detection', () => {
  it('finds the sentinel wherever it is nested', () => {
    const hits = scanForSentinels({
      a: 'fine',
      b: ['fine', { c: '[PLACEHOLDER] STORY PENDING, NOT REAL CONTENT' }],
      d: { e: { f: 'med_FAKEHRPS010000000000000000' } },
    });
    expect(hits.map((h) => h.path)).toEqual(['b[1].c', 'd.e.f']);
  });

  it('flags a value that carries the marker', () => {
    const report = reportForBlend(
      blend({ tagline: '[PLACEHOLDER] TAGLINE PENDING, NOT REAL CONTENT', growerId: grower().growerId }),
      grower(),
      [],
      source,
    );
    const tagline = report.findings.find((f) => f.entity === 'blend' && f.path === 'tagline');
    expect(tagline?.isPlaceholder).toBe(true);
    expect(tagline?.detectedBy).toContain('sentinel');
  });

  it('flags a value that says placeholder in some other wording, which the API seed does', () => {
    const report = reportForBlend(
      blend({ growerId: grower().growerId }),
      grower({ name: 'Placeholder pending content delivery' }),
      [],
      source,
    );
    const name = report.findings.find((f) => f.entity === 'grower' && f.path === 'name');
    expect(name?.isPlaceholder).toBe(true);
    expect(name?.detectedBy).toContain('marker');
  });

  it('flags a media id in the reserved fake range', () => {
    const report = reportForBlend(
      blend({
        growerId: grower().growerId,
        heroImage: { mediaId: 'med_FAKEHRPS010000000000000000', cdnUrl: 'https://cdn/x', alt: 'a', width: 1, height: 1 },
      }),
      grower(),
      [],
      source,
    );
    const hero = report.findings.find((f) => f.entity === 'blend' && f.path === 'heroImageId');
    expect(hero?.detectedBy).toContain('fake_id');
    expect(hero?.state).toBe('placeholder_media');
  });

  it('flags a field that is required to publish and empty', () => {
    const report = reportForBlend(blend({ growerId: grower().growerId }), grower(), [], source);
    const harvested = report.findings.find((f) => f.path === 'freshness.harvestedOn');
    expect(harvested?.isPlaceholder).toBe(true);
    expect(harvested?.blocksPublish).toBe(true);
    expect(harvested?.detectedBy).toContain('missing_required');
  });

  it('never treats a coordinate as satisfied by the blend origin', () => {
    const report = reportForBlend(blend({ originCountry: 'IR', originRegion: 'Isfahan' }), grower({ farm: null }), [], source);
    const lat = report.findings.find((f) => f.entity === 'grower' && f.path === 'farm.latitude');
    expect(lat?.isPlaceholder).toBe(true);
  });

  it('blocks publish when a blend has no grower at all', () => {
    const report = reportForBlend(blend({ growerId: null }), null, [], source);
    const missing = report.findings.find((f) => f.entity === 'grower' && f.path === 'growerId');
    expect(missing?.blocksPublish).toBe(true);
    expect(report.safeToPublish).toBe(false);
  });

  it('flags placeholder recipes as well as the blend', () => {
    const recipe: Recipe = {
      recipeId: 'rcp_01J9Z91B2C3D4E5F6G7H8J9K0M',
      blendSlug: 'persian-sunrise',
      title: '[PLACEHOLDER] RECIPE 1 PENDING, NOT REAL CONTENT',
      summary: null,
      ingredients: [],
      steps: [],
      sortOrder: 1,
      status: 'draft',
      version: 1,
      updatedAt: '2026-08-22T12:00:00Z',
    };
    const report = reportForBlend(blend({ growerId: grower().growerId }), grower(), [recipe], source);
    const title = report.findings.find((f) => f.entity === 'recipe' && f.path === 'title');
    expect(title?.isPlaceholder).toBe(true);
    expect(report.sentinelHits.length).toBeGreaterThan(0);
  });
});

describe('a content package that parses but describes nothing', () => {
  /**
   * The guard is a loop over the field specification. A specification that parses but
   * declares no fields makes the loop find nothing, so nothing blocks and a wholly
   * fabricated grower publishes clean: no phrase, no reason, no acknowledgement, and no
   * audit entry recording that an override happened.
   *
   * CONTENT_DIR is an environment variable, so before this was closed there was an
   * environment variable that turned the placeholder guard off, which is the one thing the
   * guard's own documentation promises does not exist.
   */
  function emptySpecDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'trevean-empty-spec-'));
    mkdirSync(join(dir, 'spec'), { recursive: true });
    writeFileSync(
      join(dir, 'spec', 'content-field-spec.json'),
      JSON.stringify({ conventionVersion: 1, sentinel: '[PLACEHOLDER]', entities: {} }),
      'utf8',
    );
    return dir;
  }

  const fabricated = blend({
    tagline: 'Grown on terraces above the Zayandeh river',
    originCountry: 'IR',
    originRegion: 'Isfahan',
    farm: { latitude: 32.6539, longitude: 51.666, label: 'A valley' },
    storyBlocks: [{ type: 'paragraph', text: 'A story nobody at Trevean told anyone.' }],
    freshness: { harvestedOn: '2026-05-01', blendedOn: '2026-06-01', bestBefore: '2027-06-01', lotLabel: 'L1' },
    growerId: grower().growerId,
    heroImage: { mediaId: 'med_01J9Z8XK4M2Q7T5V3N8R1B6C0D', cdnUrl: 'https://cdn/x', alt: 'a', width: 1, height: 1 },
    shopify: { sku: 'TRV-PS-60G', productId: 'p', variantId: 'v', cartPermalinkUrl: 'https://shop/x' },
  });

  it('is unavailable, exactly like a package that is not there at all', () => {
    const empty = loadReadiness(emptySpecDir());
    expect(empty.available).toBe(false);
    expect(empty.unavailableReason).toContain('declares no fields');
  });

  it('blocks publish rather than waving a fabricated grower through with no override', () => {
    const report = reportForBlend(fabricated, grower(), [], loadReadiness(emptySpecDir()));
    expect(report.safeToPublish).toBe(false);
    expect(report.blockingCount).toBeGreaterThan(0);

    const decision = evaluate(report, undefined);
    expect(decision.allowed).toBe(false);
  });
});

describe('failing towards this is not real', () => {
  it('treats every Trevean owned publish blocking field as unverified when the content package is missing', () => {
    expect(absent.available).toBe(false);
    const complete = blend({
      tagline: 'A real tagline supplied by Trevean',
      originCountry: 'IR',
      originRegion: 'Isfahan',
      farm: { latitude: 32.6539, longitude: 51.666, label: 'A valley' },
      storyBlocks: [{ type: 'heading', text: 'A heading' }, { type: 'paragraph', text: 'A paragraph' }],
      freshness: { harvestedOn: '2026-05-01', blendedOn: '2026-06-01', bestBefore: '2027-06-01', lotLabel: 'L1' },
      growerId: grower().growerId,
      heroImage: { mediaId: 'med_01J9Z8XK4M2Q7T5V3N8R1B6C0D', cdnUrl: 'https://cdn/x', alt: 'a', width: 1, height: 1 },
      shopify: { sku: 'TRV-PS-60G', productId: 'p', variantId: 'v', cartPermalinkUrl: 'https://shop/x' },
    });
    const report = reportForBlend(complete, grower(), [], absent);
    expect(report.safeToPublish).toBe(false);
    expect(report.findings.some((f) => f.state === 'unverified')).toBe(true);
    expect(report.readinessAvailable).toBe(false);
    expect(report.readinessNote).toContain('unverified');
  });

  it('and lets fully real content through when the content package confirms it', () => {
    const states = new Map(source.blendStates);
    const all = Object.fromEntries(
      source.fields.blend.map((f) => [f.path, f.owner === 'Serene Labs' ? 'contractor_real' : 'client_real']),
    ) as Record<string, 'client_real' | 'contractor_real'>;
    states.set('persian-sunrise', all);
    const growerStates = new Map(source.growerStates);
    growerStates.set(
      'persian-sunrise',
      Object.fromEntries(source.fields.grower.map((f) => [f.path, 'client_real'])) as Record<string, 'client_real'>,
    );

    const complete = blend({
      tagline: 'A real tagline supplied by Trevean',
      originCountry: 'IR',
      originRegion: 'Isfahan',
      farm: { latitude: 32.6539, longitude: 51.666, label: 'A valley' },
      storyBlocks: [{ type: 'heading', text: 'A heading' }, { type: 'paragraph', text: 'A paragraph' }],
      freshness: { harvestedOn: '2026-05-01', blendedOn: '2026-06-01', bestBefore: '2027-06-01', lotLabel: 'L1' },
      growerId: grower().growerId,
      heroImage: { mediaId: 'med_01J9Z8XK4M2Q7T5V3N8R1B6C0D', cdnUrl: 'https://cdn/x', alt: 'a', width: 1, height: 1 },
      shopify: { sku: 'TRV-PS-60G', productId: 'p', variantId: 'v', cartPermalinkUrl: 'https://shop/x' },
    });

    const report = reportForBlend(complete, grower(), [], { ...source, blendStates: states, growerStates });
    expect(report.blockingCount).toBe(0);
    expect(report.safeToPublish).toBe(true);
    expect(report.headline).toContain('No placeholder content');
  });
});
