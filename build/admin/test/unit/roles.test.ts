import { describe, expect, it } from 'vitest';
import { isRole, ROLES, satisfies } from '../../src/auth/roles.js';
import { encodeSession, decodeSession, newSession } from '../../src/auth/session.js';

describe('the role model', () => {
  it('is exactly three roles', () => {
    expect([...ROLES]).toEqual(['Viewer', 'Editor', 'Admin']);
  });

  it('ranks them so that each contains the one below it', () => {
    expect(satisfies('Viewer', 'Viewer')).toBe(true);
    expect(satisfies('Viewer', 'Editor')).toBe(false);
    expect(satisfies('Viewer', 'Admin')).toBe(false);

    expect(satisfies('Editor', 'Viewer')).toBe(true);
    expect(satisfies('Editor', 'Editor')).toBe(true);
    expect(satisfies('Editor', 'Admin')).toBe(false);

    expect(satisfies('Admin', 'Viewer')).toBe(true);
    expect(satisfies('Admin', 'Editor')).toBe(true);
    expect(satisfies('Admin', 'Admin')).toBe(true);
  });

  it('does not recognise a role it has never heard of', () => {
    expect(isRole('Superuser')).toBe(false);
    expect(isRole('admin')).toBe(false);
    expect(isRole(undefined)).toBe(false);
  });
});

describe('sessions', () => {
  const principal = { subject: 'usr_1', email: 'a@treveanspice.com', name: 'A', role: 'Viewer' as const };

  it('round trip', () => {
    const session = newSession(principal);
    const decoded = decodeSession(encodeSession(session));
    expect(decoded?.subject).toBe('usr_1');
    expect(decoded?.role).toBe('Viewer');
  });

  it('a body edited to claim Admin fails the signature', () => {
    const cookie = encodeSession(newSession(principal));
    const [body, signature] = cookie.split('.');
    const payload = JSON.parse(Buffer.from(body as string, 'base64url').toString('utf8')) as Record<string, unknown>;
    payload['role'] = 'Admin';
    const forged = `${Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')}.${signature}`;
    expect(decodeSession(forged)).toBeUndefined();
  });

  it('an expired session is not a session', () => {
    const session = newSession(principal);
    session.expiresAt = Date.now() - 1000;
    expect(decodeSession(encodeSession(session))).toBeUndefined();
  });

  it('a cookie with no signature at all is refused', () => {
    expect(decodeSession('nonsense')).toBeUndefined();
    expect(decodeSession(undefined)).toBeUndefined();
  });
});

describe('STAGE is a closed set, because every development affordance is gated on it', () => {
  /**
   * The local development identity provider with its published passwords, the symmetric
   * signing key whose default is printed in config.ts, and the `secure` flag on the session
   * cookie are all gated on a comparison against the exact string 'production'.
   *
   * `STAGE=prod` is not 'production'. Before this was closed, that one misspelling left the
   * seeded accounts live and the session signed with a key that is in the repository, which
   * is enough for anyone who can read the repository to forge an Admin session cookie.
   */
  it('refuses a stage it does not recognise rather than treating it as non production', async () => {
    const { loadConfig } = await import('../../src/config.js');
    for (const bad of ['prod', 'Production', 'PRODUCTION', 'live', 'stage']) {
      expect(() => loadConfig({ ...process.env, STAGE: bad })).toThrowError(/not a recognised stage/);
    }
  });

  it('accepts the three it does, and defaults an unset value to local', async () => {
    const { loadConfig, STAGES } = await import('../../src/config.js');
    expect(STAGES).toEqual(['local', 'staging', 'production']);
    for (const good of STAGES) {
      expect(loadConfig({ ...process.env, STAGE: good }).stage).toBe(good);
    }
    const unset = { ...process.env };
    delete unset['STAGE'];
    expect(loadConfig(unset).stage).toBe('local');
  });

  it('never signs its own API tokens on a production stage', async () => {
    const { loadConfig } = await import('../../src/config.js');
    const cfg = loadConfig({ ...process.env, STAGE: 'production', AUTH_ALLOW_DEV_TOKENS: 'true' });
    expect(cfg.api.allowDevSigning).toBe(false);
  });
});
