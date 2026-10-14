import { config } from '../config.js';
import type { FastifyInstance } from 'fastify';
import { requireCsrf, requireRole } from '../auth/guard.js';
import { isRole, ROLES, ROLE_SUMMARY } from '../auth/roles.js';
import { users } from '../auth/users.js';
import { record } from '../publish/audit.js';
import { csrf } from '../views/components.js';
import { html, join, raw } from '../views/html.js';
import { page } from '../views/layout.js';
import { sendHtml, str, type FormBody } from './support.js';

/**
 * Role management. Admin only, and Admin means Admin.
 *
 * "Editor cannot change roles" is a requirement, and it is enforced in one place: the guard
 * below asks for the Admin role, server side, before anything is read or written. An Editor
 * is not shown this screen in the navigation either, but that is a courtesy and not the
 * control.
 *
 * GAP IN THE FROZEN CONTRACT, and it is the reason this screen is local rather than an API
 * call. The contract's section 5.3 gives Admin "user and role management" but the document
 * defines no user or role endpoint at any path. On the Trevean account roles come from the
 * `roles` claim on a token issued by the managed identity provider, so role management
 * belongs to that provider and this screen becomes a link into its console. That is a
 * decision for Dan rather than something to invent an endpoint for. See the README, "Gaps
 * found in the frozen contract".
 */

export async function registerUserRoutes(app: FastifyInstance): Promise<void> {
  app.get('/users', async (request, reply) => {
    const principal = requireRole(request, 'Admin');

    /*
     * Against the managed identity provider this screen has nothing to manage.
     *
     * It reads and writes the seeded development store, which is refused outside development,
     * so calling users() here threw and the Roles link in the navigation returned a 500 on the
     * deployed admin. The comment below always said this screen "becomes a link into that
     * console" on the Trevean account; it had simply never been made to do so.
     *
     * Roles live in Cognito groups and the admin reads them off the token. Changing one here
     * would be writing to a store nothing reads, which is worse than saying so.
     */
    if (!config.devIdentity) {
      const body = html`<section class="card narrow">
        <h1>Roles</h1>
        <div class="flash flash-warn">
          <b>Accounts are managed in AWS, not here</b>
          <p>
            Sign in, passwords and who holds which role are handled by Amazon Cognito. This
            screen manages the local development accounts only, and there are none on this
            environment.
          </p>
          <p>
            To add a colleague or change a password, ask your developer, or use the Cognito
            console for the user pool attached to this environment. The three groups are named
            Admin, Editor and Viewer, and the group a person is in is the role they get here.
          </p>
        </div>
        <p class="hint">
          You are signed in as ${principal.email} with the ${principal.role} role.
        </p>
      </section>`;
      return sendHtml(reply, page({ title: 'Roles', principal }, body));
    }

    const list = users().list();

    const body = html`<section class="card">
      <h1>Roles</h1>
      <div class="flash flash-warn">
        <b>This screen is the local development identity provider</b>
        <p>
          On the Trevean AWS account, roles come from the role claim on a token issued by the
          managed identity provider, and this screen becomes a link into that console. The
          frozen API contract defines no user or role endpoint, so nothing here is invented on
          top of it.
        </p>
      </div>
      <table class="grid">
        <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Change</th></tr></thead>
        <tbody>
          ${join(
            list.map(
              (u) => html`<tr>
                <td>${u.name}</td>
                <td><code>${u.email}</code></td>
                <td><span class="role role-${u.role}">${u.role}</span></td>
                <td>
                  <form method="post" action="/users/${u.subject}/role" class="inline">
                    ${csrf(request.session?.csrf)}
                    <select name="role">
                      ${join(
                        ROLES.map((r) => html`<option value="${r}"${r === u.role ? raw(' selected') : raw('')}>${r}</option>`),
                      )}
                    </select>
                    <button class="btn" type="submit">Set</button>
                  </form>
                </td>
              </tr>`,
            ),
          )}
        </tbody>
      </table>

      <h2>What each role can do</h2>
      <dl class="roles">
        ${join(ROLES.map((r) => html`<dt><span class="role role-${r}">${r}</span></dt><dd>${ROLE_SUMMARY[r]}</dd>`))}
      </dl>
      <p class="hint">Signed in as ${principal.email}.</p>
    </section>`;

    return sendHtml(reply, page({ title: 'Roles', principal, active: 'users' }, body));
  });

  app.post<{ Params: { subject: string } }>('/users/:subject/role', async (request, reply) => {
    const principal = requireRole(request, 'Admin');
    requireCsrf(request);
    const body = (request.body ?? {}) as FormBody;
    const role = str(body, 'role');
    if (!isRole(role)) {
      return sendHtml(
        reply,
        page({ title: 'Roles', principal, active: 'users' }, html`<section class="card"><div class="flash flash-error"><b>Unknown role</b></div></section>`),
        400,
      );
    }
    const outcome = users().setRole(request.params.subject, role);
    if (!outcome.ok) {
      return sendHtml(
        reply,
        page(
          { title: 'Roles', principal, active: 'users' },
          html`<section class="card"><div class="flash flash-error"><b>Not changed</b><p>${outcome.reason}</p></div><p><a class="btn" href="/users">Back to roles</a></p></section>`,
        ),
        409,
      );
    }
    record({
      event: 'role_change',
      subject: principal.subject,
      email: principal.email,
      role: principal.role,
      detail: { target: outcome.user.email, newRole: role },
    });
    return reply.redirect('/users', 302);
  });
}
