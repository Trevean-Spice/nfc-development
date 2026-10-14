import ajv2020Module from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
import type { ErrorObject, ValidateFunction } from 'ajv';
import { badRequest, type ErrorDetail } from './errors.js';
import { spec } from './spec.js';

/**
 * Ajv and ajv-formats are CommonJS. This package is ESM, so the default export has to be
 * unwrapped explicitly rather than relying on interop that differs between the type
 * checker and the runtime.
 */
interface AjvInstance {
  addSchema(schema: object, key: string): unknown;
  getSchema(key: string): ValidateFunction | undefined;
}
type AjvConstructor = new (options?: Record<string, unknown>) => AjvInstance;

const Ajv2020 = ((ajv2020Module as unknown as { default?: unknown }).default ?? ajv2020Module) as AjvConstructor;
const addFormats = ((addFormatsModule as unknown as { default?: unknown }).default ?? addFormatsModule) as (
  ajv: unknown,
) => void;

/**
 * Request validation compiled directly from the frozen OpenAPI document.
 *
 * Every request body schema in the contract sets additionalProperties false, which is what
 * makes the scan beacon safe without a credential: it accepts no free text and no
 * identifiers of value, so an unknown property is a 400 rather than a silently stored
 * field. See the API contract, section 5.2.
 */

const SPEC_ID = 'openapi.json';

let ajv: AjvInstance | undefined;

function instance(): AjvInstance {
  if (ajv) return ajv;
  const a = new Ajv2020({
    strict: false,
    allErrors: true,
    validateSchema: false,
    allowUnionTypes: true,
    coerceTypes: false,
    useDefaults: false,
  });
  addFormats(a);
  a.addSchema(spec() as unknown as object, SPEC_ID);
  ajv = a;
  return a;
}

const compiled = new Map<string, ValidateFunction>();

/**
 * Resolves a validator by JSON pointer into the frozen document, for example
 * '#/components/schemas/ScanEventInput' or a pointer at an inline request body schema.
 */
export function validator(pointer: string): ValidateFunction {
  const key = pointer.startsWith('#') ? `${SPEC_ID}${pointer}` : pointer;
  const found = compiled.get(key);
  if (found) return found;
  const fn = instance().getSchema(key);
  if (!fn) throw new Error(`No schema at pointer '${pointer}' in the frozen OpenAPI document.`);
  compiled.set(key, fn);
  return fn;
}

/** Pointer helper for a request body schema declared inline under paths. */
export function bodyPointer(path: string, method: string): string {
  const escaped = path.replace(/~/g, '~0').replace(/\//g, '~1');
  return `#/paths/${escaped}/${method}/requestBody/content/application~1json/schema`;
}

const ISSUE_BY_KEYWORD: Record<string, string> = {
  enum: 'not_in_enum',
  const: 'not_in_enum',
  pattern: 'pattern_mismatch',
  required: 'required',
  additionalProperties: 'unknown_field',
  type: 'type_mismatch',
  format: 'invalid_format',
  maxLength: 'too_long',
  minLength: 'too_short',
  maximum: 'out_of_range',
  minimum: 'out_of_range',
  maxItems: 'too_many_items',
  minItems: 'too_few_items',
  anyOf: 'missing_required_group',
  oneOf: 'no_matching_variant',
};

function fieldOf(error: ErrorObject): string {
  if (error.keyword === 'required') {
    return [error.instancePath.replace(/^\//, '').replace(/\//g, '.'), (error.params as { missingProperty: string }).missingProperty]
      .filter(Boolean)
      .join('.');
  }
  if (error.keyword === 'additionalProperties') {
    return [error.instancePath.replace(/^\//, '').replace(/\//g, '.'), (error.params as { additionalProperty: string }).additionalProperty]
      .filter(Boolean)
      .join('.');
  }
  const path = error.instancePath.replace(/^\//, '').replace(/\//g, '.');
  return path === '' ? 'body' : path;
}

export function toDetails(errors: ErrorObject[] | null | undefined): ErrorDetail[] {
  if (!errors) return [];
  const seen = new Set<string>();
  const out: ErrorDetail[] = [];
  for (const e of errors) {
    const field = fieldOf(e);
    const issue = ISSUE_BY_KEYWORD[e.keyword] ?? e.keyword;
    const key = `${field}:${issue}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ field, issue });
    if (out.length >= 50) break;
  }
  return out;
}

/**
 * Validates a body against a pointer into the frozen document, throwing the contract's
 * 400 envelope on failure.
 */
export function validateBody<T>(pointer: string, body: unknown): T {
  const validate = validator(pointer);
  if (validate(body)) return body as T;
  const details = toDetails(validate.errors);
  const count = details.length;
  throw badRequest(`${count} field${count === 1 ? '' : 's'} failed validation.`, details);
}

/** True when the value satisfies the pointer. Used by tests to check responses conform. */
export function matchesSchema(pointer: string, value: unknown): { valid: boolean; errors: ErrorDetail[] } {
  const validate = validator(pointer);
  const valid = validate(value) as boolean;
  return { valid, errors: valid ? [] : toDetails(validate.errors) };
}

/**
 * The `include` query parameter, however the query parser happened to hand it over.
 *
 * The frozen contract, section 4, describes it as one comma separated parameter:
 * `?include=grower,recipes`. What actually arrives depends on the parser in front of the
 * handler. A single string is one reading; an array of values is another, and the deployed
 * environment produces the array while the local development server produced the string.
 * Both are the same request and both are valid under the contract.
 *
 * This existed as `(request.query.include ?? '').split(',')` in two route files, which is
 * correct for the string and a TypeError for the array. It reached production and took down
 * every `GET /v1/blends/{slug}?include=...` with a 500, which is the exact request the
 * renderer makes for every blend on every publish, so the first publish on real
 * infrastructure failed on it. The local dev server never produced an array, which is why no
 * test caught it. Found Monday 7 September 2026.
 *
 * Splitting on commas inside array members too, because `['grower,recipes']` is a third
 * reading that costs nothing to accept and would otherwise be a fourth outage.
 */
export function parseInclude(raw: unknown): string[] {
  const members = Array.isArray(raw) ? raw : [raw ?? ''];
  return members
    .flatMap((member) => String(member).split(','))
    .map((part) => part.trim())
    .filter(Boolean);
}
