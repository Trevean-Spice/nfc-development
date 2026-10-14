import { describe, expect, it } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadContract } from '../../src/contract.js';

/**
 * The frozen contract is the source of every authorisation rule in this application. These
 * tests are what stops "the admin implements the contract" from being a claim.
 */

const here = dirname(fileURLToPath(import.meta.url));
const CONTRACT = resolve(here, '..', '..', '..', 'api', 'openapi', 'openapi.yaml');

describe('the frozen contract', () => {
  const contract = loadContract(CONTRACT);

  it('is version 1.0.0', () => {
    expect(contract.version).toBe('1.0.0');
  });

  it('declares a minimum role on every admin operation', () => {
    const undeclared = contract.adminOperations().filter((op) => op.minimumRole === null);
    expect(undeclared.map((op) => op.operationId)).toEqual([]);
  });

  it('has exactly the admin surface the admin builds against, and no more', () => {
    expect(contract.adminOperations().map((op) => `${op.method} ${op.path}`).sort()).toEqual(
      [
        'GET /v1/admin/analytics/scans',
        'GET /v1/admin/blends',
        'GET /v1/admin/blends/{slug}',
        'GET /v1/admin/media',
        'GET /v1/admin/media/{mediaId}',
        'GET /v1/admin/tags',
        'PATCH /v1/admin/blends/{slug}',
        'PATCH /v1/admin/growers/{growerId}',
        'PATCH /v1/admin/recipes/{recipeId}',
        'POST /v1/admin/blends',
        'POST /v1/admin/blends/{slug}/publish',
        'POST /v1/admin/growers',
        'POST /v1/admin/media/uploads',
        'POST /v1/admin/media/{mediaId}/complete',
        'POST /v1/admin/recipes',
        'POST /v1/admin/revalidate',
        'DELETE /v1/admin/recipes/{recipeId}',
      ].sort(),
    );
  });

  it('puts every write behind Editor at least, and the tag records behind Admin', () => {
    expect(contract.minimumRole('adminListBlends')).toBe('Viewer');
    expect(contract.minimumRole('adminGetBlend')).toBe('Viewer');
    expect(contract.minimumRole('adminListMedia')).toBe('Viewer');
    expect(contract.minimumRole('adminGetScanTimeSeries')).toBe('Viewer');

    expect(contract.minimumRole('adminCreateBlend')).toBe('Editor');
    expect(contract.minimumRole('adminUpdateBlend')).toBe('Editor');
    expect(contract.minimumRole('adminPublishBlend')).toBe('Editor');
    expect(contract.minimumRole('adminRevalidate')).toBe('Editor');
    expect(contract.minimumRole('adminCreateRecipe')).toBe('Editor');
    expect(contract.minimumRole('adminUpdateRecipe')).toBe('Editor');
    expect(contract.minimumRole('adminDeleteRecipe')).toBe('Editor');
    expect(contract.minimumRole('adminCreateGrower')).toBe('Editor');
    expect(contract.minimumRole('adminUpdateGrower')).toBe('Editor');
    expect(contract.minimumRole('adminCreateMediaUpload')).toBe('Editor');
    expect(contract.minimumRole('adminCompleteMediaUpload')).toBe('Editor');

    expect(contract.minimumRole('adminListTagRecords')).toBe('Admin');
  });

  it('offers no write operation on the tag records at any role, including Admin', () => {
    const tagWrites = contract
      .adminOperations()
      .filter((op) => op.path.startsWith('/v1/admin/tags') && op.method !== 'GET');
    expect(tagWrites).toEqual([]);
  });

  it('refuses an operation id that is not in the document, rather than defaulting it', () => {
    expect(() => contract.operation('adminDeleteEverything')).toThrow(/does not invent endpoints/);
  });

  it('has no admin user or role management operation, which is why role management is local', () => {
    const userOps = contract.adminOperations().filter((op) => /user|role/i.test(op.path));
    expect(userOps).toEqual([]);
  });

  it('has no operation that reads the state of a revalidation, despite section 10.2 promising a status URL', () => {
    const statusOps = [...contract.operations.values()].filter((op) => /revalidat/i.test(op.path) && op.method === 'GET');
    expect(statusOps).toEqual([]);
  });

  it('has no admin read operation for growers, which is why the public route is used', () => {
    const growerReads = contract
      .adminOperations()
      .filter((op) => op.path.startsWith('/v1/admin/growers') && op.method === 'GET');
    expect(growerReads).toEqual([]);
  });
});
