// Coverage of the specification by this run.
//
// Runs last. A suite that has quietly stopped calling an endpoint still reports green, and
// that is worse than no suite at all, because the freeze is only real while it is enforced.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  NOT_PROVOKED_BY_DESIGN,
  STRUCTURALLY_UNREACHABLE,
  report,
  unexercisedOperations,
  unexplainedStatusGaps,
} from '../coverage.js';
import { config, describeConfig } from '../config.js';
import { operationList } from '../spec.js';

describe('Specification coverage', () => {
  it('exercised every operation in the OpenAPI document', () => {
    const summary = report();
    console.log('');
    console.log('      Configuration');
    for (const line of describeConfig().split('\n')) console.log(`        ${line}`);
    console.log('');
    console.log(
      `      Operations exercised: ${summary.exercisedOperations} of ${summary.totalOperations}`,
    );
    console.log(
      `      Declared status codes observed: ${summary.observedDeclaredStatuses} of ` +
        `${summary.totalDeclaredStatuses}`,
    );
    console.log('');
    for (const line of summary.lines) console.log(`  ${line}`);
    console.log('');
    if (!config.allowWrites) {
      console.log('      Writes were disabled, so status codes reachable only by mutating are not observed.');
      console.log('');
    }

    const missing = unexercisedOperations().map((op) => `${op.method.toUpperCase()} ${op.path}`);
    assert.deepEqual(
      missing,
      [],
      `The suite never called: ${missing.join(', ')}. Every operation in the frozen contract must be ` +
        'exercised, or the freeze is a document rather than a contract.',
    );
  });

  it('has a test for every path in the document', () => {
    const paths = new Set(operationList.map((op) => op.path));
    console.log(`      ${paths.size} paths, ${operationList.length} operations.`);
    assert.ok(paths.size > 0);
  });

  it('accounts for every declared status it did not observe', { skip: config.allowWrites ? false : 'writes disabled' }, () => {
    const declaredSomewhere = NOT_PROVOKED_BY_DESIGN.filter((status) =>
      operationList.some((op) => op.declaredStatuses.includes(status)),
    );
    console.log('');
    console.log(
      `      Not provoked by design: ${declaredSomewhere.join(', ')}. 429 is enforced at the CDN and`,
    );
    console.log(
      '      WAF layer rather than in application code. 500, 502, 503 and 504 are unhandled, upstream',
    );
    console.log(
      '      or a deliberate shed. Provoking any of them on a shared host is an incident, not a test.',
    );
    console.log('');
    console.log('      Structurally unreachable as the frozen document stands:');
    for (const entry of STRUCTURALLY_UNREACHABLE) {
      console.log(`        ${entry.operationId} ${entry.status}: ${entry.reason}`);
    }
    console.log('');

    const gaps = unexplainedStatusGaps().map((gap) => `${gap.operationId} ${gap.status}`);
    assert.deepEqual(
      gaps,
      [],
      `These declared statuses were neither observed nor accounted for: ${gaps.join(', ')}. ` +
        'Either the suite is missing a case or the document declares a status nothing can produce.',
    );
  });
});
