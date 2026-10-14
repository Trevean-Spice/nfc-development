// JSON Schema validation against the schemas in the OpenAPI document itself.
//
// OpenAPI 3.1 schema objects are JSON Schema 2020-12, so they are compiled directly
// rather than converted. No schema is duplicated in this suite. A response is checked
// against the same bytes the two engineers read.

import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { SPEC_ID, specForValidation, type JsonObject } from './spec.js';

type ValidateFn = ((data: unknown) => boolean) & { errors?: unknown[] | null };

const AjvCtor = (Ajv2020 as any).default ?? Ajv2020;
const addFormatsFn = (addFormats as any).default ?? addFormats;

const ajv = new AjvCtor({
  strict: false,
  allErrors: true,
  validateSchema: false,
  allowUnionTypes: true,
  // The suite must never mutate the payload it is checking.
  useDefaults: false,
  coerceTypes: false,
});

addFormatsFn(ajv);

// Register the whole document so that every rewritten reference resolves.
ajv.addSchema(specForValidation, SPEC_ID);

const cache = new WeakMap<object, ValidateFn>();

function compile(schema: JsonObject): ValidateFn {
  const cached = cache.get(schema);
  if (cached) return cached;
  const validate = ajv.compile(schema) as ValidateFn;
  cache.set(schema, validate);
  return validate;
}

export interface SchemaProblem {
  instancePath: string;
  message: string;
}

export function validate(schema: JsonObject, data: unknown): SchemaProblem[] {
  const validateFn = compile(schema);
  const ok = validateFn(data);
  if (ok) return [];
  return (validateFn.errors ?? []).map((error: any) => ({
    instancePath: error.instancePath === '' ? '(root)' : error.instancePath,
    message: [error.message, error.params ? JSON.stringify(error.params) : null]
      .filter(Boolean)
      .join(' '),
  }));
}

export function formatProblems(problems: SchemaProblem[]): string {
  return problems.map((problem) => `  ${problem.instancePath}: ${problem.message}`).join('\n');
}

/** Throws with a readable report when the data does not satisfy the schema. */
export function assertValid(schema: JsonObject, data: unknown, context: string): void {
  const problems = validate(schema, data);
  if (problems.length > 0) {
    const preview = JSON.stringify(data, null, 2);
    const trimmed = preview.length > 2000 ? `${preview.slice(0, 2000)}\n  ... truncated` : preview;
    throw new Error(
      `${context} does not satisfy the schema in the OpenAPI document.\n` +
        `${formatProblems(problems)}\n` +
        `Payload:\n${trimmed}`,
    );
  }
}

/** True when the data satisfies the schema. Used by negative tests. */
export function isValid(schema: JsonObject, data: unknown): boolean {
  return validate(schema, data).length === 0;
}
