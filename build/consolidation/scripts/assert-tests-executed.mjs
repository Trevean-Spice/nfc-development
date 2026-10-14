#!/usr/bin/env node
/**
 * Trevean Spice NFC. Proof that the test run actually executed tests.
 *
 * Destination: scripts/ci/assert-tests-executed.mjs
 * Runs in the Tests job of .github/workflows/ci.yml, immediately after jest.
 *
 * Usage:
 *   node scripts/ci/assert-tests-executed.mjs \
 *     --results jest-results.json \
 *     --floor ci/test-floor.json \
 *     --jest-output jest-output.txt \
 *     --jest-exit-code 1
 *
 * WHY THIS EXISTS
 *
 * jest's exit code is not sufficient evidence that anything was tested, and in this
 * repository specifically it has been misleading in three different ways at once:
 *
 *   1. Until this consolidation, npm test failed while PARSING jest.config.ts. No test
 *      file was discovered, no result file was written, and the failure named a
 *      TypeScript error in a configuration file rather than saying "nothing ran".
 *   2. Bypassing the configuration, all eight suites failed to COMPILE. jest reports that
 *      as eight failed suites and zero tests. A reader scanning for "Tests: 0 failed"
 *      sees a number that looks like success. numRuntimeErrorTestSuites is the field that
 *      tells the truth, and nobody reads it by eye.
 *   3. The suites that could not compile asserted an 840 byte NTAG216 payload limit. The
 *      tag is an ST25TV02KC with 256 bytes. Repairing the imports without reading the
 *      assertions would have turned those suites green, at which point a 500 byte payload
 *      that does not fit on the real chip passes CI. A green build is not neutral here:
 *      it is a false statement about hardware that ships.
 *
 * So the gate is this script rather than jest, and the floor is a committed file rather
 * than a default, because a default can be flipped in a pull request without anybody
 * noticing and a committed floor cannot.
 *
 * THE NO TESTS CASE, AND WHY IT IS HANDLED HERE RATHER THAN BY jest
 *
 * From PR 6 until the replacement suite lands there are genuinely no test files in this
 * repository. jest.config.ts sets passWithNoTests to false, deliberately, so jest exits 1
 * and WRITES NO RESULT FILE AT ALL. That is jest's documented behaviour and it is not a
 * crash.
 *
 * An earlier version of this script treated any absent result file as a crash and named
 * the two jest configuration typos as the cause. Those typos were corrected in PR 4, so
 * for the whole of the dated zero window the Tests check was red with an explanation that
 * was false, and the zero floor mechanism, which exists precisely to make that window
 * honest, never got the chance to run. Corrected on 25 August 2026 after the sequence was
 * applied to a scratch repository and the job was observed failing.
 *
 * passWithNoTests stays false. The point was never that jest should tolerate an empty run:
 * it is that the DECISION about an empty run belongs to a committed, dated floor that
 * warns on every build and expires, not to a jest flag that any pull request can flip. So
 * jest still refuses, and this script decides, and the floor is what it decides with.
 *
 * No dependencies. Node standard library only.
 */

import { existsSync, readFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};

const resultsPath = arg('results', 'jest-results.json');
const floorPath = arg('floor', 'ci/test-floor.json');
const jestOutputPath = arg('jest-output', null);
const jestExitCode = arg('jest-exit-code', null);

const die = (lines) => {
  console.error('');
  for (const l of lines) console.error(l);
  console.error('');
  process.exit(1);
};

/* ------------------------------------------------------------------ the floor -- */

if (!existsSync(floorPath)) {
  die([
    `FAIL: the test floor file ${floorPath} does not exist.`,
    '',
    'The floor is what stops this job passing vacuously. Without it there is no committed',
    'statement of how many tests this repository is supposed to run, so a run that executes',
    'none is indistinguishable from a run that executes all of them.',
    '',
    'Fix: add ci/test-floor.json. The shape is in build/consolidation/files/test-floor.json.',
  ]);
}

const floor = JSON.parse(readFileSync(floorPath, 'utf8'));
const minimumTests = Number(floor.minimumTests);
const expires = floor.expires ? new Date(`${floor.expires}T23:59:59Z`) : null;

if (!Number.isFinite(minimumTests) || minimumTests < 0) {
  die([`FAIL: ${floorPath} does not declare a numeric minimumTests.`]);
}

/* -------------------------------------------- a floor of zero is allowed, briefly -- */

let zeroWindowOpen = false;

if (minimumTests === 0) {
  if (!expires) {
    die([
      `FAIL: ${floorPath} sets minimumTests to 0 with no expiry date.`,
      '',
      'A zero floor means this job cannot fail, which is the state this repository was',
      'already in for two months. It is allowed only as a deliberate, dated window: the gap',
      'between deleting the dead suite and landing its replacement. An undated zero is not a',
      'window, it is the old situation with a config file in front of it.',
      '',
      'Fix: add an "expires" date and a "reason" to ci/test-floor.json, or raise the floor.',
    ]);
  }

  const now = new Date();
  if (now > expires) {
    die([
      `FAIL: the zero test floor in ${floorPath} expired on ${floor.expires}.`,
      `Reason recorded when it was set: ${floor.reason || '(none recorded)'}`,
      '',
      'The window between deleting the dead test suite and landing its replacement has',
      'closed. This job has been unable to fail since the floor was set, so nothing it has',
      'reported since then is evidence of anything.',
      '',
      'Fix: land the replacement suite and raise minimumTests to the number it executes.',
      'Extending the date is also a decision, and it belongs in the decision log with who',
      'asked and what moved, not in a quiet edit to this file.',
    ]);
  }

  zeroWindowOpen = true;
  console.warn('');
  console.warn(`WARNING: the test floor is 0 until ${floor.expires}.`);
  console.warn(`Reason: ${floor.reason || '(none recorded)'}`);
  console.warn('This job CANNOT FAIL while that is true. Do not read a green Tests check as');
  console.warn('evidence that this repository is tested. It is evidence that the window is');
  console.warn('still open.');
  console.warn('');
}

/* ------------------------------- did jest run and find nothing, or did jest die? -- */

/* jest prints its own sentence when the discovery phase finds no test file, and it     */
/* writes no result file in that case. The two states look identical on disk and they   */
/* are not the same thing, so the workflow captures jest's output and this script reads  */
/* it rather than guessing. Absent that capture the script does not guess either: it     */
/* says the capture is missing.                                                          */
const NO_TESTS_MARKERS = ['No tests found', 'no tests found'];

const jestOutput = jestOutputPath && existsSync(jestOutputPath)
  ? readFileSync(jestOutputPath, 'utf8')
  : null;

const jestFoundNoTests = jestOutput !== null && NO_TESTS_MARKERS.some((m) => jestOutput.includes(m));

if (!existsSync(resultsPath) && jestFoundNoTests) {
  /* A FIRST CLASS OUTCOME, NOT AN ERROR. jest ran, discovered nothing, and refused to  */
  /* pass, which is what passWithNoTests: false is for. Whether that is acceptable is a */
  /* question for the committed floor, and it is answered below rather than here.       */
  console.log('Jest reported:');
  console.log('  suites            0 discovered. jest found no test file to run.');
  console.log('  tests             0 executed');
  console.log(`  floor             ${minimumTests}`);
  console.log('');
  console.log('jest wrote no result file. That is its documented behaviour when the discovery');
  console.log('phase finds nothing, and it is not a crash: passWithNoTests is set to false in');
  console.log('jest.config.ts on purpose, so jest refuses rather than passing an empty run.');
  console.log('Whether an empty run is acceptable today is decided by ci/test-floor.json.');
  console.log('');

  if (minimumTests > 0) {
    die([
      'TESTS GATE FAILED.',
      '',
      `1. 0 test(s) executed against a committed floor of ${minimumTests}, because jest found no`,
      '   test file at all. Tests have been deleted, moved out of the roots in jest.config.ts,',
      '   or renamed out of the testMatch pattern. If that is deliberate, lower the floor in the',
      '   same pull request and say why in the pull request body, so the reduction is reviewed',
      '   rather than absorbed.',
      '',
      'Reproduce locally with the exact command CI ran:',
      '  npx jest --config jest.config.ts --ci --json --outputFile=jest-results.json',
    ]);
  }

  console.log(`Tests gate passed under the dated zero floor: 0 tests executed, floor 0, window open until ${floor.expires}.`);
  console.log('This is not evidence that this repository is tested. It is evidence that the');
  console.log('window recorded in ci/test-floor.json has not closed yet.');
  process.exit(0);
}

/* ----------------------------------------------------------------- the results -- */

if (!existsSync(resultsPath)) {
  const lines = [
    `FAIL: jest wrote no result file at ${resultsPath}, and it did not report that it found no tests.`,
    '',
    'jest did not get as far as writing a result file, and this script could not classify',
    'why. It is NOT claiming to know the cause. Read the jest step above this one in the',
    'workflow log: its output is the real error and this message is not a substitute for it.',
    '',
    'The two states that produce an absent result file are:',
    '',
    '  a. jest ran, discovered no test file, and refused because passWithNoTests is false.',
    '     jest prints "No tests found" when that happens. This script did not see that line,',
    '     which is why it is not treating the run as an empty one.',
    '  b. jest failed before or during discovery: a configuration that does not compile, a',
    '     module that cannot be resolved from jest.config.ts, an out of memory kill, or a',
    '     timeout.',
    '',
    'Historic note, and it is history rather than diagnosis. Until PR 4 of the August 2026',
    'consolidation, jest.config.ts in this repository declared coverageThresholds instead of',
    'coverageThreshold and setupFilesAfterSetup instead of setupFilesAfterEnv, and the typed',
    'Config object rejects both, so jest died in its own parser on every run from June 2026.',
    'Those keys are corrected and scripts/ci/assert-foundations.mjs fails the Foundations job',
    'if either returns. If Foundations is green, that is not what happened here.',
    '',
    'Reproduce locally with the exact command CI ran:',
    '  npx jest --config jest.config.ts --ci --json --outputFile=jest-results.json',
  ];
  if (jestExitCode !== null) lines.splice(1, 0, `jest exited with code ${jestExitCode}.`);
  if (jestOutputPath && !existsSync(jestOutputPath)) {
    lines.push('');
    lines.push(`NOTE: the workflow was asked to capture jest's output at ${jestOutputPath} and`);
    lines.push('that file does not exist either, so the run cannot be classified from here at all.');
    lines.push('Check the "Run jest" step in .github/workflows/ci.yml still redirects into it.');
  } else if (!jestOutputPath) {
    lines.push('');
    lines.push('NOTE: this script was called without --jest-output, so it had no capture of');
    lines.push("jest's own output to classify the run with. The Tests job in ci.yml passes it.");
    lines.push('Without it an empty test run and a jest crash are indistinguishable from disk.');
  }
  die(lines);
}

let r;
try {
  r = JSON.parse(readFileSync(resultsPath, 'utf8'));
} catch (e) {
  die([`FAIL: ${resultsPath} is not valid JSON: ${e.message}`]);
}

const total = r.numTotalTests ?? 0;
const passed = r.numPassedTests ?? 0;
const failed = r.numFailedTests ?? 0;
const suites = r.numTotalTestSuites ?? 0;
const suitesFailed = r.numFailedTestSuites ?? 0;
const suitesRuntimeError = r.numRuntimeErrorTestSuites ?? 0;

console.log('Jest reported:');
console.log(`  suites            ${suites} total, ${suitesFailed} failed, ${suitesRuntimeError} could not run at all`);
console.log(`  tests             ${total} total, ${passed} passed, ${failed} failed`);
console.log(`  floor             ${minimumTests}`);

const problems = [];

/* Suites that could not be compiled or loaded. This is the exact shape of the failure */
/* this repository had: eight suites, zero tests, and a summary that reads as neutral.  */
if (suitesRuntimeError > 0) {
  const names = (r.testResults || [])
    .filter((t) => t.testExecError || (t.message && (t.assertionResults || []).length === 0))
    .map((t) => `    ${t.name || t.testFilePath}`)
    .slice(0, 12);
  problems.push(
    `${suitesRuntimeError} suite(s) could not be run at all. They failed to compile or load, so they contributed zero tests. ` +
      'A suite that cannot load is not a passing suite and it is not a neutral suite: it is a file that looks like coverage ' +
      'in a directory listing and provides none.' +
      (names.length ? `\n${names.join('\n')}` : '')
  );
}

/* A suite that loaded but contains no tests. Usually a describe block with everything */
/* skipped, or a file renamed out of the testMatch pattern.                            */
const emptySuites = (r.testResults || []).filter(
  (t) => !t.testExecError && (t.assertionResults || []).length === 0
);
if (emptySuites.length > 0 && suitesRuntimeError === 0) {
  problems.push(
    `${emptySuites.length} suite(s) loaded successfully and executed no tests:\n` +
      emptySuites.map((t) => `    ${t.name || t.testFilePath}`).join('\n')
  );
}

if (failed > 0) {
  problems.push(`${failed} test(s) failed. That is the ordinary case and the message is in the jest output above.`);
}

if (total < minimumTests) {
  problems.push(
    `${total} test(s) executed against a committed floor of ${minimumTests}. ` +
      'Tests have been removed, skipped, or excluded by a pattern change. If that is deliberate, ' +
      'lower the floor in the same pull request and say why in the pull request body, so the ' +
      'reduction is reviewed rather than absorbed.'
  );
}

if (problems.length) {
  die([
    'TESTS GATE FAILED.',
    '',
    ...problems.map((p, i) => `${i + 1}. ${p}\n`),
    'This gate exists because jest exiting non-zero and jest having tested something are',
    'different claims, and in this repository they have come apart in every way they can.',
  ]);
}

/* --------------------------------------------------------------- ratchet advice -- */

if (minimumTests > 0 && total > minimumTests * 1.25) {
  console.log('');
  console.log(`NOTE: ${total} tests executed against a floor of ${minimumTests}. Raise the floor in`);
  console.log('ci/test-floor.json so the coverage this repository has gained cannot be lost quietly.');
}

console.log('');
if (total === 0 && zeroWindowOpen) {
  console.log(`Tests gate passed under the dated zero floor: 0 tests executed, floor 0, window open until ${floor.expires}.`);
  console.log('This is not evidence that this repository is tested. It is evidence that the');
  console.log('window recorded in ci/test-floor.json has not closed yet.');
} else {
  console.log(`Tests gate passed: ${passed} test(s) executed and passed across ${suites} suite(s).`);
}
process.exit(0);
