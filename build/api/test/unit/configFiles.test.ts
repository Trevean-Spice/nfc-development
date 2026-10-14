import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { STREAM_FILTER_CRITERIA, STREAM_FILTER_PATTERN } from '../../src/stream/filter.js';
import { spec, SPEC_PATH } from '../../src/http/spec.js';

/**
 * Files that are handed to another deliverable, checked against the code that produced
 * them so the two cannot drift.
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

describe('config/stream-filter.json', () => {
  it('matches the filter the consumer enforces in process', () => {
    const file = JSON.parse(readFileSync(resolve(root, 'config/stream-filter.json'), 'utf8')) as {
      FilterCriteria: { Filters: Array<{ Pattern: string }> };
      RecommendedEventSourceMapping: { BisectBatchOnFunctionError: boolean; BatchSize: number };
    };
    expect(file.FilterCriteria).toEqual(STREAM_FILTER_CRITERIA);
    expect(JSON.parse(file.FilterCriteria.Filters[0]?.Pattern as string)).toEqual(STREAM_FILTER_PATTERN);
    // Bisect on error stays disabled: a bisected batch has a different batch id, which the
    // checkpoint would not recognise, and that is how double counting starts.
    expect(file.RecommendedEventSourceMapping.BisectBatchOnFunctionError).toBe(false);
    expect(file.RecommendedEventSourceMapping.BatchSize).toBe(500);
  });
});

describe('the vendored OpenAPI document', () => {
  it('is byte identical to the frozen M1 deliverable', () => {
    // The frozen contract lives in the engagement knowledge base. This package carries a
    // copy so it can be moved as a directory into the client repository, and the copy is
    // only ever a copy.
    const vendored = readFileSync(SPEC_PATH, 'utf8');
    const frozen = readFileSync(
      resolve(root, '../../deliverables/m1/01-api-contract.openapi.yaml'),
      'utf8',
    );
    expect(vendored).toBe(frozen);
  });

  it('parses, and every operation carries the tap path annotation', () => {
    const document = spec();
    expect(document.openapi).toBe('3.1.0');
    expect(document.info.version).toBe('1.0.0');

    const raw = parse(readFileSync(SPEC_PATH, 'utf8')) as {
      paths: Record<string, Record<string, { 'x-tap-path'?: unknown; operationId?: string }>>;
    };
    const operations = Object.values(raw.paths).flatMap((methods) => Object.values(methods));
    expect(operations.length).toBeGreaterThan(0);
    for (const operation of operations) {
      expect(operation['x-tap-path']).toBeDefined();
    }
    // Exactly one operation is on the tap critical path, and it is the beacon.
    const onTapPath = operations.filter((o) => o['x-tap-path'] === true);
    expect(onTapPath.map((o) => o.operationId)).toEqual(['recordScanEvent']);
  });
});

describe('STAGE is a closed set, because every development affordance is gated on it', () => {
  /**
   * `allowDevSymmetricTokens` and the environment variable secret provider are both gated on
   * a comparison against the exact string 'production'. Read as an unchecked string, 'prod'
   * is not 'production', so a single misspelling decided every one of those comparisons the
   * permissive way and STAGE unset fell back to the most permissive value there is.
   */
  it('refuses a stage it does not recognise rather than treating it as non production', async () => {
    const { loadConfig } = await import('../../src/config/env.js');
    for (const bad of ['prod', 'Production', 'PRODUCTION', 'live', 'stage']) {
      expect(() => loadConfig({ ...process.env, STAGE: bad })).toThrowError(/not a recognised stage/);
    }
  });

  it('accepts the three it does, and defaults an unset value to local', async () => {
    const { loadConfig, STAGES } = await import('../../src/config/env.js');
    expect(STAGES).toEqual(['local', 'staging', 'production']);
    for (const good of STAGES) {
      expect(loadConfig({ ...process.env, STAGE: good }).stage).toBe(good);
    }
    const unset = { ...process.env };
    delete unset.STAGE;
    expect(loadConfig(unset).stage).toBe('local');
  });

  it('never enables development symmetric tokens on a production stage', async () => {
    const { loadConfig } = await import('../../src/config/env.js');
    const cfg = loadConfig({ ...process.env, STAGE: 'production', AUTH_ALLOW_DEV_TOKENS: 'true' });
    expect(cfg.auth.allowDevSymmetricTokens).toBe(false);
  });
});
