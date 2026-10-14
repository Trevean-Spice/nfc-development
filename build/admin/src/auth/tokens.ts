import { SignJWT } from 'jose';
import { config } from '../config.js';
import type { Principal } from './roles.js';

/**
 * The bearer token the admin presents to the API.
 *
 * On the Trevean AWS account this comes from the managed identity provider and the admin
 * simply forwards it. There is no identity provider on a laptop, so locally the admin mints
 * the same shape of token with the symmetric development key the API already accepts in
 * `src/auth/jwt.ts`. That path is refused when the stage is production, here, in code.
 *
 * ONE RULE, and it is the whole reason this file is separate: the token carries exactly the
 * role the session holds, and the session's role is read back from the user store on every
 * request. There is no code path anywhere that mints a token for a role the caller does not
 * have. A privilege escalation in an admin tool is nearly always an escalation in the thing
 * that issues its credential, not in the thing that checks it.
 */

export async function mintApiToken(principal: Principal): Promise<string> {
  if (!config.api.allowDevSigning) {
    throw new Error(
      'Development token signing is disabled for this stage. The admin must present a token issued by the managed identity provider.',
    );
  }
  const key = new TextEncoder().encode(config.api.devSigningKey);
  return new SignJWT({ roles: [principal.role], email: principal.email })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(principal.subject)
    .setIssuer(config.api.issuer)
    .setAudience(config.api.audience)
    .setIssuedAt()
    .setExpirationTime(`${config.api.tokenTtlSeconds}s`)
    .sign(key);
}
