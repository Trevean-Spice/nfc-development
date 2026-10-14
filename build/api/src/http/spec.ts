import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

/**
 * The frozen OpenAPI 3.1 document is loaded at startup and is the source of truth for
 * request validation, for the list of real blend slugs and for the real tag codes.
 *
 * This is deliberate. The contract is frozen for M2 to M5 and two engineers build against
 * it, so validation that is written out by hand in TypeScript can drift from the document
 * silently. Validation compiled from the document cannot.
 */

const here = dirname(fileURLToPath(import.meta.url));

export const SPEC_PATH = resolve(here, '../../openapi/openapi.yaml');

export interface OpenApiDocument {
  openapi: string;
  info: { title: string; version: string };
  paths: Record<string, Record<string, unknown>>;
  components: { schemas: Record<string, any> };
}

let cached: OpenApiDocument | undefined;

export function spec(): OpenApiDocument {
  if (!cached) {
    cached = parse(readFileSync(SPEC_PATH, 'utf8')) as OpenApiDocument;
  }
  return cached;
}

/** The five real blend slugs, read from the Slug schema rather than retyped. */
export function knownSlugs(): string[] {
  return spec().components.schemas.Slug.enum as string[];
}

/** The real tag codes, read from the TagCode schema. Null is a legitimate value. */
export function knownTagCodes(): Array<string | null> {
  return spec().components.schemas.TagCode.enum as Array<string | null>;
}

export function isKnownSlug(value: unknown): value is string {
  return typeof value === 'string' && knownSlugs().includes(value);
}

/** The API major version, taken from the contract's own path prefix. */
export const API_PREFIX = '/v1';
