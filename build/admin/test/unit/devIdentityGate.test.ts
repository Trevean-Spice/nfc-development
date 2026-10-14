/*
 * The development identity provider must stay off unless somebody asks for it by name.
 *
 * WHY THIS FILE EXISTS. src/auth/users.ts seeds three accounts whose passwords are written
 * in the source file: admin-local-only, editor-local-only, viewer-local-only. It used to
 * refuse to load only when the stage was 'production'. Every deployed environment on this
 * project runs STAGE=staging, so the first public deployment of the admin would have put a
 * surface that edits and publishes content for 1,000 encoded jars on the internet behind a
 * password that is in the repository.
 *
 * Nothing was broken and every test passed, because the tests run at stage 'local' where the
 * behaviour is correct. The defect was only ever visible from the deployment side. Caught on
 * Tuesday 8 September 2026 while choosing where to host the admin, before it was hosted.
 *
 * These tests are about the DEFAULT. A gate that has to be switched off to be safe is not a
 * gate, so the thing asserted here is that the dangerous paths are dark unless lit.
 */

import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';

const base = { STAGE: 'staging' } as NodeJS.ProcessEnv;

describe('the development identity gate', () => {
  it('is off in a deployed stage that says nothing about it, which is the regression', () => {
    expect(loadConfig({ ...base }).devIdentity).toBe(false);
  });

  it('is off at every stage by default, including local, so the default is never dangerous', () => {
    for (const STAGE of ['local', 'staging', 'production']) {
      expect(loadConfig({ ...base, STAGE }).devIdentity).toBe(false);
    }
  });

  it('turns on only when asked for by name, and only away from production', () => {
    expect(loadConfig({ STAGE: 'local', ADMIN_DEV_IDENTITY: '1' }).devIdentity).toBe(true);
    expect(loadConfig({ STAGE: 'staging', ADMIN_DEV_IDENTITY: '1' }).devIdentity).toBe(true);
    expect(loadConfig({ STAGE: 'production', ADMIN_DEV_IDENTITY: '1' }).devIdentity).toBe(false);
  });

  it('refuses to mint its own API bearer tokens whenever the gate is shut', () => {
    expect(loadConfig({ ...base }).api.allowDevSigning).toBe(false);
    expect(loadConfig({ STAGE: 'production', ADMIN_DEV_IDENTITY: '1' }).api.allowDevSigning).toBe(false);
  });

  it('does not let AUTH_ALLOW_DEV_TOKENS reopen the gate on its own', () => {
    expect(loadConfig({ ...base, AUTH_ALLOW_DEV_TOKENS: '1' }).api.allowDevSigning).toBe(false);
  });
});
