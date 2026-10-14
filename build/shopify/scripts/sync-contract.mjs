#!/usr/bin/env node
/*
 * Refresh the vendored copy of the frozen M1 API contract.
 *
 * The copy in openapi/ exists so this component is portable into the client's
 * nfc-development repository on its own. A copy that has drifted from the deliverable is
 * worse than no copy, so test/contract.test.ts fails when the two differ, and this script
 * is how the drift is closed deliberately.
 *
 * The contract is frozen. If this script produces a change, that change is a contract
 * revision and belongs in a commit that says so.
 */

import { copyFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const target = join(here, '..', 'openapi', 'openapi.yaml');
const source = join(here, '..', '..', '..', 'deliverables', 'm1', '01-api-contract.openapi.yaml');

const before = readFileSync(target);
copyFileSync(source, target);
const after = readFileSync(target);

if (before.equals(after)) {
  console.log('The vendored contract already matched the M1 deliverable. Nothing changed.');
} else {
  console.log('The vendored contract has been updated from the M1 deliverable.');
  console.log('The contract is frozen. Review this as a contract revision, not as a housekeeping change.');
}
