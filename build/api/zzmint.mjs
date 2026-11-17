import { SignJWT } from 'jose';
const secret = new TextEncoder().encode('local-development-signing-key-not-for-any-real-environment');
const roles = process.argv[2].split(',');
console.log(await new SignJWT({ roles, email: 'audit@example.com' })
  .setProtectedHeader({ alg: 'HS256' })
  .setSubject('audit_' + roles.join('_'))
  .setIssuer('https://auth.local.treveanspice.com')
  .setAudience('trevean-admin')
  .setIssuedAt()
  .setExpirationTime('2h')
  .sign(secret));
