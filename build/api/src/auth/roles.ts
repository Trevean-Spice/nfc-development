/**
 * Three roles, per the Scope document, "In scope", row 3, and the API contract,
 * section 5.3.
 *
 *   Viewer  read everything including drafts and analytics, write nothing
 *   Editor  everything Viewer can, plus create, edit, upload and publish
 *   Admin   everything Editor can, plus user and role management, plus tag records
 *
 * The redirect table is not editable through this API by anyone, including Admin. It is a
 * version controlled artifact deployed with the application. A thousand encoded and
 * possibly write protected tags resolve through it, so a change to it is a code review and
 * a deployment, not a form submission.
 */

export const ROLES = ['Viewer', 'Editor', 'Admin'] as const;
export type Role = (typeof ROLES)[number];

const RANK: Record<Role, number> = { Viewer: 1, Editor: 2, Admin: 3 };

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

export function highestRole(roles: Role[]): Role {
  return roles.reduce<Role>((best, r) => (RANK[r] > RANK[best] ? r : best), 'Viewer');
}

export function satisfies(actual: Role[], required: Role): boolean {
  return actual.some((r) => RANK[r] >= RANK[required]);
}

export interface Principal {
  subject: string;
  email: string | undefined;
  roles: Role[];
}
