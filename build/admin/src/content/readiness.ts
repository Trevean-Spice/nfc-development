import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../config.js';

/**
 * The content package, read only.
 *
 * `build/content` owns the placeholder convention, the content field specification and the
 * per field readiness state for every blend. The admin reads all three and writes none of
 * them. Restating any of it here would create a second source of truth for which fields
 * Trevean has actually supplied, and the failure mode of two sources of truth in this
 * product is the page showing the wrong story.
 *
 * If the package is not present, the admin does not quietly carry on. Every field the
 * specification marks as supplied by Trevean and required to publish becomes `unverified`,
 * which blocks publish exactly as a known placeholder does. Failing towards "this is not
 * real" costs an unnecessary refusal. Failing the other way ships a fabricated grower.
 */

export type FieldState =
  | 'client_real'
  | 'contractor_real'
  | 'placeholder_text'
  | 'placeholder_null'
  | 'placeholder_media'
  | 'not_applicable'
  | 'unverified';

export function isPlaceholderState(state: FieldState): boolean {
  return state === 'placeholder_text' || state === 'placeholder_null' || state === 'placeholder_media' || state === 'unverified';
}

export interface FieldSpec {
  path: string;
  label: string;
  owner: string;
  type?: string;
  requiredForPublish: boolean;
  guidance?: string;
  maxLength?: number;
  targetMin?: number;
  targetMax?: number;
}

export type EntityName = 'blend' | 'grower' | 'recipe';

export interface ReadinessSource {
  available: boolean;
  /** Why it is not available, shown on screen rather than kept in a log. */
  unavailableReason: string | null;
  sentinel: string;
  secondaryMarker: string;
  conventionVersion: number;
  asOf: string;
  contentDueFromClient: string;
  fields: Record<EntityName, FieldSpec[]>;
  /** blend slug to field path to state. */
  blendStates: Map<string, Record<string, FieldState>>;
  growerStates: Map<string, Record<string, FieldState>>;
  /** Merged across every recipe fixture for that blend, placeholder winning. */
  recipeStates: Map<string, Record<string, FieldState>>;
}

const FALLBACK_FIELDS: Record<EntityName, FieldSpec[]> = { blend: [], grower: [], recipe: [] };

function emptySource(reason: string): ReadinessSource {
  return {
    available: false,
    unavailableReason: reason,
    sentinel: '[PLACEHOLDER]',
    secondaryMarker: 'NOT REAL CONTENT',
    conventionVersion: 0,
    asOf: 'unknown',
    contentDueFromClient: 'unknown',
    fields: FALLBACK_FIELDS,
    blendStates: new Map(),
    growerStates: new Map(),
    recipeStates: new Map(),
  };
}

function readJson<T>(path: string): T | undefined {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return undefined;
  }
}

function mergeStates(
  into: Record<string, FieldState>,
  from: Record<string, FieldState> | undefined,
): Record<string, FieldState> {
  for (const [path, state] of Object.entries(from ?? {})) {
    const existing = into[path];
    // Placeholder wins over real. A blend with six real recipes and one placeholder recipe
    // still has a placeholder recipe on the page.
    if (!existing || (!isPlaceholderState(existing) && isPlaceholderState(state))) into[path] = state;
  }
  return into;
}

export function loadReadiness(contentDir: string = config.contentDir): ReadinessSource {
  const specPath = join(contentDir, 'spec', 'content-field-spec.json');
  if (!existsSync(specPath)) {
    return emptySource(
      `The content package was not found at ${contentDir}. Every field Trevean owns is treated as unverified until it is.`,
    );
  }

  interface SpecDocument {
    conventionVersion: number;
    sentinel: string;
    secondaryMarker: string;
    asOf: string;
    contentDueFromClient: string;
    entities: Record<string, { label: string; fields: FieldSpec[] }>;
  }

  const spec = readJson<SpecDocument>(specPath);
  if (!spec?.entities) {
    return emptySource(`The content field specification at ${specPath} could not be parsed.`);
  }

  const entityFields: Record<EntityName, FieldSpec[]> = {
    blend: spec.entities['blend']?.fields ?? [],
    grower: spec.entities['grower']?.fields ?? [],
    recipe: spec.entities['recipe']?.fields ?? [],
  };

  /**
   * A specification that parses but describes no fields is not a specification. It is the
   * same condition as a missing package wearing a valid file name, and it has to be treated
   * the same way, because the placeholder report is a loop over these fields: with none of
   * them the loop finds nothing, nothing blocks, and a fabricated grower publishes clean
   * with no override, no reason and no audit entry saying an override happened.
   *
   * That is the exact failure the package exists to prevent, so it fails towards "this is
   * not real" like every other unreadable case. Being wrong this way costs a refusal that a
   * person can override in one screen.
   */
  const declaredFields = entityFields.blend.length + entityFields.grower.length + entityFields.recipe.length;
  if (declaredFields === 0) {
    return emptySource(
      `The content field specification at ${specPath} declares no fields for blend, grower or recipe, so nothing on a page can be confirmed as real content supplied by Trevean.`,
    );
  }

  const source: ReadinessSource = {
    available: true,
    unavailableReason: null,
    sentinel: spec.sentinel ?? '[PLACEHOLDER]',
    secondaryMarker: spec.secondaryMarker ?? 'NOT REAL CONTENT',
    conventionVersion: spec.conventionVersion ?? 0,
    asOf: spec.asOf ?? 'unknown',
    contentDueFromClient: spec.contentDueFromClient ?? 'unknown',
    fields: entityFields,
    blendStates: new Map(),
    growerStates: new Map(),
    recipeStates: new Map(),
  };

  const fixtures = join(contentDir, 'fixtures');

  const readDirSafe = (dir: string): string[] => {
    try {
      return readdirSync(dir).filter((f) => f.endsWith('.json'));
    } catch {
      return [];
    }
  };

  for (const file of readDirSafe(join(fixtures, 'blends'))) {
    const doc = readJson<{ _placeholder?: { fields?: Record<string, FieldState> }; blend?: { slug?: string } }>(
      join(fixtures, 'blends', file),
    );
    const slug = doc?.blend?.slug ?? file.replace(/\.json$/, '');
    if (doc?._placeholder?.fields) source.blendStates.set(slug, { ...doc._placeholder.fields });
  }

  for (const file of readDirSafe(join(fixtures, 'growers'))) {
    const doc = readJson<{ _placeholder?: { fields?: Record<string, FieldState> } }>(join(fixtures, 'growers', file));
    const slug = file.replace(/\.json$/, '');
    if (doc?._placeholder?.fields) source.growerStates.set(slug, { ...doc._placeholder.fields });
  }

  for (const file of readDirSafe(join(fixtures, 'recipes'))) {
    const doc = readJson<{ recipes?: Array<{ _placeholder?: { fields?: Record<string, FieldState> } }> }>(
      join(fixtures, 'recipes', file),
    );
    const slug = file.replace(/\.json$/, '');
    const merged: Record<string, FieldState> = {};
    for (const entry of doc?.recipes ?? []) mergeStates(merged, entry._placeholder?.fields);
    if (Object.keys(merged).length > 0) source.recipeStates.set(slug, merged);
  }

  return source;
}

let cached: ReadinessSource | undefined;

export function readiness(): ReadinessSource {
  if (!cached) cached = loadReadiness();
  return cached;
}

/** Test seam, and the reload control on the content readiness screen. */
export function setReadiness(value: ReadinessSource | undefined): void {
  cached = value;
}
