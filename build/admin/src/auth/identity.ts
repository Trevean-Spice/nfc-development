import {
  AdminInitiateAuthCommand,
  AdminListGroupsForUserCommand,
  CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider';
import { config } from '../config.js';
import { isRole, type Role } from './roles.js';
import { users } from './users.js';

/**
 * Who is signing in, and where that answer comes from.
 *
 * There are two providers and exactly one of them is reachable in any given environment.
 *
 * On a laptop, the seeded store in users.ts, which exists so a developer can work without an
 * AWS account. It carries passwords written in the source file and is refused unless
 * ADMIN_DEV_IDENTITY is set, which no deployed environment sets.
 *
 * Everywhere else, a Cognito user pool. That is the "managed identity provider" the frozen
 * API contract, section 5.3, says roles come from. Passwords live in Cognito and never in
 * this repository, the password policy and lockout are Cognito's, and adding or removing a
 * person is a console operation rather than a deployment.
 *
 * WHY COGNITO'S API RATHER THAN ITS HOSTED LOGIN PAGE. This admin already has a sign in form,
 * a signed session cookie, a CSRF token on every write and role enforcement in three
 * independent places, with 105 tests behind the role half alone. Moving to the hosted page
 * would mean an OIDC redirect flow, a callback route and a token exchange, and would replace
 * machinery that is tested and working with machinery that is neither. So the form stays and
 * only the credential check changes: Cognito verifies the password, Cognito groups carry the
 * role, and everything downstream of the session is untouched.
 *
 * THE ROLE IS READ FROM COGNITO GROUPS AND IS NEVER DEFAULTED. A user in no recognised group
 * is refused rather than admitted as a Viewer. An identity provider that hands out a role to
 * anyone who authenticates is not enforcing anything, and Viewer is still a person who can
 * read unpublished content.
 */

export interface Identity {
  subject: string;
  email: string;
  name: string;
  role: Role;
  /**
   * The provider's own token, to be presented to the API. Absent for the seeded store, where
   * the admin mints one with the symmetric development key instead.
   */
  apiToken?: string;
}

let clientInstance: CognitoIdentityProviderClient | undefined;

function client(): CognitoIdentityProviderClient {
  if (!clientInstance) {
    clientInstance = new CognitoIdentityProviderClient({ region: config.cognito.region });
  }
  return clientInstance;
}

/** The first recognised group wins, and Admin outranks Editor outranks Viewer. */
function roleFromGroups(groups: string[]): Role | undefined {
  for (const candidate of ['Admin', 'Editor', 'Viewer']) {
    if (groups.includes(candidate) && isRole(candidate)) return candidate;
  }
  return undefined;
}

async function authenticateWithCognito(email: string, password: string): Promise<Identity | undefined> {
  const { userPoolId, clientId } = config.cognito;
  if (!userPoolId || !clientId) return undefined;

  try {
    const auth = await client().send(
      new AdminInitiateAuthCommand({
        UserPoolId: userPoolId,
        ClientId: clientId,
        AuthFlow: 'ADMIN_USER_PASSWORD_AUTH',
        AuthParameters: { USERNAME: email, PASSWORD: password },
      }),
    );

    // A challenge is not a session. NEW_PASSWORD_REQUIRED and MFA both land here, and
    // treating either as a successful sign in would be an authentication bypass. The admin
    // has no screen for them yet, so it refuses and says so rather than guessing.
    if (auth.ChallengeName) return undefined;
    if (!auth.AuthenticationResult) return undefined;

    const groups = await client().send(
      new AdminListGroupsForUserCommand({ UserPoolId: userPoolId, Username: email }),
    );
    const names = (groups.Groups ?? []).map((g) => g.GroupName ?? '').filter(Boolean);
    const role = roleFromGroups(names);
    if (!role) return undefined;

    // The id token rather than the access token: Cognito puts the group membership and the
    // email on the id token, and the API reads roles from `cognito:groups`.
    return { subject: email, email, name: email, role, apiToken: auth.AuthenticationResult.IdToken };
  } catch {
    // Cognito distinguishes "no such user" from "wrong password" and this deliberately does
    // not: both are the same refusal to the caller, so the sign in form cannot be used to
    // discover which addresses have accounts.
    return undefined;
  }
}

export async function authenticate(email: string, password: string): Promise<Identity | undefined> {
  if (config.devIdentity) {
    const user = users().authenticate(email, password);
    if (!user) return undefined;
    return { subject: user.subject, email: user.email, name: user.name, role: user.role };
  }
  return authenticateWithCognito(email, password);
}

/** True when this environment has a working way to sign somebody in. */
export function identityConfigured(): boolean {
  if (config.devIdentity) return true;
  return Boolean(config.cognito.userPoolId && config.cognito.clientId);
}
