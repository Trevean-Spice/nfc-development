// Checks the frozen specification against itself and against the facts of the engagement.
//
// These tests need no server. They are what catches a renamed slug, a tag code that no
// longer matches the redirect table, an admin operation that forgot its 401, or a beacon
// field that would let free text onto the tap path. If the OpenAPI document is edited and
// the world is not, this suite goes red before anyone writes an implementation against it.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CHIP_PART_NUMBER,
  REAL_BLEND_SLUGS,
  REDIRECT_STATUS,
  TAG_CODE_MAP,
  TOTAL_TAGS_ENCODED,
} from '../fixtures.js';
import { findExampleProblems, formatExampleProblems } from '../specExamples.js';
import {
  authenticatedOperations,
  componentEnum,
  operation,
  operationList,
  publicOperations,
  spec,
  tapPathOperations,
} from '../spec.js';

const ERROR_ENVELOPE_REF = 'trevean-openapi#/components/schemas/ErrorEnvelope';

describe('Specification integrity', () => {
  it('is an OpenAPI 3.1 document with the servers the engagement uses', () => {
    assert.match(String(spec.openapi), /^3\.1\./);
    const urls = (spec.servers as Array<{ url: string }>).map((server) => server.url);
    assert.ok(urls.length >= 1, 'The document declares no servers.');
    assert.ok(
      urls.some((url) => url.includes('staging')),
      'No staging server is declared. Everything on the contractor side builds and measures on staging.',
    );
  });

  it('gives every operation a unique operationId', () => {
    const ids = operationList.map((op) => op.operationId);
    assert.equal(new Set(ids).size, ids.length, 'Duplicate operationId in the document.');
    for (const op of operationList) {
      assert.ok(op.operationId.length > 0, `${op.method} ${op.path} has an empty operationId.`);
    }
  });

  it('marks exactly one operation as being on the tap critical path', () => {
    assert.deepEqual(
      tapPathOperations.map((op) => op.operationId),
      ['recordScanEvent'],
      'The contract states exactly one operation is on the tap path: the scan event beacon.',
    );
    const beacon = operation('recordScanEvent');
    assert.equal(beacon.method, 'post');
    assert.equal(beacon.path, '/v1/scan-events');
    assert.equal(beacon.requiresAuth, false, 'A browser beacon cannot hold a secret.');
  });

  it('keeps the catalog read off the required tap path', () => {
    assert.equal(
      operation('getCatalogEntry').tapPath,
      'after-paint-optional',
      'The catalog read is an optional after paint refresh, never a required tap path call.',
    );
    for (const op of operationList) {
      if (op.operationId === 'recordScanEvent' || op.operationId === 'getCatalogEntry') continue;
      assert.equal(
        op.tapPath,
        false,
        `${op.operationId} is not marked off the tap path. Every content operation is build and revalidate time only.`,
      );
    }
  });

  it('uses one error envelope for every non 2xx response of every operation', () => {
    const offenders: string[] = [];
    for (const op of operationList) {
      for (const [status, contract] of op.responses) {
        if (status < 400) continue;
        const schema: any = contract.schema;
        if (!schema || schema.$ref !== ERROR_ENVELOPE_REF) {
          offenders.push(`${op.operationId} ${status}`);
        }
      }
    }
    assert.deepEqual(offenders, [], 'No endpoint invents its own error shape. See section 4 of the contract.');
  });

  it('declares 500 on every operation', () => {
    const missing = operationList.filter((op) => !op.declaredStatuses.includes(500)).map((op) => op.operationId);
    assert.deepEqual(missing, []);
  });

  it('protects every admin operation with a bearer token, 401 and 403', () => {
    const adminOps = operationList.filter((op) => op.path.startsWith('/v1/admin/'));
    assert.ok(adminOps.length > 0);
    for (const op of adminOps) {
      assert.deepEqual(
        op.securitySchemes,
        ['bearerAuth'],
        `${op.operationId} does not require a bearer token.`,
      );
      assert.ok(op.declaredStatuses.includes(401), `${op.operationId} does not declare 401.`);
      assert.ok(op.declaredStatuses.includes(403), `${op.operationId} does not declare 403.`);
      assert.ok(
        ['Viewer', 'Editor', 'Admin'].includes(op.minimumRole ?? ''),
        `${op.operationId} declares x-minimum-role ${op.minimumRole}, which is not one of the three roles.`,
      );
    }
    assert.deepEqual(
      authenticatedOperations.map((op) => op.operationId).sort(),
      adminOps.map((op) => op.operationId).sort(),
      'An operation outside /v1/admin requires authentication, or an admin operation does not.',
    );
  });

  it('leaves every public content read and the beacon unauthenticated', () => {
    const expected = [
      'listBlends',
      'getBlendBySlug',
      'listRecipesForBlend',
      'getRecipe',
      'listGrowers',
      'getGrower',
      'getCatalogEntry',
      'recordScanEvent',
    ].sort();
    assert.deepEqual(publicOperations.map((op) => op.operationId).sort(), expected);
  });

  it('offers no write operation on the tag records for any role', () => {
    const tagWrites = operationList.filter((op) => op.path.startsWith('/v1/admin/tags') && op.isWrite);
    assert.deepEqual(
      tagWrites,
      [],
      'The redirect table is a version controlled artifact. It is not editable through the API by anyone, including Admin.',
    );
    assert.equal(operation('adminListTagRecords').minimumRole, 'Admin');
  });

  it('has worked examples that satisfy the schemas beside them', () => {
    const problems = findExampleProblems();
    assert.deepEqual(
      problems.map((problem) => `${problem.location} ${problem.name}`),
      [],
      'An example that violates its own schema is worse than no example. It is what an engineer ' +
        'copies when writing a client and what a mock server is seeded from.\n' +
        formatExampleProblems(problems),
    );
  });

  it('declares 400 on every operation that requires a request body', () => {
    const offenders = operationList
      .filter((op) => op.requestBodyRequired && !op.declaredStatuses.includes(400))
      .map((op) => op.operationId);
    assert.deepEqual(offenders, []);
  });
});

describe('The five real blend slugs and the tag code map', () => {
  it('enumerates exactly the five real slugs, in launch order', () => {
    assert.deepEqual(
      componentEnum('Slug'),
      [...REAL_BLEND_SLUGS],
      'The Slug enum no longer matches the five real blends. A renamed slug strands the redirect table.',
    );
  });

  it('enumerates exactly the four encoded tag codes plus the reserved fifth, and null', () => {
    assert.deepEqual(
      componentEnum('TagCode'),
      ['ps', 'cs', 'sr', 'nm', 'kg', null],
      'The TagCode enum no longer matches the codes encoded onto physical tags.',
    );
  });

  it('keeps the tag code map internally consistent', () => {
    for (const entry of TAG_CODE_MAP) {
      assert.match(entry.code, /^[a-z]{2}$/);
      assert.ok(
        (REAL_BLEND_SLUGS as readonly string[]).includes(entry.blendSlug),
        `${entry.code} points at ${entry.blendSlug}, which is not one of the five real slugs.`,
      );
      assert.equal(entry.requestPath, `/t/${entry.code}`);
      assert.equal(entry.targetPath, `/blend.html?blend=${entry.blendSlug}&via=nfc`);
    }
    const codes = TAG_CODE_MAP.map((entry) => entry.code);
    assert.equal(new Set(codes).size, codes.length, 'Duplicate tag code.');
    const encodedUnits = TAG_CODE_MAP.filter((entry) => entry.status === 'encoded').reduce(
      (total, entry) => total + entry.unitsEncoded,
      0,
    );
    assert.equal(encodedUnits, TOTAL_TAGS_ENCODED, 'Encoded units no longer sum to the 1,000 tags shipped.');
  });

  it('records the chip as ST25TV02KC and the redirect as 307 in the specification examples', () => {
    const example = ((spec.paths as any)['/v1/admin/tags'].get.responses['200'].content['application/json']
      .examples.deployedTable.value.data ?? []) as any[];
    assert.equal(example.length, TAG_CODE_MAP.length, 'The tag example no longer covers every code.');
    for (const row of example) {
      const expected = TAG_CODE_MAP.find((entry) => entry.code === row.code);
      assert.ok(expected, `The example carries an unknown tag code ${row.code}.`);
      assert.equal(row.blendSlug, expected!.blendSlug);
      assert.equal(row.requestPath, expected!.requestPath);
      assert.equal(row.targetPath, expected!.targetPath);
      assert.equal(row.redirectStatus, REDIRECT_STATUS);
      assert.equal(row.unitsEncoded, expected!.unitsEncoded);
      assert.equal(row.status, expected!.status);
      if (row.status === 'encoded') {
        assert.equal(row.chipPartNumber, CHIP_PART_NUMBER, 'The chip is ISO 15693 Type 5, not NTAG21x.');
        assert.equal(row.ndefUri, `https://treveanspice.com/t/${row.code}`);
      }
    }
    const redirectEnum = (spec.components as any).schemas.TagRecord.properties.redirectStatus.enum;
    assert.deepEqual(redirectEnum, [REDIRECT_STATUS], 'A 301 would be cached permanently and strand inventory.');
  });

  it('agrees with the blend examples on which two blends have real launch content', () => {
    const rows = (spec.paths as any)['/v1/blends'].get.responses['200'].content['application/json'].examples
      .allPublished.value.data as any[];
    const real = rows.filter((row) => row.launchTier === 'real').map((row) => row.slug).sort();
    assert.deepEqual(real, ['caribbean-sunset', 'persian-sunrise']);
    for (const row of rows) {
      const entry = TAG_CODE_MAP.find((candidate) => candidate.blendSlug === row.slug);
      assert.ok(entry, `${row.slug} has no tag code.`);
      assert.equal(row.tagCode, entry!.code, `${row.slug} carries tag code ${row.tagCode}, expected ${entry!.code}.`);
    }
  });
});

describe('The beacon body cannot carry anything of value', () => {
  const scanInput = (spec.components as any).schemas.ScanEventInput;

  it('rejects unknown properties', () => {
    assert.equal(
      scanInput.additionalProperties,
      false,
      'Section 5.2: anything not documented is rejected with 400.',
    );
  });

  it('requires only the four fields the browser always has', () => {
    assert.deepEqual([...scanInput.required].sort(), ['blendSlug', 'channel', 'dedupToken', 'occurredAt'].sort());
  });

  it('carries no identifier of value and no location', () => {
    const forbidden = [
      'ip',
      'ipaddress',
      'email',
      'customerid',
      'userid',
      'orderid',
      'ordernumber',
      'latitude',
      'longitude',
      'geo',
      'country',
      'city',
      'useragent',
      'sessionid',
    ];
    for (const name of Object.keys(scanInput.properties)) {
      assert.ok(
        !forbidden.includes(name.toLowerCase()),
        `The beacon body declares ${name}. No IP, no precise location, no customer identifier, per section 8.3.`,
      );
    }
  });

  it('bounds every string field, so no free text reaches the tap path', () => {
    for (const [name, schema] of Object.entries<any>(scanInput.properties)) {
      const types = Array.isArray(schema.type) ? schema.type : [schema.type];
      const isStringish = types.includes('string') || schema.$ref !== undefined;
      if (!isStringish) continue;
      const target = schema.$ref
        ? (spec.components as any).schemas[String(schema.$ref).split('/').pop()!]
        : schema;
      const bounded =
        target.enum !== undefined ||
        target.pattern !== undefined ||
        target.maxLength !== undefined ||
        target.format !== undefined;
      assert.ok(
        bounded,
        `Beacon field ${name} is an unbounded string. Section 5.2 requires an enum, a documented pattern, or a bound.`,
      );
    }
  });

  it('bounds every number field at both ends', () => {
    const unbounded: string[] = [];
    for (const [name, schema] of Object.entries<any>(scanInput.properties)) {
      const types = Array.isArray(schema.type) ? schema.type : [schema.type];
      if (!types.includes('integer') && !types.includes('number')) continue;
      if (schema.minimum === undefined || schema.maximum === undefined) {
        unbounded.push(`${name} (minimum ${schema.minimum}, maximum ${schema.maximum})`);
      }
    }
    assert.deepEqual(
      unbounded,
      [],
      'Section 5.2 of the frozen API contract says every beacon field is an enum, a bounded string ' +
        'matching a documented pattern, or a number in a documented range. A range has two ends. ' +
        'An unbounded field on an unauthenticated endpoint is storage an anonymous caller controls.',
    );
  });
});

describe('Analytics can only be served from rollups', () => {
  it('permits exactly one value for source and one for measurementMethod', () => {
    const series = (spec.components as any).schemas.ScanTimeSeries;
    assert.deepEqual(series.properties.source.enum, ['rollup'], 'Never a raw event query and never a table scan.');
    assert.deepEqual(series.properties.measurementMethod.enum, ['browser_token']);
    assert.ok(series.required.includes('measurementMethod'));
    assert.ok(series.required.includes('source'));
  });
});

describe('Pagination is cursor based everywhere', () => {
  it('envelopes every list response with data and nextCursor and nothing else', () => {
    const listSchemas = ['BlendSummaryList', 'RecipeList', 'GrowerList', 'MediaList'];
    for (const name of listSchemas) {
      const schema = (spec.components as any).schemas[name];
      assert.equal(schema.additionalProperties, false, `${name} is not a closed envelope.`);
      assert.deepEqual([...schema.required].sort(), ['data', 'nextCursor']);
    }
  });

  it('offers no offset parameter anywhere', () => {
    for (const op of operationList) {
      for (const parameter of op.parameters) {
        assert.ok(
          !['offset', 'page', 'skip'].includes(String(parameter.name).toLowerCase()),
          `${op.operationId} offers ${parameter.name}. Offset pagination does not exist cheaply in DynamoDB.`,
        );
      }
    }
  });

  it('caps limit at 100 and defaults it to 25', () => {
    const limit = (spec.components as any).parameters.Limit.schema;
    assert.equal(limit.default, 25);
    assert.equal(limit.maximum, 100);
    assert.equal(limit.minimum, 1);
  });
});
