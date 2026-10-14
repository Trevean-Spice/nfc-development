/**
 * Three roles, per the Scope document, "In scope", row 3, and the frozen API contract,
 * section 5.3.
 *
 *   Viewer  read everything including drafts and analytics, write nothing
 *   Editor  everything Viewer can, plus create, edit, upload and publish
 *   Admin   everything Editor can, plus user and role management, plus the tag records
 *
 * This file is a byte for byte restatement of the API's own role model. It is duplicated
 * deliberately: the admin refuses first so a Viewer is never shown a button that produces
 * a 403, and the API refuses again because a browser is not a security boundary. Neither
 * check is decorative and removing either one is a defect.
 */

export const ROLES = ['Viewer', 'Editor', 'Admin'] as const;
export type Role = (typeof ROLES)[number];

const RANK: Record<Role, number> = { Viewer: 1, Editor: 2, Admin: 3 };

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

export function rankOf(role: Role): number {
  return RANK[role];
}

/** True when the held role is at least the required one. */
export function satisfies(held: Role, required: Role): boolean {
  return RANK[held] >= RANK[required];
}

export interface Principal {
  subject: string;
  email: string;
  name: string;
  role: Role;
}

/**
 * What each role may do, in the words shown to the person holding it. The sign in screen
 * and the role badge both read from this, so nobody has to guess what a Viewer is.
 */
export const ROLE_SUMMARY: Record<Role, string> = {
  Viewer:
    'Read everything, including drafts and analytics. Write nothing. Every editing control is absent rather than disabled, because a disabled button still reads as a promise.',
  Editor:
    'Everything a Viewer can do, plus create and edit blends, recipes and growers, upload media, and publish. Cannot manage roles and cannot edit the tag or redirect data.',
  Admin:
    'Everything an Editor can do, plus role management and read access to the tag records. The redirect table is still read only, for Admin as much as for anyone.',
};
