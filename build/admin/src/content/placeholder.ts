import type { Blend, Grower, Recipe } from '../api/types.js';
import {
  isPlaceholderState,
  readiness,
  type EntityName,
  type FieldSpec,
  type FieldState,
  type ReadinessSource,
} from './readiness.js';

/**
 * The placeholder detector.
 *
 * The failure this exists to prevent, stated once so nobody has to infer it from the code:
 *
 *   A fabricated grower profile, with a name, a farm, a portrait and a coordinate on a map,
 *   is indistinguishable from a genuine one to everyone who sees it. It survives a publish.
 *   It reaches a page that 1,000 encoded tags in customers' kitchens already point at. And
 *   it is a statement about a real supply chain that nobody at Trevean ever made.
 *
 * Five independent detectors run over every record and their results are combined with OR.
 * Any one of them firing marks the field as not real:
 *
 *   1. sentinel          the value carries [PLACEHOLDER] or NOT REAL CONTENT
 *   2. marker            the value says "placeholder" or "pending content delivery" in
 *                        some other wording, which the API's own seed data does
 *   3. fake_id           a media, grower or recipe id in the reserved FAKE range
 *   4. readiness         the content package records the field as placeholder_*
 *   5. missing_required  required to publish and null, empty or absent
 *
 * And one that fires when the content package cannot be read at all: `unverified`, which
 * blocks publish exactly as a known placeholder does.
 *
 * The direction of every judgement call here is the same. Being wrong towards "this is not
 * real" costs an unnecessary refusal that a person can override in one screen. Being wrong
 * the other way puts a fake grower in front of a customer.
 */

export type Detection = 'sentinel' | 'marker' | 'fake_id' | 'readiness' | 'missing_required' | 'unverified';

export interface Finding {
  entity: EntityName;
  /** Which record inside the blend, in the words shown on screen. */
  record: string;
  recordId: string;
  path: string;
  label: string;
  owner: string;
  state: FieldState;
  isPlaceholder: boolean;
  requiredForPublish: boolean;
  blocksPublish: boolean;
  detectedBy: Detection[];
  value: string;
  guidance: string;
}

export interface SentinelHit {
  path: string;
  excerpt: string;
}

export interface PlaceholderReport {
  slug: string;
  readinessAvailable: boolean;
  readinessNote: string | null;
  findings: Finding[];
  fieldsTotal: number;
  fieldsReal: number;
  placeholderCount: number;
  blockingCount: number;
  sentinelHits: SentinelHit[];
  /** True when nothing on this blend's page would be a claim nobody at Trevean made. */
  safeToPublish: boolean;
  headline: string;
}

const SENTINEL = '[PLACEHOLDER]';
const SECONDARY = 'NOT REAL CONTENT';
const MARKER_PATTERNS = [/placeholder/i, /pending content delivery/i, /not real content/i];
const FAKE_ID = /^(med|grw|rcp)_FAKE/;

/**
 * Contract field names differ from content specification field names in exactly three
 * places, because the contract returns a hydrated media reference where the specification
 * names the id that was written. Aliased rather than renamed, because the contract is
 * frozen and the specification is the client's vocabulary.
 */
const PATH_ALIASES: Record<string, string> = {
  heroImageId: 'heroImage.mediaId',
  portraitId: 'portrait.mediaId',
  imageId: 'image.mediaId',
  galleryImageIds: 'gallery',
};

function resolve(record: unknown, path: string): unknown {
  const actual = PATH_ALIASES[path] ?? path;
  let current: unknown = record;
  for (const part of actual.split('.')) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/** Every string inside a value, including strings nested in arrays and objects. */
function strings(value: unknown, into: string[] = []): string[] {
  if (typeof value === 'string') into.push(value);
  else if (Array.isArray(value)) for (const v of value) strings(v, into);
  else if (value && typeof value === 'object') for (const v of Object.values(value)) strings(v, into);
  return into;
}

function display(value: unknown): string {
  if (value === null || value === undefined) return 'not set';
  if (typeof value === 'string') return value.length > 160 ? `${value.slice(0, 157)}...` : value;
  if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? '' : 's'}`;
  if (typeof value === 'object') return 'set';
  return String(value);
}

function detectOnValue(value: unknown): Detection[] {
  const found: Detection[] = [];
  const all = strings(value);
  if (all.some((s) => s.includes(SENTINEL) || s.includes(SECONDARY))) found.push('sentinel');
  else if (all.some((s) => MARKER_PATTERNS.some((p) => p.test(s)))) found.push('marker');
  if (all.some((s) => FAKE_ID.test(s))) found.push('fake_id');
  return found;
}

function assess(
  entity: EntityName,
  record: unknown,
  recordLabel: string,
  recordId: string,
  spec: FieldSpec[],
  states: Record<string, FieldState> | undefined,
  source: ReadinessSource,
): Finding[] {
  const findings: Finding[] = [];

  for (const field of spec) {
    // storyBlocks[].text is covered by storyBlocks. Listing both would double count the
    // one thing an editor sees as one field.
    if (field.path.includes('[]')) continue;

    const value = resolve(record, field.path);
    const detectedBy: Detection[] = detectOnValue(value);

    const recorded = states?.[field.path];
    if (recorded && isPlaceholderState(recorded) && !detectedBy.includes('readiness')) {
      detectedBy.push('readiness');
    }

    if (isEmpty(value) && field.requiredForPublish) detectedBy.push('missing_required');

    if (!source.available && field.owner === 'Trevean' && field.requiredForPublish && detectedBy.length === 0) {
      detectedBy.push('unverified');
    }

    let state: FieldState;
    if (detectedBy.includes('unverified')) state = 'unverified';
    else if (detectedBy.includes('fake_id')) state = 'placeholder_media';
    else if (detectedBy.includes('sentinel') || detectedBy.includes('marker')) state = 'placeholder_text';
    else if (detectedBy.includes('missing_required')) state = 'placeholder_null';
    else if (recorded) state = recorded;
    else state = isEmpty(value) ? 'not_applicable' : 'client_real';

    const isPlaceholder = detectedBy.length > 0;
    findings.push({
      entity,
      record: recordLabel,
      recordId,
      path: field.path,
      label: field.label,
      owner: field.owner,
      state,
      isPlaceholder,
      requiredForPublish: field.requiredForPublish,
      blocksPublish: isPlaceholder && field.requiredForPublish,
      detectedBy,
      value: display(value),
      guidance: field.guidance ?? '',
    });
  }

  return findings;
}

/** The raw sentinel scan, reported separately so a stray marker is never explained away. */
export function scanForSentinels(value: unknown, prefix = ''): SentinelHit[] {
  const hits: SentinelHit[] = [];
  const walk = (node: unknown, path: string): void => {
    if (typeof node === 'string') {
      if (node.includes(SENTINEL) || node.includes(SECONDARY) || FAKE_ID.test(node)) {
        hits.push({ path: path || '(root)', excerpt: node.length > 120 ? `${node.slice(0, 117)}...` : node });
      }
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((item, i) => walk(item, `${path}[${i}]`));
      return;
    }
    if (node && typeof node === 'object') {
      for (const [key, item] of Object.entries(node)) walk(item, path ? `${path}.${key}` : key);
    }
  };
  walk(value, prefix);
  return hits;
}

export function reportForBlend(
  blend: Blend,
  grower: Grower | null | undefined,
  recipes: Recipe[] | undefined,
  source: ReadinessSource = readiness(),
): PlaceholderReport {
  const findings: Finding[] = [];

  findings.push(
    ...assess('blend', blend, blend.name, blend.slug, source.fields.blend, source.blendStates.get(blend.slug), source),
  );

  if (grower) {
    findings.push(
      ...assess(
        'grower',
        grower,
        'Grower profile',
        grower.growerId,
        source.fields.grower,
        source.growerStates.get(blend.slug),
        source,
      ),
    );
  } else {
    // No grower attached at all. The contract already blocks publish on this, and the
    // report says so in the editor's words rather than leaving them to read a 422.
    findings.push({
      entity: 'grower',
      record: 'Grower profile',
      recordId: '',
      path: 'growerId',
      label: 'Grower',
      owner: 'Trevean',
      state: 'placeholder_null',
      isPlaceholder: true,
      requiredForPublish: true,
      blocksPublish: true,
      detectedBy: ['missing_required'],
      value: 'not set',
      guidance: 'A published blend page carries a grower profile. The API refuses to publish without one.',
    });
  }

  const recipeStates = source.recipeStates.get(blend.slug);
  for (const recipe of recipes ?? []) {
    findings.push(
      ...assess(
        'recipe',
        recipe,
        `Recipe: ${recipe.title.replace(SENTINEL, '').trim().slice(0, 60)}`,
        recipe.recipeId,
        source.fields.recipe,
        recipeStates,
        source,
      ),
    );
  }

  if (!source.available) {
    // With no field specification there is nothing to check field by field, so the check
    // that remains is the honest one: nothing on this record can be confirmed as real. This
    // blocks publish, which is the correct direction to be wrong in.
    findings.unshift({
      entity: 'blend',
      record: blend.name,
      recordId: blend.slug,
      path: '(content package)',
      label: 'Content readiness could not be read',
      owner: 'Serene Labs',
      state: 'unverified',
      isPlaceholder: true,
      requiredForPublish: true,
      blocksPublish: true,
      detectedBy: ['unverified'],
      value: 'unknown',
      guidance:
        source.unavailableReason ??
        'The content package is not readable, so no field on this page can be confirmed as real content supplied by Trevean.',
    });
  }

  const placeholderCount = findings.filter((f) => f.isPlaceholder).length;
  const blockingCount = findings.filter((f) => f.blocksPublish).length;
  const sentinelHits = scanForSentinels({ blend, grower: grower ?? null, recipes: recipes ?? [] });

  const headline =
    blockingCount === 0 && sentinelHits.length === 0
      ? 'No placeholder content found on this blend.'
      : `${blockingCount} field${blockingCount === 1 ? '' : 's'} that must be real before this page goes live ${blockingCount === 1 ? 'is' : 'are'} still placeholder, out of ${placeholderCount} placeholder field${placeholderCount === 1 ? '' : 's'} in total.`;

  return {
    slug: blend.slug,
    readinessAvailable: source.available,
    readinessNote: source.unavailableReason,
    findings,
    fieldsTotal: findings.length,
    fieldsReal: findings.length - placeholderCount,
    placeholderCount,
    blockingCount,
    sentinelHits,
    safeToPublish: blockingCount === 0 && sentinelHits.length === 0,
    headline,
  };
}

/**
 * A cheap version for the blend list, which holds summaries rather than full records. It
 * answers "is there anything unreal here" and deliberately not "how much", because a list
 * that pretends to a precision it did not pay for is worse than one that links to the
 * screen that did.
 */
export function summaryHasPlaceholder(summary: unknown, slug: string, source: ReadinessSource = readiness()): boolean {
  if (scanForSentinels(summary).length > 0) return true;
  if (!source.available) return true;
  const states = source.blendStates.get(slug);
  if (!states) return true;
  return Object.values(states).some((s) => isPlaceholderState(s));
}
