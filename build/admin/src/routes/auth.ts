import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';
import { newSession, encodeSession } from '../auth/session.js';
import { ROLE_SUMMARY, ROLES } from '../auth/roles.js';
import { authenticate } from '../auth/identity.js';
import { record } from '../publish/audit.js';
import { html, join } from '../views/html.js';
import { page } from '../views/layout.js';
import { sendHtml, str, type FormBody } from './support.js';

/**
 * Sign in.
 *
 * Against the Trevean AWS account this screen is replaced by a redirect to the managed
 * identity provider and the admin forwards the token it issues. Locally there is no
 * identity provider, so the development accounts below are used and the roles they carry
 * are the roles the API sees. The development accounts are refused when the stage is
 * production, in `auth/users.ts`.
 */

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { next?: string; error?: string } }>('/sign-in', async (request, reply) => {
    if (request.principal) return reply.redirect('/', 302);
    const next = request.query.next && request.query.next.startsWith('/') ? request.query.next : '/';
    const body = html`<section class="card narrow">
      <h1>Sign in</h1>
      ${request.query.error
        ? html`<div class="flash flash-error"><b>That did not work</b><p>${request.query.error}</p></div>`
        : ''}
      <form method="post" action="/sign-in">
        <input type="hidden" name="next" value="${next}" />
        <div class="field">
          <div class="field-head"><label for="email">Email</label></div>
          <input type="text" name="email" id="email" autocomplete="username" />
        </div>
        <div class="field">
          <div class="field-head"><label for="password">Password</label></div>
          <input type="password" name="password" id="password" autocomplete="current-password" />
        </div>
        <button class="btn primary" type="submit">Sign in</button>
      </form>

      ${config.devIdentity
        ? html`<h2>Development accounts</h2>
            <p class="hint">
              This is the local development identity provider. On the Trevean account these are
              replaced by the managed identity provider and the roles come from the token's role
              claim. See the frozen API contract, section 5.3.
            </p>
            <table class="grid">
              <thead><tr><th>Role</th><th>Email</th><th>Password</th><th>Can</th></tr></thead>
              <tbody>
                ${join(
                  ROLES.map(
                    (role) => html`<tr>
                      <td><span class="role role-${role}">${role}</span></td>
                      <td><code>${role.toLowerCase()}@treveanspice.com</code></td>
                      <td><code>${role.toLowerCase()}-local-only</code></td>
                      <td class="val">${ROLE_SUMMARY[role]}</td>
                    </tr>`,
                  ),
                )}
              </tbody>
            </table>`
        : ''}
    </section>`;
    return sendHtml(reply, page({ title: 'Sign in' }, body));
  });

  app.post('/sign-in', async (request, reply) => {
    const body = (request.body ?? {}) as FormBody;
    const email = str(body, 'email') ?? '';
    const password = str(body, 'password') ?? '';
    const next = str(body, 'next');
    // Goes to the seeded store on a laptop and to the Cognito user pool everywhere else.
    // See auth/identity.ts. The session, the CSRF token and every role check below this
    // line are unchanged by which one answered.
    const user = await authenticate(email, password);
    if (!user) {
      const message = encodeURIComponent('That email and password do not match an account.');
      return reply.redirect(`/sign-in?error=${message}`, 302);
    }
    const session = newSession(
      { subject: user.subject, email: user.email, name: user.name, role: user.role },
      user.apiToken,
    );
    reply.setCookie(config.session.cookieName, encodeSession(session), {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      // Secure everywhere except a laptop, and that is not the same as "production only".
      // It read `config.stage === 'production'` until Tuesday 8 September 2026, and every
      // deployed environment on this project runs STAGE=staging over HTTPS. So the session
      // cookie for a publicly reachable admin would have been sent without the Secure
      // attribute, which is the cookie that carries the right to publish. Keyed off local
      // instead, because local is the only place there is no TLS to insist on.
      secure: config.stage !== 'local',
      maxAge: config.session.ttlSeconds,
    });
    record({ event: 'sign_in', subject: user.subject, email: user.email, role: user.role, detail: {} });
    return reply.redirect(next && next.startsWith('/') ? next : '/', 302);
  });

  app.get('/sign-out', async (request, reply) => {
    reply.clearCookie(config.session.cookieName, { path: '/' });
    return reply.redirect('/sign-in', 302);
  });
}
