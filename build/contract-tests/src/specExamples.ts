// Validates the worked examples in the OpenAPI document against the schemas beside them.
//
// The examples are not decoration. They are what an engineer copies when writing a client,
// what a reviewer reads instead of the schema, and what a mock server is seeded from. An
// example that violates its own schema produces an implementation that violates the
// contract, and it does it by way of the most trusted part of the document.

import { specForValidation, type JsonObject } from './spec.js';
import { validate } from './validator.js';

export interface ExampleProblem {
  location: string;
  name: string;
  problems: string[];
}

function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function looksLikeSchema(node: JsonObject): boolean {
  return (
    node.type !== undefined ||
    node.$ref !== undefined ||
    node.enum !== undefined ||
    node.allOf !== undefined ||
    node.oneOf !== undefined ||
    node.anyOf !== undefined ||
    node.properties !== undefined ||
    node.items !== undefined
  );
}

/**
 * Walks the whole document.
 *
 * A media type object carries examples as a map of named objects with a value member.
 * A schema object carries examples as a plain array of instances, per JSON Schema 2020-12.
 * The two are told apart by that difference in shape.
 */
export function findExampleProblems(): ExampleProblem[] {
  const found: ExampleProblem[] = [];

  function walk(node: unknown, pointer: string): void {
    if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, `${pointer}/${index}`));
      return;
    }
    if (!isPlainObject(node)) return;

    if (isPlainObject(node.examples) && isPlainObject(node.schema)) {
      for (const [name, entry] of Object.entries(node.examples)) {
        if (!isPlainObject(entry) || !Object.hasOwn(entry, 'value')) continue;
        const problems = validate(node.schema as JsonObject, entry.value);
        if (problems.length > 0) {
          found.push({
            location: pointer,
            name,
            problems: problems.map((problem) => `${problem.instancePath}: ${problem.message}`),
          });
        }
      }
    }

    if (Array.isArray(node.examples) && looksLikeSchema(node)) {
      const { examples, ...schemaWithoutExamples } = node;
      examples.forEach((instance, index) => {
        const problems = validate(schemaWithoutExamples as JsonObject, instance);
        if (problems.length > 0) {
          found.push({
            location: pointer,
            name: `examples[${index}]`,
            problems: problems.map((problem) => `${problem.instancePath}: ${problem.message}`),
          });
        }
      });
    }

    for (const [key, value] of Object.entries(node)) {
      if (key === 'examples' || key === 'example') continue;
      walk(value, `${pointer}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`);
    }
  }

  walk(specForValidation, '#');
  return found;
}

export function formatExampleProblems(problems: ExampleProblem[]): string {
  return problems
    .map((problem) => `  ${problem.location} example ${problem.name}\n    ${problem.problems.join('\n    ')}`)
    .join('\n');
}
