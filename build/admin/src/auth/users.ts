import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from '../config.js';
import { isRole, type Role } from './roles.js';

/**
 * The local development identity provider.
 *
 * IN PRODUCTION THIS FILE IS NOT THE SOURCE OF ROLES. Tokens are issued by the managed
 * identity provider on the Trevean AWS account and carry a `roles` claim, per the frozen
 * API contract, section 5.3. The frozen contract has no user or role management endpoint,
 * so role management is an identity provider concern and not an API one. This store exists
 * so the admin runs, and so role enforcement is testable, on a laptop with no AWS account.
 *
 * The seeded accounts below are development accounts with published passwords. They are
 * refused outright when the stage is production, in this file, not by configuration.
 */

export interface UserRecord {
  subject: string;
  email: string;
  name: string;
  role: Role;
  /** Salted SHA-256. Adequate for a local development identity provider and nothing else. */
  passwordSalt: string;
  passwordHash: string;
  createdAt: string;
  updatedAt: string;
}

export interface UserView {
  subject: string;
  email: string;
  name: string;
  role: Role;
  updatedAt: string;
}

const SEED: Array<{ email: string; name: string; role: Role; password: string }> = [
  { email: 'admin@treveanspice.com', name: 'Dan (Admin)', role: 'Admin', password: 'admin-local-only' },
  { email: 'editor@treveanspice.com', name: 'Marketing (Editor)', role: 'Editor', password: 'editor-local-only' },
  { email: 'viewer@treveanspice.com', name: 'Marketing (Viewer)', role: 'Viewer', password: 'viewer-local-only' },
];

function hash(password: string, salt: string): string {
  return createHash('sha256').update(`${salt}:${password}`).digest('hex');
}

function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function newUser(email: string, name: string, role: Role, password: string): UserRecord {
  const salt = randomBytes(16).toString('hex');
  const at = nowIso();
  return {
    subject: `usr_${createHash('sha256').update(email).digest('hex').slice(0, 24)}`,
    email,
    name,
    role,
    passwordSalt: salt,
    passwordHash: hash(password, salt),
    createdAt: at,
    updatedAt: at,
  };
}

export class UserStore {
  private users: UserRecord[] = [];

  constructor(private readonly file: string) {
    this.load();
  }

  private load(): void {
    if (!config.devIdentity) {
      throw new Error(
        'The local development identity provider is refused unless ADMIN_DEV_IDENTITY is set, ' +
          'which no deployed environment sets. The accounts in this file have passwords written ' +
          'in the source, so reaching this path from anything with a public address would put a ' +
          'surface that can publish to 1,000 encoded jars behind a password in the repository. ' +
          'Roles come from the managed identity provider, per the frozen API contract, section 5.3.',
      );
    }
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as { users?: UserRecord[] };
      this.users = (parsed.users ?? []).filter((u) => isRole(u.role));
      if (this.users.length > 0) return;
    } catch {
      // No file yet, or an unreadable one. Either way the seed below is the answer.
    }
    this.users = SEED.map((s) => newUser(s.email, s.name, s.role, s.password));
    this.persist();
  }

  private persist(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, `${JSON.stringify({ users: this.users }, null, 2)}\n`, 'utf8');
  }

  list(): UserView[] {
    return this.users
      .map((u) => ({ subject: u.subject, email: u.email, name: u.name, role: u.role, updatedAt: u.updatedAt }))
      .sort((a, b) => a.email.localeCompare(b.email));
  }

  find(subject: string): UserRecord | undefined {
    return this.users.find((u) => u.subject === subject);
  }

  authenticate(email: string, password: string): UserRecord | undefined {
    const user = this.users.find((u) => u.email.toLowerCase() === email.trim().toLowerCase());
    if (!user) return undefined;
    const expected = Buffer.from(user.passwordHash, 'hex');
    const supplied = Buffer.from(hash(password, user.passwordSalt), 'hex');
    if (expected.length !== supplied.length) return undefined;
    return timingSafeEqual(expected, supplied) ? user : undefined;
  }

  /**
   * Change a role. The caller is checked by the route guard, not here, but the one rule
   * that belongs with the data is enforced here as well: the last Admin cannot be demoted,
   * because an admin tool with no Admin left in it needs a database edit to recover.
   */
  setRole(subject: string, role: Role): { ok: true; user: UserView } | { ok: false; reason: string } {
    const user = this.find(subject);
    if (!user) return { ok: false, reason: 'No such user.' };
    if (user.role === 'Admin' && role !== 'Admin' && this.users.filter((u) => u.role === 'Admin').length <= 1) {
      return { ok: false, reason: 'This is the last Admin. Promote somebody else before demoting this account.' };
    }
    user.role = role;
    user.updatedAt = nowIso();
    this.persist();
    return { ok: true, user: { subject: user.subject, email: user.email, name: user.name, role: user.role, updatedAt: user.updatedAt } };
  }
}

let store: UserStore | undefined;

export function users(): UserStore {
  if (!store) store = new UserStore(config.users.file);
  return store;
}

/** Test seam. */
export function setUserStore(value: UserStore | undefined): void {
  store = value;
}
