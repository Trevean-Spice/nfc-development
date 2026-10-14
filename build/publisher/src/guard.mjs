/*
 * The placeholder guard, at the last point where it can still be enforced.
 *
 * There are two guards on this path and they are not the same guard. Both have to hold.
 *
 *   1. THE EDITORIAL GUARD, build/admin, src/publish/guard.ts. It decides whether a person
 *      may press publish on a blend that still carries invented looking content. It has a
 *      deliberate override, because refusing outright would mean the seeded blends could
 *      never be put live for a demo and somebody would work around the tool instead. The
 *      override costs a typed phrase, a written reason, an acknowledgement, and an audit
 *      entry with a name on it, and it applies to one publish and nothing else.
 *
 *   2. THIS ONE, THE DEPLOYMENT GUARD. It decides whether rendered bytes carrying the
 *      sentinel may be written to a customer facing origin. IT HAS NO OVERRIDE AT ALL. Not
 *      an environment variable, not a flag on the job, not a field in the request body.
 *
 * Why the second one has no override, stated plainly so it is not softened later by somebody
 * who reads the first one and assumes symmetry. The editorial override is a decision about
 * a record in a database, taken by a named person who can undo it. Publishing to production
 * is a decision about the page that 1,000 encoded jars in customers' kitchens resolve to,
 * and a fabricated grower profile, with a name, a farm, a portrait and a coordinate on a
 * map, is indistinguishable from a genuine one to everyone who sees it. Two independent
 * gates with different rules is the point; a second gate that inherits the first one's
 * override is not a second gate.
 *
 * NOTHING IN THIS FILE WEAKENS THE FIRST GUARD. It never reads the override, never records
 * one, and never lets one through. It is additive.
 *
 * The detection is the content package's own convention: the sentinel and the secondary
 * marker, read from build/content rather than retyped here, so there is one source of truth
 * for what "not real" means. If the package cannot be read, the markers fall back to their
 * documented literals and the guard says so, because failing towards "this is not real"
 * costs a refusal and failing the other way ships a fabricated grower.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const FALLBACK_SENTINEL = '[PLACEHOLDER]';
const FALLBACK_SECONDARY = 'NOT REAL CONTENT';

export function markersFrom(contentDir) {
  const specPath = join(contentDir, 'spec', 'content-field-spec.json');
  if (!existsSync(specPath)) {
    return {
      sentinel: FALLBACK_SENTINEL,
      secondaryMarker: FALLBACK_SECONDARY,
      source: `fallback literals, because the content package was not found at ${contentDir}`,
    };
  }
  try {
    const spec = JSON.parse(readFileSync(specPath, 'utf8'));
    return {
      sentinel: spec.sentinel ?? FALLBACK_SENTINEL,
      secondaryMarker: spec.secondaryMarker ?? FALLBACK_SECONDARY,
      source: specPath,
    };
  } catch {
    return {
      sentinel: FALLBACK_SENTINEL,
      secondaryMarker: FALLBACK_SECONDARY,
      source: `fallback literals, because ${specPath} could not be parsed`,
    };
  }
}

/**
 * @param {Array<{key: string, body: Buffer, contentType: string}>} objects
 * @param {{sentinel: string, secondaryMarker: string}} markers
 */
export function findPlaceholderObjects(objects, markers) {
  const found = [];
  for (const object of objects) {
    if (!object.contentType.startsWith('text/') && !object.contentType.startsWith('application/xml')) continue;
    const text = object.body.toString('utf8');
    const hits = [];
    if (text.includes(markers.sentinel)) hits.push(markers.sentinel);
    if (text.includes(markers.secondaryMarker)) hits.push(markers.secondaryMarker);
    if (hits.length > 0) found.push({ key: object.key, markers: hits });
  }
  return found;
}

export class PlaceholderRefusal extends Error {
  constructor(message, placeholderObjects) {
    super(message);
    this.name = 'PlaceholderRefusal';
    this.placeholderObjects = placeholderObjects;
  }
}

/**
 * @returns {{placeholderObjects: Array, refused: false, note: string|null}}
 * @throws {PlaceholderRefusal} when the stage is production and any object carries a marker.
 */
export function enforce({ stage, objects, contentDir }) {
  const markers = markersFrom(contentDir);
  const placeholderObjects = findPlaceholderObjects(objects, markers);

  if (placeholderObjects.length === 0) return { placeholderObjects: [], refused: false, note: null };

  if (stage === 'production') {
    const list = placeholderObjects.map((o) => `${o.key} (${o.markers.join(', ')})`).join('; ');
    throw new PlaceholderRefusal(
      `Refused. ${placeholderObjects.length} of the ${objects.length} objects in this publish still ` +
        `carry placeholder content and the target stage is production: ${list}. ` +
        'This guard has no override. Real content for the affected blends is the only way past it. ' +
        `Markers read from ${markers.source}.`,
      placeholderObjects,
    );
  }

  return {
    placeholderObjects,
    refused: false,
    note:
      `${placeholderObjects.length} of the ${objects.length} objects in this publish carry placeholder ` +
      `content and will show the hazard banner. The stage is '${stage}', so this is allowed and recorded. ` +
      'It would be refused outright on production and there is no override that changes that.',
  };
}
