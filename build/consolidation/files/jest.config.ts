/**
 * Destination: jest.config.ts at the root of nfc-development. This is the whole file.
 *
 * FIVE CHANGES FROM THE VERSION AS INHERITED.
 *
 * 1. coverageThresholds -> coverageThreshold, and then removed entirely. See 4.
 *    The plural key is not a property of jest's Config type, so ts-jest failed to compile
 *    this file and jest exited before discovering a single test. Reproduced three times
 *    during the audit:
 *      TSError: jest.config.ts(27,3): error TS2561: Object literal may only specify known
 *      properties, but 'coverageThresholds' does not exist in type 'Partial<Config>'.
 *      Did you mean to write 'coverageThreshold'?
 *
 * 2. setupFilesAfterSetup -> setupFilesAfterEnv, and then removed entirely.
 *    Same class of error, and correcting only the first typo moves the failure rather
 *    than clearing it. The corrected key pointed at <rootDir>/tests/setup.ts, which does
 *    not exist, so the run would then have failed on a missing module. There is nothing
 *    for a setup file to do in this repository today, so the entry is removed rather than
 *    the file invented. Add it back when there is a reason.
 *
 * 3. @nfc/* is removed from moduleNameMapper. It maps to src/nfc/, a directory that does
 *    not exist. The eight deleted test suites imported through it, which is one of the
 *    reasons all eight failed to compile.
 *
 * 4. coverageThreshold is NOT carried forward, and this is a judgement rather than a
 *    typo fix. The inherited file demanded 80 percent lines and statements globally. The
 *    suite it demanded that of had never executed. Reinstating an 80 percent global
 *    threshold on the day the dead suite is deleted produces a gate that cannot be met
 *    for weeks, and a gate that cannot be met is a gate somebody disables. The instrument
 *    that replaces it is ci/test-floor.json, which asserts that tests actually executed,
 *    ratchets upward, and cannot sit at zero without a dated expiry.
 *    OWNER OF THIS JUDGEMENT: Serene Labs, technical. It needs no client decision.
 *    Revisit when the replacement suite is stable, and set the threshold from the number
 *    it actually achieves rather than from an aspiration.
 *
 * 5. passWithNoTests is set explicitly to false. It is already the default. It is written
 *    down because the default is the only thing standing between this repository and a
 *    green test job that ran nothing, and a default can be changed in a pull request
 *    without anyone reading a diff line that says so.
 */

import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts', '**/*.test.tsx'],

  moduleNameMapper: {
    '^@shared/(.*)$': '<rootDir>/src/shared/$1',
    '^@api/(.*)$': '<rootDir>/src/api/$1',
    '^@config/(.*)$': '<rootDir>/config/$1',
  },

  collectCoverageFrom: [
    'src/api/**/*.ts',
    'src/shared/**/*.ts',
    '!src/**/*.d.ts',
    '!src/**/index.ts',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'clover'],

  passWithNoTests: false,
  verbose: true,
};

export default config;
