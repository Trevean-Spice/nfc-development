// Loads the frozen OpenAPI 3.1 document and turns it into an operation inventory.
//
// Nothing in this suite hand transcribes the specification. Paths, methods, status
// codes, request schemas, response schemas, security requirements and the x-tap-path
// extension are all read from the document at run time. If the document changes and
// the implementation does not, the tests fail. That is the point.

import fs from 'node:fs';
import YAML from 'yaml';
import { config } from './config.js';

export type Json = unknown;
export type JsonObject = Record<string, any>;

export const SPEC_ID = 'trevean-openapi';

const raw = fs.readFileSync(config.specPath, 'utf8');

/** The document exactly as written, used for structural navigation. */
export const spec: JsonObject = YAML.parse(raw);

/**
 * A copy of the document in which every local $ref has been rewritten to an absolute
 * reference against SPEC_ID. Sub schemas lifted out of this copy stay resolvable when
 * compiled on their own.
 */
export const specForValidation: JsonObject = rewriteRefs(structuredClone(spec));

function rewriteRefs(node: any): any {
  if (Array.isArray(node)) return node.map(rewriteRefs);
  if (node && typeof node === 'object') {
    const out: JsonObject = {};
    for (const [key, value] of Object.entries(node)) {
      if (key === '$ref' && typeof value === 'string' && value.startsWith('#/')) {
        out[key] = `${SPEC_ID}${value}`;
      } else {
        out[key] = rewriteRefs(value);
      }
    }
    return out;
  }
  return node;
}

/** Follows a local JSON pointer such as #/components/responses/NotFound. */
export function deref<T = any>(node: any, doc: JsonObject = spec): T {
  let current = node;
  let guard = 0;
  while (current && typeof current === 'object' && typeof current.$ref === 'string') {
    if (guard++ > 32) throw new Error('Reference chain too deep in the OpenAPI document.');
    const ref: string = current.$ref;
    const pointer = ref.startsWith(`${SPEC_ID}#`) ? ref.slice(SPEC_ID.length) : ref;
    if (!pointer.startsWith('#/')) {
      throw new Error(`Only local references are supported, found ${ref}.`);
    }
    current = pointer
      .slice(2)
      .split('/')
      .map((segment) => segment.replace(/~1/g, '/').replace(/~0/g, '~'))
      .reduce((acc: any, segment: string) => {
        if (acc === undefined || acc === null) {
          throw new Error(`Unresolvable reference ${ref} in the OpenAPI document.`);
        }
        return acc[segment];
      }, doc);
  }
  return current as T;
}

export const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'patch', 'head', 'options', 'trace'] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

export interface ResponseContract {
  /** Three digit status as written in the document. */
  status: number;
  description: string;
  /** JSON Schema for the application/json body, with absolute refs, or null when no body is declared. */
  schema: JsonObject | null;
  /** Declared response header names. */
  headers: string[];
}

export interface OperationContract {
  operationId: string;
  method: HttpMethod;
  /** Path template exactly as written, for example /v1/blends/{slug}. */
  path: string;
  summary: string;
  tags: string[];
  /** True when the OpenAPI security requirement list contains a non empty scheme. */
  requiresAuth: boolean;
  securitySchemes: string[];
  /** The x-tap-path extension: false, true, or after-paint-optional. */
  tapPath: unknown;
  minimumRole: string | null;
  /** JSON Schema for the application/json request body, with absolute refs, or null. */
  requestSchema: JsonObject | null;
  requestBodyRequired: boolean;
  parameters: JsonObject[];
  responses: Map<number, ResponseContract>;
  declaredStatuses: number[];
  /** True when this operation changes server state. */
  isWrite: boolean;
}

function collectParameters(pathItem: JsonObject, operation: JsonObject): JsonObject[] {
  const shared = Array.isArray(pathItem.parameters) ? pathItem.parameters : [];
  const own = Array.isArray(operation.parameters) ? operation.parameters : [];
  return [...shared, ...own].map((parameter) => deref<JsonObject>(parameter));
}

function buildOperations(): Map<string, OperationContract> {
  const result = new Map<string, OperationContract>();
  const paths = spec.paths as JsonObject;
  const validationPaths = specForValidation.paths as JsonObject;

  for (const [pathTemplate, pathItemRaw] of Object.entries(paths)) {
    const pathItem = pathItemRaw as JsonObject;
    for (const method of HTTP_METHODS) {
      const operation = pathItem[method] as JsonObject | undefined;
      if (!operation) continue;

      const validationOperation = (validationPaths[pathTemplate] as JsonObject)[method] as JsonObject;

      const operationId: string = operation.operationId;
      if (!operationId) {
        throw new Error(`Operation ${method.toUpperCase()} ${pathTemplate} has no operationId.`);
      }

      const security = (operation.security ?? spec.security ?? []) as JsonObject[];
      const securitySchemes = security.flatMap((entry) => Object.keys(entry));
      const requiresAuth = securitySchemes.length > 0;

      const responses = new Map<number, ResponseContract>();
      for (const [statusKey, responseRaw] of Object.entries(operation.responses as JsonObject)) {
        const status = Number(statusKey);
        if (!Number.isInteger(status)) continue;
        const resolved = deref<JsonObject>(responseRaw);
        const validationResponse = deref<JsonObject>(
          (validationOperation.responses as JsonObject)[statusKey],
          specForValidation,
        );
        const schema = validationResponse?.content?.['application/json']?.schema ?? null;
        responses.set(status, {
          status,
          description: String(resolved.description ?? ''),
          schema: schema ? (schema as JsonObject) : null,
          headers: Object.keys(resolved.headers ?? {}),
        });
      }

      const requestBody = operation.requestBody ? deref<JsonObject>(operation.requestBody) : null;
      const validationRequestBody = validationOperation.requestBody
        ? deref<JsonObject>(validationOperation.requestBody, specForValidation)
        : null;

      result.set(operationId, {
        operationId,
        method,
        path: pathTemplate,
        summary: String(operation.summary ?? ''),
        tags: (operation.tags ?? []) as string[],
        requiresAuth,
        securitySchemes,
        tapPath: operation['x-tap-path'],
        minimumRole: (operation['x-minimum-role'] as string) ?? null,
        requestSchema: (validationRequestBody?.content?.['application/json']?.schema as JsonObject) ?? null,
        requestBodyRequired: Boolean(requestBody?.required),
        parameters: collectParameters(pathItem, operation),
        responses,
        declaredStatuses: [...responses.keys()].sort((a, b) => a - b),
        isWrite: method !== 'get' && method !== 'head' && method !== 'options',
      });
    }
  }
  return result;
}

export const operations: Map<string, OperationContract> = buildOperations();

export const operationList: OperationContract[] = [...operations.values()];

export function operation(operationId: string): OperationContract {
  const found = operations.get(operationId);
  if (!found) {
    throw new Error(
      `No operation with operationId ${operationId} in the OpenAPI document. ` +
        `Known operations: ${[...operations.keys()].join(', ')}.`,
    );
  }
  return found;
}

/** Every operation whose security requirement names a scheme, which is every admin operation. */
export const authenticatedOperations = operationList.filter((op) => op.requiresAuth);

/** Every authenticated operation that changes state. The set that must never accept an anonymous caller. */
export const authenticatedWriteOperations = authenticatedOperations.filter((op) => op.isWrite);

/** Every operation reachable with no credential at all. */
export const publicOperations = operationList.filter((op) => !op.requiresAuth);

/** The single operation the specification marks as being on the tap critical path. */
export const tapPathOperations = operationList.filter((op) => op.tapPath === true);

/** Named schema from components, with absolute references, ready to compile. */
export function componentSchema(name: string): JsonObject {
  const schema = (specForValidation.components as JsonObject).schemas[name];
  if (!schema) throw new Error(`No component schema named ${name} in the OpenAPI document.`);
  return schema as JsonObject;
}

/** Enum values declared on a component schema, for the fixtures that must not drift. */
export function componentEnum(name: string): unknown[] {
  const schema = (spec.components as JsonObject).schemas[name] as JsonObject;
  if (!schema || !Array.isArray(schema.enum)) {
    throw new Error(`Component schema ${name} does not declare an enum.`);
  }
  return schema.enum as unknown[];
}
