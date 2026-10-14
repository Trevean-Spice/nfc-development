// Authentication and authorisation.
//
// The operation list is read from the OpenAPI document, so adding an admin endpoint to the
// specification automatically adds it to these tests. An admin write endpoint that quietly
// accepts an anonymous caller is the single worst thing this suite could miss, so every
// such endpoint is probed individually rather than by sampling.
//
// Every test in this suite is safe to run against production: an anonymous or badly
// credentialed request that is correctly rejected changes nothing, and a request that is
// wrongly accepted is the defect being hunted.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { callOperation } from '../client.js';
import { config } from '../config.js';
import { discoveredIds, type DiscoveredIds } from '../discovery.js';
import { scanEventBody } from '../fixtures.js';
import {
  authenticatedOperations,
  authenticatedWriteOperations,
  operation,
  publicOperations,
  type OperationContract,
} from '../spec.js';

function pathParamsFor(op: OperationContract, ids: DiscoveredIds): Record<string, string> {
  const params: Record<string, string> = {};
  for (const parameter of op.parameters) {
    if (parameter.in !== 'path') continue;
    switch (parameter.name) {
      case 'slug':
        params.slug = 'persian-sunrise';
        break;
      case 'recipeId':
        params.recipeId = ids.recipeId!;
        break;
      case 'growerId':
        params.growerId = ids.growerId!;
        break;
      case 'mediaId':
        params.mediaId = ids.mediaId!;
        break;
      default:
        throw new Error(`No fixture for path parameter ${parameter.name} on ${op.operationId}.`);
    }
  }
  return params;
}

function requiredQueryFor(op: OperationContract): Record<string, string> {
  const query: Record<string, string> = {};
  for (const parameter of op.parameters) {
    if (parameter.in !== 'query' || !parameter.required) continue;
    if (parameter.name === 'from') query.from = '2026-08-01';
    else if (parameter.name === 'to') query.to = '2026-08-17';
    else throw new Error(`No fixture for required query parameter ${parameter.name} on ${op.operationId}.`);
  }
  return query;
}

/** A body that is syntactically JSON but is never evaluated, because the call must be rejected first. */
function probeBodyFor(op: OperationContract): Record<string, unknown> | undefined {
  if (!op.requestSchema) return undefined;
  return {};
}

describe('Public reads need no credential', () => {
  for (const op of publicOperations.filter((candidate) => !candidate.isWrite)) {
    it(`${op.method.toUpperCase()} ${op.path} is readable unauthenticated`, async () => {
      const ids = await discoveredIds();
      const result = await callOperation(op.operationId, {
        anonymous: true,
        pathParams: pathParamsFor(op, ids),
        query: requiredQueryFor(op),
      });
      assert.ok(
        result.status < 400,
        `${op.operationId} returned ${result.status} to an unauthenticated caller. Every byte these ` +
          'return is already public in the rendered page, so no credential is required. Section 5.1.',
      );
    });
  }

  it('POST /v1/scan-events is reachable unauthenticated', async () => {
    await callOperation('recordScanEvent', { anonymous: true, body: scanEventBody(), expectStatus: 202 });
  });
});

describe('Every admin write endpoint rejects an unauthenticated request', () => {
  for (const op of authenticatedWriteOperations) {
    it(`${op.method.toUpperCase()} ${op.path} rejects an anonymous caller`, async () => {
      const ids = await discoveredIds();
      const result = await callOperation(op.operationId, {
        anonymous: true,
        pathParams: pathParamsFor(op, ids),
        query: requiredQueryFor(op),
        body: probeBodyFor(op),
        validateRequestBody: false,
      });
      assert.ok(
        result.status === 401,
        `${op.operationId} answered an anonymous write with ${result.status}. It must be 401. ` +
          'A write endpoint that quietly accepts anonymous callers is the worst failure in this contract.',
      );
      assert.ok(
        ['UNAUTHENTICATED', 'TOKEN_EXPIRED'].includes(result.body?.error?.code),
        `${op.operationId} returned 401 with code ${result.body?.error?.code}. Section 4.1 names ` +
          'UNAUTHENTICATED and TOKEN_EXPIRED for this case.',
      );
    });
  }
});

describe('Every admin read endpoint rejects an unauthenticated request', () => {
  for (const op of authenticatedOperations.filter((candidate) => !candidate.isWrite)) {
    it(`${op.method.toUpperCase()} ${op.path} rejects an anonymous caller`, async () => {
      const ids = await discoveredIds();
      const result = await callOperation(op.operationId, {
        anonymous: true,
        pathParams: pathParamsFor(op, ids),
        query: requiredQueryFor(op),
      });
      assert.equal(result.status, 401, `${op.operationId} served an anonymous caller ${result.status}.`);
    });
  }
});

describe('Every admin endpoint rejects a bearer token that is not valid', () => {
  for (const op of authenticatedOperations) {
    it(`${op.method.toUpperCase()} ${op.path} rejects a junk token`, async () => {
      const ids = await discoveredIds();
      const result = await callOperation(op.operationId, {
        token: 'not-a-real-token-0000',
        pathParams: pathParamsFor(op, ids),
        query: requiredQueryFor(op),
        body: probeBodyFor(op),
        validateRequestBody: false,
      });
      assert.equal(
        result.status,
        401,
        `${op.operationId} answered a junk bearer token with ${result.status}. Tokens are validated ` +
          'on signature, issuer, audience and expiry.',
      );
    });
  }
});

describe('Roles are enforced, and insufficient role is 403 rather than 404', () => {
  const viewerToken = config.tokens.viewer;
  const editorToken = config.tokens.editor;

  const editorOnly = authenticatedOperations.filter((op) => op.minimumRole === 'Editor');

  for (const op of editorOnly) {
    it(`${op.method.toUpperCase()} ${op.path} refuses a Viewer`, { skip: viewerToken ? false : 'no viewer token configured' }, async () => {
      const ids = await discoveredIds();
      const result = await callOperation(op.operationId, {
        role: 'viewer',
        pathParams: pathParamsFor(op, ids),
        query: requiredQueryFor(op),
        body: probeBodyFor(op),
        validateRequestBody: false,
      });
      assert.equal(
        result.status,
        403,
        `${op.operationId} answered a Viewer with ${result.status}. Insufficient role is 403, not 404: ` +
          'hiding admin routes from an authenticated internal user buys nothing and makes support harder.',
      );
      assert.equal(result.body?.error?.code, 'INSUFFICIENT_ROLE');
    });
  }

  it('GET /v1/admin/tags refuses an Editor', { skip: editorToken ? false : 'no editor token configured' }, async () => {
    const result = await callOperation('adminListTagRecords', { role: 'editor' });
    assert.equal(result.status, 403, 'The tag records are Admin only.');
    assert.equal(result.body?.error?.code, 'INSUFFICIENT_ROLE');
  });

  it('GET /v1/admin/tags admits an Admin', { skip: config.tokens.admin ? false : 'no admin token configured' }, async () => {
    const result = await callOperation('adminListTagRecords', { role: 'admin', expectStatus: 200 });
    assert.ok(Array.isArray(result.body.data));
  });

  it('a Viewer may read the analytics dashboard', { skip: viewerToken ? false : 'no viewer token configured' }, async () => {
    await callOperation('adminGetScanTimeSeries', {
      role: 'viewer',
      query: { from: '2026-08-01', to: '2026-08-17' },
      expectStatus: 200,
    });
  });

  it('an expired token is 401, not 403', { skip: config.isStub ? false : 'stub only fixture' }, async () => {
    const result = await callOperation('adminListBlends', { token: 'stub-expired-token' });
    assert.equal(result.status, 401);
    assert.equal(result.body?.error?.code, 'TOKEN_EXPIRED');
  });
});

describe('No authentication is ever required on the tap path', () => {
  it('the only tap path operation declares no security scheme', () => {
    assert.deepEqual(operation('recordScanEvent').securitySchemes, []);
  });

  it('the optional after paint catalog refresh declares no security scheme', () => {
    assert.deepEqual(operation('getCatalogEntry').securitySchemes, []);
  });
});
