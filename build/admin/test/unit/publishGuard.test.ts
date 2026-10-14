import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluate } from '../../src/publish/guard.js';
import { loadConfig } from '../../src/config.js';
import { loadReadiness } from '../../src/content/readiness.js';
import { reportForBlend, scanForSentinels, type PlaceholderReport } from '../../src/content/placeholder.js';
import type { Blend, Grower } from '../../src/api/types.js';

const PHRASE = 'PUBLISH PLACEHOLDER CONTENT';
const REASON = 'The gate rehearsal needs a live page while content is outstanding.';

function report(safe: boolean): PlaceholderReport {
  return {
    slug: 'persian-sunrise',
    readinessAvailable: true,
    readinessNote: null,
    findings: safe
      ? []
      : [
          {
            entity: 'grower',
            record: 'Grower profile',
            recordId: 'grw_1',
            path: 'name',
            label: 'Grower name',
            owner: 'Trevean',
            state: 'placeholder_text',
            isPlaceholder: true,
            requiredForPublish: true,
            blocksPublish: true,
            detectedBy: ['sentinel'],
            value: '[PLACEHOLDER]',
            guidance: '',
          },
        ],
    fieldsTotal: 1,
    fieldsReal: safe ? 1 : 0,
    placeholderCount: safe ? 0 : 1,
    blockingCount: safe ? 0 : 1,
    sentinelHits: [],
    safeToPublish: safe,
    headline: '',
  };
}

describe('the placeholder publish guard', () => {
  it('allows a publish with no override when nothing is placeholder', () => {
    expect(evaluate(report(true), undefined)).toEqual({ allowed: true, overridden: false });
  });

  it('refuses with no override when something is placeholder', () => {
    const decision = evaluate(report(false), undefined);
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.problems).toHaveLength(3);
  });

  it('needs the phrase typed exactly, case included', () => {
    const decision = evaluate(report(false), { phrase: 'publish placeholder content', reason: REASON, acknowledged: true });
    expect(decision.allowed).toBe(false);
  });

  it('needs a reason of at least twenty characters', () => {
    const decision = evaluate(report(false), { phrase: PHRASE, reason: 'because', acknowledged: true });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.problems.join(' ')).toContain('20 characters');
  });

  it('needs the acknowledgement as well as the phrase, because a checkbox alone is one click', () => {
    const decision = evaluate(report(false), { phrase: PHRASE, reason: REASON, acknowledged: false });
    expect(decision.allowed).toBe(false);
  });

  it('allows the publish when all three are given, and reports it as overridden', () => {
    const decision = evaluate(report(false), { phrase: PHRASE, reason: REASON, acknowledged: true });
    expect(decision.allowed).toBe(true);
    if (decision.allowed && decision.overridden) {
      expect(decision.reason).toBe(REASON);
      expect(decision.blockingFields).toEqual(['Grower profile: Grower name']);
    } else {
      throw new Error('The decision should have been an override.');
    }
  });

  it('does not store the override, so the next publish is asked again', () => {
    const granted = evaluate(report(false), { phrase: PHRASE, reason: REASON, acknowledged: true });
    expect(granted.allowed).toBe(true);

    // Same guard, same process, same report, immediately afterwards. An override that
    // applied to anything beyond the publish it was typed for would show up here.
    const next = evaluate(report(false), undefined);
    expect(next.allowed).toBe(false);
    if (!next.allowed) expect(next.problems).toHaveLength(3);
  });
});

/**
 * The claim this exercises is the fourth requirement in `src/publish/guard.ts`: the override
 * "is not stored, there is no environment variable that turns the guard off, and there is no
 * do not ask again".
 *
 * That is a property of the system, not of one file. The test that used to stand here read
 * `guard.ts` as text and asserted it contained no `process.env`. That is true of the file and
 * says nothing about the claim, and it passed throughout a working exploit that turned the
 * guard off with `CONTENT_DIR`: the guard's input is a report built by looping over the field
 * specification in the content package, and `CONTENT_DIR` is where the content package is
 * read from. A specification of `{"entities":{}}` gave a loop over nothing, so nothing blocked
 * and a wholly fabricated grower published clean, with no phrase, no reason, no acknowledgement
 * and no audit entry saying an override had happened.
 *
 * So these run the real pipeline instead. Every hostile shape of the directory the environment
 * can point the admin at has to end in a refusal.
 */
describe('no configuration can turn the placeholder publish guard off', () => {
  const here = fileURLToPath(new URL('.', import.meta.url));
  const REAL_CONTENT_DIR = resolve(here, '..', '..', '..', 'content');

  /**
   * A blend and a grower that are entirely invented but carry no sentinel, no marker wording
   * and no id in the reserved FAKE range. That is deliberate: it is exactly the record the
   * field specification exists to catch, and it is the one the sentinel scan cannot. If this
   * fixture tripped the scan, every assertion below would pass without the specification
   * being consulted at all, which is the vacuous test this is replacing.
   */
  const fabricatedGrower: Grower = {
    growerId: 'grw_01J9Z900A1B2C3D4E5F6G7H8J9',
    name: 'Farhad Mostafavi',
    farmName: 'Zayandeh Terraces',
    country: 'IR',
    region: 'Isfahan',
    bio: 'A third generation saffron grower on the terraces above the river. '.repeat(10),
    yearsFarming: 31,
    portrait: { mediaId: 'med_01J9Z8XK4M2Q7T5V3N8R1B6C0D', cdnUrl: 'https://cdn/x', alt: 'a', width: 1, height: 1 },
    farm: { latitude: 32.6539, longitude: 51.666 },
    blendSlugs: ['persian-sunrise'],
    version: 1,
    updatedAt: '2026-08-27T09:00:00Z',
  };

  const fabricatedBlend: Blend = {
    slug: 'persian-sunrise',
    name: 'Persian Sunrise',
    status: 'draft',
    launchTier: 'real',
    tagCode: 'ps',
    version: 1,
    updatedAt: '2026-08-27T09:00:00Z',
    tagline: 'Saffron, cardamom, rose petals and lime from Isfahan',
    originCountry: 'IR',
    originRegion: 'Isfahan',
    originCity: null,
    farm: { latitude: 32.6539, longitude: 51.666, label: 'Zayandeh Terraces' },
    storyBlocks: [
      { type: 'heading', text: 'Above the river' },
      { type: 'paragraph', text: 'A story about a supply chain that nobody at Trevean has told anyone.' },
    ],
    freshness: { harvestedOn: '2026-05-01', blendedOn: '2026-06-01', bestBefore: '2027-06-01', lotLabel: 'L1' },
    growerId: fabricatedGrower.growerId,
    shopify: { sku: 'TRV-PS-60G', productId: 'p', variantId: 'v', cartPermalinkUrl: 'https://shop/x' },
    heroImage: { mediaId: 'med_01J9Z8XK4M2Q7T5V3N8R1B6C0D', cdnUrl: 'https://cdn/x', alt: 'a', width: 1, height: 1 },
  };

  /** A content directory whose field specification has the shape given, written to disk. */
  function contentDirWith(spec: unknown): string {
    const dir = mkdtempSync(join(tmpdir(), 'trevean-guard-off-'));
    mkdirSync(join(dir, 'spec'), { recursive: true });
    writeFileSync(
      join(dir, 'spec', 'content-field-spec.json'),
      typeof spec === 'string' ? spec : JSON.stringify(spec),
      'utf8',
    );
    return dir;
  }

  function emptyDir(): string {
    return mkdtempSync(join(tmpdir(), 'trevean-guard-off-'));
  }

  const hostile: Array<{ label: string; dir: string }> = [
    { label: 'a directory that does not exist', dir: join(emptyDir(), 'no-such-content-package') },
    { label: 'a directory with no spec folder in it', dir: emptyDir() },
    { label: 'a specification that is not JSON at all', dir: contentDirWith('not json') },
    { label: 'a specification that is an empty object', dir: contentDirWith({}) },
    {
      label: 'a specification with no entities key',
      dir: contentDirWith({ conventionVersion: 1, sentinel: '[PLACEHOLDER]' }),
    },
    {
      label: 'a specification whose entities object is empty',
      dir: contentDirWith({ conventionVersion: 1, entities: {} }),
    },
    {
      label: 'a specification whose entities are present but declare no fields',
      dir: contentDirWith({
        conventionVersion: 1,
        sentinel: '[PLACEHOLDER]',
        entities: {
          blend: { label: 'Blend', fields: [] },
          grower: { label: 'Grower', fields: [] },
          recipe: { label: 'Recipe', fields: [] },
        },
      }),
    },
  ];

  it('and the fixture it is checked with carries nothing the sentinel scan could catch', () => {
    // Without this the refusals below would prove nothing about the field specification.
    expect(scanForSentinels({ blend: fabricatedBlend, grower: fabricatedGrower })).toEqual([]);
  });

  it('reads the content package from CONTENT_DIR, which is what makes this a configuration question', () => {
    const dir = emptyDir();
    const saved = process.env['CONTENT_DIR'];
    try {
      process.env['CONTENT_DIR'] = dir;
      expect(loadConfig().contentDir).toBe(dir);
    } finally {
      if (saved === undefined) delete process.env['CONTENT_DIR'];
      else process.env['CONTENT_DIR'] = saved;
    }
  });

  it('can still say yes, so the refusals below are not the loader failing on everything', () => {
    const real = loadReadiness(REAL_CONTENT_DIR);
    expect(real.available).toBe(true);
    expect(real.fields.blend.length).toBeGreaterThan(20);
  });

  for (const { label, dir } of hostile) {
    it(`refuses a fabricated grower when CONTENT_DIR points at ${label}`, () => {
      const assessment = reportForBlend(fabricatedBlend, fabricatedGrower, [], loadReadiness(dir));

      // The report itself must not have quietly certified the page as clean.
      expect(assessment.safeToPublish).toBe(false);
      expect(assessment.blockingCount).toBeGreaterThan(0);

      // And the guard must refuse, with no override supplied.
      const decision = evaluate(assessment, undefined);
      expect(decision.allowed).toBe(false);
      if (!decision.allowed) expect(decision.blockingFields.length).toBeGreaterThan(0);
    });
  }

  /**
   * The environment names are read out of `src/config.ts` rather than typed here, so a
   * variable added to the configuration later is swept without anybody remembering to add it.
   * The assertion is still behavioural: the sweep only decides what to set.
   */
  function configuredEnvNames(): string[] {
    const source = readFileSync(new URL('../../src/config.ts', import.meta.url), 'utf8');
    const names = new Set<string>();
    // `env,` is optional in this pattern because the helpers gained an explicit environment
    // parameter on Tuesday 8 September 2026. Without it this scan silently matched two names
    // instead of eighteen, and the count assertion below is the only reason that was noticed
    // rather than quietly reducing this test to a no op.
    for (const m of source.matchAll(/\b(?:str|int|bool)\(\s*(?:env,\s*)?'([A-Z][A-Z0-9_]*)'/g)) {
      names.add(m[1] as string);
    }
    for (const m of source.matchAll(/\benv\.([A-Z][A-Z0-9_]*)/g)) names.add(m[1] as string);
    return [...names];
  }

  it('is not switched off by any environment variable the configuration reads', () => {
    const names = configuredEnvNames();
    // If the scan above ever stops matching, this test would sweep nothing and pass.
    expect(names.length).toBeGreaterThanOrEqual(15);
    expect(names).toContain('CONTENT_DIR');
    expect(names).toContain('SESSION_SECRET');

    const saved = new Map(names.map((n) => [n, process.env[n]]));
    try {
      for (const name of names) {
        // STAGE is left alone on purpose: an unrecognised stage refuses to start, which is a
        // separate guarantee with its own tests, and setting it here would only test that.
        if (name === 'STAGE') continue;
        process.env[name] = 'false';
      }

      const config = loadConfig();
      expect(config.publish.overridePhrase).toBe(PHRASE);

      // The decision does not move, in either direction, under that environment.
      expect(evaluate(report(false), undefined).allowed).toBe(false);
      expect(evaluate(report(false), { phrase: 'false', reason: REASON, acknowledged: true }).allowed).toBe(false);
      expect(evaluate(report(false), { phrase: PHRASE, reason: REASON, acknowledged: true }).allowed).toBe(true);
      expect(evaluate(report(true), undefined)).toEqual({ allowed: true, overridden: false });
    } finally {
      for (const [name, value] of saved) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });
});
