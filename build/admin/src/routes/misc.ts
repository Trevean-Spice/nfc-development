import type { FastifyInstance } from 'fastify';
import { requireSignedIn } from '../auth/guard.js';
import { config } from '../config.js';
import { contract } from '../contract.js';
import { readiness } from '../content/readiness.js';
import { recent } from '../publish/audit.js';
import { html, join } from '../views/html.js';
import { page } from '../views/layout.js';
import { sendHtml } from './support.js';

/**
 * Content readiness, the audit trail, the authorisation matrix and a health check.
 *
 * The content readiness screen exists because "when does the placeholder banner go away" is
 * the question the client will ask, and the answer should be a screen rather than a person.
 * The authorisation matrix screen exists because a claim about who can do what is worth
 * being able to check against the frozen contract in one glance rather than reading code.
 */

export async function registerMiscRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async (_request, reply) => {
    return reply.send({ status: 'ok', stage: config.stage, api: config.apiBaseUrl, contract: contract().version });
  });

  app.get('/content-readiness', async (request, reply) => {
    const principal = requireSignedIn(request);
    const source = readiness();

    const body = html`<section class="card">
      <h1>Content readiness</h1>
      ${source.available
        ? html`<p class="hint">
            Read from the content package, convention version ${source.conventionVersion}, as of
            ${source.asOf}. Content for the two launch blends was due from Trevean on
            ${source.contentDueFromClient}.
          </p>`
        : html`<div class="flash flash-error">
            <b>The content package could not be read</b>
            <p>${source.unavailableReason}</p>
            <p class="hint">
              Until it can be, every field Trevean owns and that is required to publish counts as
              unverified, which blocks publish exactly as a known placeholder does. Being wrong in
              that direction costs an unnecessary refusal. Being wrong the other way ships a
              fabricated grower.
            </p>
          </div>`}

      <h2>The convention this tool enforces</h2>
      <ul class="prose">
        <li>Every placeholder string carries the marker <code>${source.sentinel}</code> and the phrase <code>${source.secondaryMarker}</code>. The marker travels with the value, so it survives a copy into a deck, an export, a screenshot and a page render.</li>
        <li>Where a value would be a claim about a person, a place, a date, a price or a food, no value is invented at all. The field is held empty and the page says so.</li>
        <li>A coordinate is the most dangerous placeholder in the set, because it renders as a pin on a map and a pin reads as a fact.</li>
        <li>Publishing anything still marked placeholder needs a typed phrase, a written reason and an acknowledgement, recorded against a name. There is no environment variable that turns the guard off, because a convention with a manual off switch is a convention that gets switched off on the wrong day.</li>
      </ul>

      <h2>Fields per entity in the specification</h2>
      <table class="grid">
        <thead><tr><th>Entity</th><th>Field</th><th>Owner</th><th>Required to publish</th><th>Guidance</th></tr></thead>
        <tbody>
          ${join(
            (['blend', 'grower', 'recipe'] as const).flatMap((entity) =>
              source.fields[entity].map(
                (f) => html`<tr>
                  <td>${entity}</td>
                  <td>${f.label}<br /><code>${f.path}</code></td>
                  <td>${f.owner}</td>
                  <td>${f.requiredForPublish ? 'yes' : 'no'}</td>
                  <td class="val">${f.guidance ?? ''}</td>
                </tr>`,
              ),
            ),
          )}
        </tbody>
      </table>
    </section>`;

    return sendHtml(reply, page({ title: 'Content readiness', principal, active: 'readiness', wide: true }, body));
  });

  app.get('/audit', async (request, reply) => {
    const principal = requireSignedIn(request);
    const entries = recent(100);
    const body = html`<section class="card">
      <h1>Audit</h1>
      <p class="hint">
        Publishes, blocked publishes, placeholder overrides, manual revalidations and role
        changes, newest first. An override is a person deciding in writing that content which
        is not real may reach a page a thousand shipped jars point at, so it is recorded with a
        name against it.
      </p>
      <table class="grid">
        <thead><tr><th>When</th><th>Event</th><th>Who</th><th>Blend</th><th>Detail</th></tr></thead>
        <tbody>
          ${join(
            entries.map(
              (e) => html`<tr class="${e.event === 'placeholder_override' ? 'row-blocking' : ''}">
                <td>${e.at}</td>
                <td>${e.event.replace(/_/g, ' ')}</td>
                <td>${e.email} <span class="role role-${e.role}">${e.role}</span></td>
                <td>${e.slug ?? ''}</td>
                <td class="val"><code>${JSON.stringify(e.detail)}</code></td>
              </tr>`,
            ),
          )}
        </tbody>
      </table>
      ${entries.length === 0 ? html`<p class="empty">Nothing recorded in this process yet.</p>` : ''}
    </section>`;
    return sendHtml(reply, page({ title: 'Audit', principal, active: 'audit', wide: true }, body));
  });

  app.get('/authorisation', async (request, reply) => {
    const principal = requireSignedIn(request);
    const operations = contract().adminOperations();
    const body = html`<section class="card">
      <h1>Authorisation</h1>
      <p class="hint">
        Every row is read from <code>x-minimum-role</code> in the frozen OpenAPI document at
        startup. Nothing in this application retypes it, so this table cannot drift from the
        contract the API enforces.
      </p>
      <table class="grid">
        <thead><tr><th>Operation</th><th>Method</th><th>Path</th><th>Minimum role</th><th>You</th></tr></thead>
        <tbody>
          ${join(
            operations.map(
              (op) => html`<tr>
                <td><code>${op.operationId}</code></td>
                <td>${op.method}</td>
                <td><code>${op.path}</code></td>
                <td><span class="role role-${op.minimumRole ?? 'Viewer'}">${op.minimumRole ?? 'undeclared'}</span></td>
                <td>${contractAllows(principal.role, op.minimumRole) ? 'allowed' : 'refused'}</td>
              </tr>`,
            ),
          )}
        </tbody>
      </table>
    </section>`;
    return sendHtml(reply, page({ title: 'Authorisation', principal, active: '', wide: true }, body));
  });
}

function contractAllows(held: string, required: string | null): boolean {
  const rank: Record<string, number> = { Viewer: 1, Editor: 2, Admin: 3 };
  return (rank[held] ?? 0) >= (rank[required ?? 'Viewer'] ?? 1);
}
