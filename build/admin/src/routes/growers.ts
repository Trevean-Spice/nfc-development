import type { FastifyInstance } from 'fastify';
import { may, requireCsrf, requireOperation, requireSignedIn } from '../auth/guard.js';
import { ApiError } from '../api/errors.js';
import type { Grower } from '../api/types.js';
import { scanForSentinels } from '../content/placeholder.js';
import { apiFailure, crumbs, csrf, field } from '../views/components.js';
import { html, join, type RawHtml } from '../views/html.js';
import { page } from '../views/layout.js';
import { apiFor, compact, intOf, nullable, num, sendHtml, text, type FormBody } from './support.js';

/**
 * Growers.
 *
 * This is the most dangerous record in the product and the editor says so on screen. A
 * fabricated grower, with a name, a farm, a portrait and a coordinate on a map, is
 * indistinguishable from a real one to everyone who sees it, survives a publish, and reaches
 * a page that a thousand shipped jars already point at.
 *
 * Two consequences are built into this screen rather than left to a policy document:
 *
 *   The coordinate fields carry the warning next to the input, not in a wiki. A coordinate
 *   renders as a pin and a pin reads as a fact.
 *
 *   A grower edit does not change any page already built, because the grower record is
 *   snapshotted into the page at build time. The API answers a grower update with the list
 *   of published blends that now hold a stale snapshot, and this screen shows that list with
 *   a republish action rather than leaving an editor to remember.
 */

function growerForm(
  request: { session?: { csrf: string } },
  grower: Grower | null,
  canEdit: boolean,
  republish: string[] = [],
): RawHtml {
  const hits = grower ? scanForSentinels(grower) : [];
  return html`<section class="card">
    ${crumbs([{ href: '/growers', label: 'Growers' }, { label: grower ? grower.name : 'New grower' }])}
    <h1>${grower ? grower.name : 'New grower'}</h1>

    ${republish.length > 0
      ? html`<div class="flash flash-warn">
          <b>These published blends now hold a stale grower snapshot</b>
          <p>The grower record is snapshotted into the page at build time, so the pages below still show what this grower said before your edit. Republish each one to update it.</p>
          <ul class="details">
            ${join(republish.map((slug) => html`<li><a href="/blends/${slug}/publish">${slug}</a></li>`))}
          </ul>
        </div>`
      : ''}

    ${hits.length > 0
      ? html`<div class="flash flash-warn">
          <b>This grower profile is placeholder content</b>
          <p>Nothing here is a real person. Publishing a blend that carries it puts a claim about Trevean's supply chain in front of a customer that nobody at Trevean made.</p>
        </div>`
      : ''}

    <form method="post" action="${grower ? `/growers/${grower.growerId}` : '/growers'}">
      ${csrf(request.session?.csrf)}
      ${grower ? html`<input type="hidden" name="version" value="${grower.version}" />` : ''}
      ${field({ name: 'name', label: 'Grower name', value: grower?.name ?? '', readOnly: !canEdit, maxLength: 160, hint: 'A real person or a real cooperative. Never a plausible one.' })}
      ${field({ name: 'farmName', label: 'Farm or cooperative name', value: grower?.farmName ?? '', readOnly: !canEdit, maxLength: 160 })}
      ${field({ name: 'country', label: 'Country (ISO 3166-1 alpha-2)', value: grower?.country ?? '', readOnly: !canEdit, maxLength: 2, hint: 'Where the blend is from is a fact about the spice. Where the grower is is a fact about a person. The second does not follow from the first.' })}
      ${field({ name: 'region', label: 'Region', value: grower?.region ?? '', readOnly: !canEdit, maxLength: 120 })}
      ${field({ name: 'bio', label: 'Profile copy', value: grower?.bio ?? '', readOnly: !canEdit, type: 'textarea', rows: 8, maxLength: 4000, hint: '600 to 900 characters. Under 600 reads as a caption rather than a profile. A portrait also needs the subject\'s written consent and a photographer credit before it can be published.' })}
      ${field({ name: 'yearsFarming', label: 'Years farming', value: grower?.yearsFarming ?? '', readOnly: !canEdit, type: 'number' })}
      ${field({ name: 'farm_latitude', label: 'Farm latitude', value: grower?.farm?.latitude ?? '', readOnly: !canEdit, type: 'number', hint: 'Leave empty rather than approximate. A coordinate renders as a pin on a map and a pin reads as a fact.' })}
      ${field({ name: 'farm_longitude', label: 'Farm longitude', value: grower?.farm?.longitude ?? '', readOnly: !canEdit, type: 'number' })}
      ${grower
        ? field({
            name: 'blendSlugs',
            label: 'Blends this grower supplies',
            value: (grower.blendSlugs ?? []).join(', ') || 'none',
            readOnly: true,
            hint: 'Maintained by the API whenever a blend changes its grower. It is what lets this tool say which pages need republishing.',
          })
        : ''}
      ${canEdit ? html`<div class="formfoot"><button class="btn primary" type="submit">${grower ? 'Save grower' : 'Create grower'}</button></div>` : ''}
    </form>
  </section>`;
}

export async function registerGrowerRoutes(app: FastifyInstance): Promise<void> {
  app.get('/growers', async (request, reply) => {
    const principal = requireSignedIn(request);
    const api = apiFor(request);
    let growers: Grower[] = [];
    let failure: RawHtml | undefined;
    try {
      growers = (await api.listGrowers({ limit: 100 })).data;
    } catch (err) {
      failure = apiFailure(err);
    }
    const body = html`<section class="card">
      <div class="head">
        <h1>Growers</h1>
        ${may(principal, 'adminCreateGrower') ? html`<a class="btn" href="/growers/new">New grower</a>` : ''}
      </div>
      ${failure ?? ''}
      <table class="grid">
        <thead><tr><th>Name</th><th>Farm</th><th>Where</th><th>Blends</th><th>Content</th><th>Version</th></tr></thead>
        <tbody>
          ${join(
            growers.map(
              (g) => html`<tr>
                <td><a href="/growers/${g.growerId}">${g.name}</a></td>
                <td>${g.farmName ?? ''}</td>
                <td>${[g.region, g.country].filter(Boolean).join(', ') || 'not supplied'}</td>
                <td>${(g.blendSlugs ?? []).join(', ') || 'none'}</td>
                <td>
                  ${scanForSentinels(g).length > 0
                    ? html`<span class="chip chip-placeholder_text">Placeholder</span>`
                    : html`<span class="chip chip-client_real">Real</span>`}
                </td>
                <td>${g.version}</td>
              </tr>`,
            ),
          )}
        </tbody>
      </table>
      ${growers.length === 0 && !failure ? html`<p class="empty">No growers returned by the API.</p>` : ''}
    </section>`;
    return sendHtml(reply, page({ title: 'Growers', principal, active: 'growers' }, body));
  });

  app.get('/growers/new', async (request, reply) => {
    const principal = requireOperation(request, 'adminCreateGrower');
    return sendHtml(reply, page({ title: 'New grower', principal, active: 'growers' }, growerForm(request, null, true)));
  });

  app.post('/growers', async (request, reply) => {
    const principal = requireOperation(request, 'adminCreateGrower');
    requireCsrf(request);
    const api = apiFor(request);
    try {
      const created = await api.createGrower(compact(growerPayload(request.body as FormBody)));
      return reply.redirect(`/growers/${created.growerId}`, 302);
    } catch (err) {
      return sendHtml(
        reply,
        page({ title: 'New grower', principal, active: 'growers' }, html`<section class="card">${apiFailure(err)}<p><a href="/growers/new">Back to the form</a></p></section>`),
        err instanceof ApiError ? err.status : 500,
      );
    }
  });

  app.get<{ Params: { growerId: string } }>('/growers/:growerId', async (request, reply) => {
    const principal = requireSignedIn(request);
    const api = apiFor(request);
    try {
      const grower = await api.getGrower(request.params.growerId);
      return sendHtml(
        reply,
        page({ title: grower.name, principal, active: 'growers' }, growerForm(request, grower, may(principal, 'adminUpdateGrower'))),
      );
    } catch (err) {
      return sendHtml(
        reply,
        page({ title: 'Grower', principal, active: 'growers' }, html`<section class="card">${apiFailure(err)}</section>`),
        err instanceof ApiError ? err.status : 500,
      );
    }
  });

  app.post<{ Params: { growerId: string } }>('/growers/:growerId', async (request, reply) => {
    const principal = requireOperation(request, 'adminUpdateGrower');
    requireCsrf(request);
    const body = (request.body ?? {}) as FormBody;
    const api = apiFor(request);
    try {
      const updated = await api.updateGrower(
        request.params.growerId,
        compact({ version: intOf(body, 'version'), ...growerPayload(body) }),
      );
      return sendHtml(
        reply,
        page(
          { title: updated.name, principal, active: 'growers', flash: [{ kind: 'ok', title: 'Saved.' }] },
          growerForm(request, updated, true, updated.republishRequiredFor ?? []),
        ),
      );
    } catch (err) {
      return sendHtml(
        reply,
        page({ title: 'Grower', principal, active: 'growers' }, html`<section class="card"><h1>Nothing was saved</h1>${apiFailure(err)}<p><a class="btn" href="/growers/${request.params.growerId}">Back to the grower</a></p></section>`),
        err instanceof ApiError ? err.status : 500,
      );
    }
  });
}

function growerPayload(body: FormBody): Record<string, unknown> {
  const latitude = num(body, 'farm_latitude');
  const longitude = num(body, 'farm_longitude');
  return {
    name: text(body, 'name'),
    farmName: nullable(body, 'farmName'),
    country: nullable(body, 'country'),
    region: nullable(body, 'region'),
    bio: nullable(body, 'bio'),
    yearsFarming: intOf(body, 'yearsFarming'),
    farm: typeof latitude === 'number' && typeof longitude === 'number' ? { latitude, longitude } : null,
  };
}
