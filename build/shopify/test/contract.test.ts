import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as AjvNamespace from 'ajv/dist/2020.js';
import * as AddFormatsNamespace from 'ajv-formats';
import { parse as parseYaml } from 'yaml';
import { beforeAll, describe, expect, it } from 'vitest';
import { syncCatalog } from '../src/admin/catalogSync.js';
import { RecordedAdminTransport, type AdminGraphQLResponse } from '../src/admin/transport.js';
import { emptyCatalogEntry, toApiCatalogEntry } from '../src/mirror/degrade.js';
import type { CatalogEntry } from '../src/types.js';

/*
 * Conformance against the frozen M1 API contract, version 1.0.0.
 *
 * The schema is COMPILED OUT OF THE CONTRACT DOCUMENT rather than retyped here, for the
 * same reason the API package compiles its request validation from it: a contract frozen
 * for seven weeks, with a hand written copy of its schema beside it, drifts silently. A
 * schema compiled from the document cannot.
 *
 * "Build against the frozen contract, report gaps, do not silently extend it" is the
 * instruction. This file is the mechanical half of that. The prose half is the README
 * section "Gaps against the frozen contract".
 */

const CONTRACT = fileURLToPath(new URL('../openapi/openapi.yaml', import.meta.url));
const DELIVERABLE = fileURLToPath(new URL('../../../deliverables/m1/01-api-contract.openapi.yaml', import.meta.url));

/*
 * Ajv v8 and ajv-formats ship as CommonJS with an export assignment, so under NodeNext the
 * callable lives on .default in some resolutions and on the namespace itself in others.
 * Resolved once, here, rather than with a cast at every call site.
 */
type ValidateFn = ((data: unknown) => boolean) & { errors?: unknown };
type AjvInstance = { addSchema(schema: unknown, key: string): void; getSchema(ref: string): ValidateFn | undefined };
type AjvCtor = new (options?: Record<string, unknown>) => AjvInstance;

const Ajv2020 = ((AjvNamespace as { default?: unknown }).default ?? AjvNamespace) as unknown as AjvCtor;
const addFormats = ((AddFormatsNamespace as { default?: unknown }).default ?? AddFormatsNamespace) as unknown as (
  ajv: AjvInstance,
) => void;

let validate: ValidateFn;

beforeAll(() => {
  const document = parseYaml(readFileSync(CONTRACT, 'utf8')) as Record<string, unknown>;
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  ajv.addSchema(document, 'contract');
  const compiled = ajv.getSchema('contract#/components/schemas/CatalogEntry');
  if (!compiled) throw new Error('CatalogEntry is not in the frozen contract at the expected pointer.');
  validate = compiled;
});

function assertValid(entry: CatalogEntry): void {
  if (!validate(entry)) {
    throw new Error(
      `CatalogEntry failed the frozen contract schema: ${JSON.stringify(validate.errors, null, 2)}\nEntry: ${JSON.stringify(entry, null, 2)}`,
    );
  }
}

describe('the vendored copy of the contract', () => {
  it('is byte identical to the M1 deliverable', () => {
    // The copy exists so this package is portable into the client's nfc-development
    // repository on its own. A copy that has drifted from the deliverable is worse than no
    // copy, so the drift is a test failure rather than a convention.
    expect(readFileSync(CONTRACT)).toEqual(readFileSync(DELIVERABLE));
  });
});

describe('every CatalogEntry this package can produce validates against the frozen contract', () => {
  function fixture(name: string): AdminGraphQLResponse {
    return JSON.parse(readFileSync(fileURLToPath(new URL(`../fixtures/admin/${name}`, import.meta.url)), 'utf8'));
  }

  it('validates the fresh entries produced by a full sync', async () => {
    const result = await syncCatalog({
      transport: new RecordedAdminTransport([fixture('products.page1.json'), fixture('products.page2.json')]),
      knownSlugs: ['persian-sunrise', 'caribbean-sunset', 'silk-road', 'north-african-night-market', 'kyoto-garden'],
      storefrontBase: 'https://shop.treveanspice.com',
      defaultCurrency: 'USD',
      lowStockThreshold: 5,
      now: () => new Date('2026-08-22T09:00:00.000Z'),
      sleep: async () => {},
    });
    expect(result.records).toHaveLength(4);
    for (const record of result.records) {
      assertValid(toApiCatalogEntry(record, { now: new Date('2026-08-22T09:05:00.000Z') }));
    }
  });

  it('validates a stale entry, which is the degraded shape the contract documents', async () => {
    const result = await syncCatalog({
      transport: new RecordedAdminTransport([fixture('products.page1.json'), fixture('products.page2.json')]),
      knownSlugs: ['persian-sunrise'],
      storefrontBase: 'https://shop.treveanspice.com',
      defaultCurrency: 'USD',
      now: () => new Date('2026-08-22T09:00:00.000Z'),
      sleep: async () => {},
    });
    const entry = toApiCatalogEntry(result.records[0]!, { now: new Date('2026-08-23T09:00:00.000Z') });
    assertValid(entry);
    expect(entry).toMatchObject({ stale: true, inventoryStatus: 'unknown' });
  });

  it('validates the empty entry served when there is no mirror row, which is the state today', () => {
    const entry = emptyCatalogEntry('persian-sunrise', '2026-08-22T09:00:00Z');
    assertValid(entry);
    expect(entry.cartPermalinkUrl).toBeNull();
  });

  it('rejects an entry with a field the contract does not carry, so additionalProperties false is real', () => {
    const entry = { ...emptyCatalogEntry('persian-sunrise', '2026-08-22T09:00:00Z'), syncSource: 'schedule' };
    expect(validate(entry)).toBe(false);
  });

  it('rejects an inventoryStatus outside the contract enum', () => {
    const entry = { ...emptyCatalogEntry('persian-sunrise', '2026-08-22T09:00:00Z'), inventoryStatus: 'backordered' };
    expect(validate(entry)).toBe(false);
  });

  it('rejects a slug that is not one of the five', () => {
    const entry = { ...emptyCatalogEntry('kyoto-gardens', '2026-08-22T09:00:00Z') };
    expect(validate(entry)).toBe(false);
  });
});

describe('the contract example is reproduced rather than approximated', () => {
  it('matches the persianSunrise CatalogEntry example field for field where the mirror can produce it', () => {
    const document = parseYaml(readFileSync(CONTRACT, 'utf8')) as {
      paths: Record<string, Record<string, { responses: Record<string, { content: Record<string, { examples: Record<string, { value: CatalogEntry }> }> }> }>>;
    };
    const example =
      document.paths['/v1/catalog/{slug}']?.['get']?.responses['200']?.content['application/json']?.examples[
        'persianSunrise'
      ]?.value;
    expect(example).toBeDefined();
    expect(example?.cartPermalinkUrl).toBe('https://shop.treveanspice.com/cart/41802938471233:1?channel=nfc');
    assertValid(example as CatalogEntry);
  });
});
