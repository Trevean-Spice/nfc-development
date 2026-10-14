// The HTTP client every test uses.
//
// Every call made through callOperation is checked against the OpenAPI document before
// the test that made it asserts anything of its own:
//
//   1. the request body is validated against the declared request schema, so a fixture
//      cannot drift away from the contract without failing,
//   2. the observed status must be one the operation declares, because changing the
//      status code for an existing case is a v2 change under section 3 of the contract,
//   3. the response body is validated against the schema declared for that status,
//   4. X-Request-Id must be present, per section 8.1,
//   5. a status the document declares with no body must return no body.
//
// The result is that a test which merely calls an endpoint already enforces most of the
// contract for that endpoint.

import assert from 'node:assert/strict';
import { config } from './config.js';
import { record } from './coverage.js';
import { operation, type OperationContract } from './spec.js';
import { assertValid } from './validator.js';

export type Role = 'admin' | 'editor' | 'viewer';

export interface CallOptions {
  pathParams?: Record<string, string>;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  /** Bypasses JSON serialisation, for malformed body tests. */
  rawBody?: string;
  headers?: Record<string, string>;
  /** Uses the configured token for this role. */
  role?: Role;
  /** Uses this exact bearer token. Overrides role. */
  token?: string;
  /** Sends no Authorization header even on an authenticated operation. */
  anonymous?: boolean;
  expectStatus?: number | number[];
  /** Set false to send a body the request schema rejects. */
  validateRequestBody?: boolean;
  /** Set true when deliberately probing for an undeclared status. */
  allowUndeclaredStatus?: boolean;
}

export interface ContractResult {
  operationId: string;
  method: string;
  url: string;
  status: number;
  headers: Headers;
  bodyText: string;
  body: any;
  durationMs: number;
}

export class ContractViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContractViolation';
  }
}

export function tokenFor(role: Role): string | undefined {
  return config.tokens[role];
}

export function buildPath(op: OperationContract, pathParams: Record<string, string> = {}): string {
  return op.path.replace(/\{([^}]+)\}/g, (_match, name: string) => {
    const value = pathParams[name];
    if (value === undefined) {
      throw new Error(`Path parameter ${name} was not supplied for ${op.operationId}.`);
    }
    return encodeURIComponent(value);
  });
}

export function buildUrl(op: OperationContract, options: CallOptions = {}): string {
  const url = new URL(config.baseUrl + buildPath(op, options.pathParams));
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value === undefined) continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

function parseMediaType(contentType: string | null): string | null {
  if (!contentType) return null;
  return contentType.split(';')[0]!.trim().toLowerCase();
}

function charsetOf(contentType: string | null): string | null {
  if (!contentType) return null;
  const match = /charset\s*=\s*"?([^;"]+)"?/i.exec(contentType);
  return match ? match[1]!.trim().toLowerCase() : null;
}

/** A raw request against an arbitrary path, used for the beacon transport checks. */
export async function rawRequest(
  method: string,
  pathAndQuery: string,
  init: { headers?: Record<string, string>; body?: string | Uint8Array } = {},
): Promise<ContractResult> {
  const url = config.baseUrl + pathAndQuery;
  const started = performance.now();
  const response = await fetch(url, {
    method,
    headers: init.headers ?? {},
    body: init.body as any,
    redirect: 'manual',
    signal: AbortSignal.timeout(config.timeoutMs),
  });
  const bodyText = await response.text();
  const durationMs = performance.now() - started;
  let body: any = undefined;
  if (bodyText.length > 0 && parseMediaType(response.headers.get('content-type')) === 'application/json') {
    try {
      body = JSON.parse(bodyText);
    } catch {
      body = undefined;
    }
  }
  return {
    operationId: `raw ${method} ${pathAndQuery}`,
    method,
    url,
    status: response.status,
    headers: response.headers,
    bodyText,
    body,
    durationMs,
  };
}

export async function callOperation(
  operationId: string,
  options: CallOptions = {},
): Promise<ContractResult> {
  const op = operation(operationId);
  const url = buildUrl(op, options);

  const headers: Record<string, string> = { accept: 'application/json', ...(options.headers ?? {}) };

  if (!options.anonymous) {
    const token = options.token ?? (options.role ? tokenFor(options.role) : undefined);
    if (token) headers.authorization = `Bearer ${token}`;
  }

  let bodyToSend: string | undefined;
  if (options.rawBody !== undefined) {
    bodyToSend = options.rawBody;
    if (!Object.keys(headers).some((key) => key.toLowerCase() === 'content-type')) {
      headers['content-type'] = 'application/json';
    }
  } else if (options.body !== undefined) {
    if (op.requestSchema && options.validateRequestBody !== false) {
      assertValid(
        op.requestSchema,
        options.body,
        `Request body for ${op.method.toUpperCase()} ${op.path} (${operationId})`,
      );
    }
    bodyToSend = JSON.stringify(options.body);
    if (!Object.keys(headers).some((key) => key.toLowerCase() === 'content-type')) {
      headers['content-type'] = 'application/json';
    }
  }

  const started = performance.now();
  const response = await fetch(url, {
    method: op.method.toUpperCase(),
    headers,
    body: bodyToSend,
    redirect: 'manual',
    signal: AbortSignal.timeout(config.timeoutMs),
  });
  const bodyText = await response.text();
  const durationMs = performance.now() - started;

  record(operationId, response.status);

  const result: ContractResult = {
    operationId,
    method: op.method.toUpperCase(),
    url,
    status: response.status,
    headers: response.headers,
    bodyText,
    body: undefined,
    durationMs,
  };

  const where = `${result.method} ${op.path} (${operationId}) returned ${response.status}`;

  if (options.expectStatus !== undefined) {
    const expected = Array.isArray(options.expectStatus) ? options.expectStatus : [options.expectStatus];
    assert.ok(
      expected.includes(response.status),
      `${where}, expected one of [${expected.join(', ')}]. Body: ${bodyText.slice(0, 600)}`,
    );
  }

  if (!options.allowUndeclaredStatus && !op.declaredStatuses.includes(response.status)) {
    throw new ContractViolation(
      `${where}, which the OpenAPI document does not declare for this operation. ` +
        `Declared statuses are [${op.declaredStatuses.join(', ')}]. ` +
        `Changing the status code for an existing case is a v2 change under section 3 of the ` +
        `frozen API contract. Body: ${bodyText.slice(0, 600)}`,
    );
  }

  // Section 8.1: every response carries X-Request-Id.
  assert.ok(
    response.headers.get('x-request-id'),
    `${where} without an X-Request-Id header. Section 8.1 of the frozen API contract requires ` +
      `one on every response, matching error.requestId and the structured log line.`,
  );

  const contract = op.responses.get(response.status);
  const mediaType = parseMediaType(response.headers.get('content-type'));

  if (contract?.schema) {
    assert.equal(
      mediaType,
      'application/json',
      `${where} with Content-Type ${response.headers.get('content-type')}. ` +
        `The document declares an application/json body for this status.`,
    );
    const charset = charsetOf(response.headers.get('content-type'));
    if (charset !== null) {
      assert.equal(charset, 'utf-8', `${where} with a charset other than utf-8. Section 8.1 requires utf-8.`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(bodyText);
    } catch (error) {
      throw new ContractViolation(
        `${where} with a body that is not valid JSON: ${(error as Error).message}. ` +
          `Body: ${bodyText.slice(0, 600)}`,
      );
    }
    result.body = parsed;
    assertValid(contract.schema, parsed, `Response body of ${where}`);
  } else if (contract) {
    assert.equal(
      bodyText.trim(),
      '',
      `${where} with a body, but the OpenAPI document declares no body for this status. ` +
        `Body: ${bodyText.slice(0, 600)}`,
    );
  }

  return result;
}

/** Convenience for tests that only need the parsed body of a successful call. */
export async function getJson(operationId: string, options: CallOptions = {}): Promise<any> {
  const result = await callOperation(operationId, options);
  return result.body;
}
