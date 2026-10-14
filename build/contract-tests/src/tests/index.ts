// Single entry point for the whole suite.
//
// Every suite is imported into one process, in order, so that coverage can be aggregated
// in memory and asserted at the end. Node's test runner registers tests at import time and
// runs top level tests in registration order, so the coverage suite genuinely runs last.
//
//   node --test dist/tests/index.js
//
// Ordering matters in two places: discovery reads identifiers from the target before the
// suites that need them, and the coverage suite is imported last.

import './01-spec-integrity.js';
import './02-content.js';
import './03-catalog.js';
import './04-scan-beacon.js';
import './05-beacon-transport.js';
import './06-auth.js';
import './07-admin-content.js';
import './08-admin-media.js';
import './09-admin-publishing.js';
import './10-admin-analytics.js';
import './11-admin-tags.js';
import './12-error-envelope.js';
import './13-conventions.js';
import './14-latency.js';
import './99-coverage.js';
