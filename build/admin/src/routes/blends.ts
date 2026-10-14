import type { FastifyInstance } from 'fastify';
import { may, requireCsrf, requireOperation, requireSignedIn } from '../auth/guard.js';
import { ApiError } from '../api/errors.js';
import type { Blend, BlendSummary, Grower, Media, Recipe } from '../api/types.js';
import { reportForBlend, summaryHasPlaceholder } from '../content/placeholder.js';
import type { Finding } from '../content/placeholder.js';
import { evaluate, OVERRIDE_WARNING } from '../publish/guard.js';
import { record } from '../publish/audit.js';
import { verifyPublished } from '../publish/verify.js';
import { confirmThroughPipeline, describe as describePipeline, fetchJob } from '../publish/publisher.js';
import type { PipelineResult } from '../publish/publisher.js';
import { renderPreview } from '../preview/render.js';
import { config } from '../config.js';
import { apiFailure, crumbs, csrf, field, findingsTable, placeholderBanner, statusPill } from '../views/components.js';
import { html, join, raw, type RawHtml } from '../views/html.js';
import { page, type Flash } from '../views/layout.js';
import {
  apiFor,
  compact,
  checked,
  indexed,
  intOf,
  nullable,
  num,
  sendHtml,
  str,
  text,
  type FormBody,
} from './support.js';

/**
 * Blend editing, preview and publish.
 *
 * Two things in this file are load bearing beyond the obvious:
 *
 *   The slug is never editable. A thousand encoded tags resolve to it through the redirect
 *   table, so changing a slug does not rename a page, it strands inventory. The frozen
 *   contract leaves slug out of BlendUpdate for the same reason and this form does not
 *   offer it.
 *
 *   Saving never publishes. Publish is a separate operation behind a separate screen, so an
 *   accidental save can never put a page live. That is the contract's shape and it is
 *   reproduced here rather than smoothed over with a "save and publish" button.
 */

function findingFor(findings: Finding[], path: string, entity = 'blend'): Finding | undefined {
  return findings.find((f) => f.entity === entity && f.path === path);
}

function fieldState(findings: Finding[], path: string, entity = 'blend') {
  const found = findingFor(findings, path, entity);
  return { state: found?.state, blocking: found?.blocksPublish ?? false };
}

export async function registerBlendRoutes(app: FastifyInstance): Promise<void> {
  // The blend list, which is the home screen.
  app.get('/', async (request, reply) => {
    const principal = requireOperation(request, 'adminListBlends');
    const api = apiFor(request);
    let blends: BlendSummary[] = [];
    let failure: RawHtml | undefined;
    try {
      blends = (await api.listBlends({ limit: 100 })).data;
    } catch (err) {
      failure = apiFailure(err);
    }

    const canCreate = may(principal, 'adminCreateBlend');

    const body = html`<section class="card">
      <div class="head">
        <h1>Blends</h1>
        ${canCreate ? html`<a class="btn" href="/blends/new">New blend</a>` : ''}
      </div>
      ${failure ?? ''}
      <p class="hint">
        Five blends, four of them with tags already encoded and shipped. The tag code column is
        the code on the physical jar. It is read only everywhere in this tool.
      </p>
      <table class="grid">
        <thead>
          <tr><th>Blend</th><th>Status</th><th>Tier</th><th>Tag code</th><th>Recipes</th><th>Version</th><th>Content</th><th>Updated</th><th></th></tr>
        </thead>
        <tbody>
          ${join(
            blends.map(
              (b) => html`<tr>
                <td><a href="/blends/${b.slug}"><b>${b.name}</b></a><br /><code>${b.slug}</code></td>
                <td>${statusPill(b.status)}</td>
                <td>${b.launchTier}</td>
                <td><code>${b.tagCode ?? 'none'}</code></td>
                <td>${b.recipeCount ?? 0}</td>
                <td>${b.version}</td>
                <td>
                  ${summaryHasPlaceholder(b, b.slug)
                    ? html`<span class="chip chip-placeholder_text">Placeholder</span>`
                    : html`<span class="chip chip-client_real">Real</span>`}
                </td>
                <td class="hint">${b.updatedAt}</td>
                <td><a href="/blends/${b.slug}/preview">Preview</a></td>
              </tr>`,
            ),
          )}
        </tbody>
      </table>
      ${blends.length === 0 && !failure ? html`<p class="empty">No blends returned by the API.</p>` : ''}
    </section>`;

    return sendHtml(reply, page({ title: 'Blends', principal, active: 'blends' }, body));
  });

  // Create a blend.
  app.get('/blends/new', async (request, reply) => {
    const principal = requireOperation(request, 'adminCreateBlend');
    const body = html`<section class="card narrow">
      ${crumbs([{ href: '/', label: 'Blends' }, { label: 'New' }])}
      <h1>New blend</h1>
      <p class="hint">
        A blend is always created as a draft. Creating never publishes.
      </p>
      <!--
        The slug was a dropdown of the five slugs the redirect table resolves, which made a
        sixth blend impossible to create at all. Dan hit that on Tuesday 8 September 2026
        trying to add a test blend and could not get past the first field.

        It is a free text field now, and that is safe rather than lax. The API validates the
        format against the frozen contract, so a malformed slug is refused at the source of
        truth rather than by a list retyped here. And a blend whose slug is not in the
        redirect table is simply not reachable by tapping a tag: it is an ordinary unreachable
        draft, not a broken one. The dangerous direction is the opposite one, an encoded code
        with no page, and that is guarded in build/edge by a build that refuses to deploy.

        The five that tags resolve to are named in the hint rather than enforced, because
        telling somebody why a choice matters outlasts preventing the choice.
      -->
      <form method="post" action="/blends">
        ${csrf(request.session?.csrf)}
        ${field({
          name: 'slug',
          label: 'Slug',
          readOnly: false,
          maxLength: 80,
          hint: 'Lowercase words joined by hyphens, and not editable afterwards. Tags already resolve to persian-sunrise, caribbean-sunset, silk-road, north-african-night-market and kyoto-garden. Any other slug is a blend no tag can reach yet.',
        })}
        ${field({ name: 'name', label: 'Blend name', readOnly: false, maxLength: 120 })}
        ${field({ name: 'tagline', label: 'Tagline', readOnly: false, maxLength: 200, hint: '40 to 120 characters. Longer wraps to three lines at 375 px and pushes the story below the fold.' })}
        ${field({
          name: 'launchTier',
          label: 'Launch tier',
          readOnly: false,
          type: 'select',
          options: [
            { value: 'seeded', label: 'seeded' },
            { value: 'real', label: 'real' },
          ],
        })}
        <button class="btn primary" type="submit">Create draft</button>
      </form>
    </section>`;
    return sendHtml(reply, page({ title: 'New blend', principal, active: 'blends' }, body));
  });

  app.post('/blends', async (request, reply) => {
    requireOperation(request, 'adminCreateBlend');
    requireCsrf(request);
    const body = (request.body ?? {}) as FormBody;
    const api = apiFor(request);
    try {
      const created = await api.createBlend(
        compact({
          slug: text(body, 'slug'),
          name: text(body, 'name'),
          tagline: nullable(body, 'tagline'),
          launchTier: text(body, 'launchTier'),
          status: 'draft',
        }),
      );
      return reply.redirect(`/blends/${created.slug}?saved=1`, 302);
    } catch (err) {
      const principal = requireSignedIn(request);
      const view = html`<section class="card narrow">
        ${crumbs([{ href: '/', label: 'Blends' }, { label: 'New' }])}
        <h1>New blend</h1>
        ${apiFailure(err)}
        <p><a href="/blends/new">Back to the form</a></p>
      </section>`;
      return sendHtml(reply, page({ title: 'New blend', principal, active: 'blends' }, view), 400);
    }
  });

  // The editor.
  app.get<{ Params: { slug: string }; Querystring: { saved?: string } }>('/blends/:slug', async (request, reply) => {
    const principal = requireOperation(request, 'adminGetBlend');
    const api = apiFor(request);
    const { slug } = request.params;

    let blend: Blend;
    try {
      blend = await api.getBlend(slug, ['grower', 'recipes']);
    } catch (err) {
      return sendHtml(
        reply,
        page({ title: 'Blend', principal, active: 'blends' }, html`<section class="card">${apiFailure(err)}</section>`),
        err instanceof ApiError ? err.status : 500,
      );
    }

    const recipes = blend.recipes ?? [];
    const report = reportForBlend(blend, blend.grower, recipes);
    const canEdit = may(principal, 'adminUpdateBlend');
    const canPublish = may(principal, 'adminPublishBlend');

    let growers: Grower[] = [];
    let media: Media[] = [];
    try {
      growers = (await api.listGrowers({ limit: 100 })).data;
    } catch {
      // A grower list that cannot be read is not a reason to refuse to open the editor.
    }
    try {
      media = (await api.listMedia({ limit: 100 })).data;
    } catch {
      // Same. The media picker degrades to the id already on the record.
    }

    const flash: Flash[] = [];
    if (request.query.saved === '1') flash.push({ kind: 'ok', title: 'Saved. Nothing is live until you publish.' });

    const story = blend.storyBlocks ?? [];
    const storyRows = join(
      [...story, { type: 'paragraph' as const, text: '' }, { type: 'paragraph' as const, text: '' }].map(
        (block, i) => html`<div class="storyrow">
          <select name="story_type_${i}"${canEdit ? raw('') : raw(' disabled')}>
            ${join(
              (['heading', 'paragraph', 'quote'] as const).map(
                (t) => html`<option value="${t}"${block.type === t ? raw(' selected') : raw('')}>${t}</option>`,
              ),
            )}
          </select>
          <textarea name="story_text_${i}" rows="3" maxlength="2000"${canEdit ? raw('') : raw(' disabled')}>${block.text}</textarea>
        </div>`,
      ),
    );

    const heroOptions = [
      { value: '', label: 'none', selected: !blend.heroImage },
      ...media
        .filter((m) => m.kind === 'hero')
        .map((m) => ({
          value: m.mediaId,
          label: `${m.filename} (${m.status})`,
          selected: blend.heroImage?.mediaId === m.mediaId,
        })),
    ];
    if (blend.heroImage && !heroOptions.some((o) => o.value === blend.heroImage?.mediaId)) {
      heroOptions.push({ value: blend.heroImage.mediaId, label: blend.heroImage.mediaId, selected: true });
    }

    const growerOptions = [
      { value: '', label: 'none', selected: !blend.growerId },
      ...growers.map((g) => ({ value: g.growerId, label: g.name, selected: g.growerId === blend.growerId })),
    ];
    if (blend.growerId && !growerOptions.some((o) => o.value === blend.growerId)) {
      growerOptions.push({ value: blend.growerId, label: blend.growerId, selected: true });
    }

    const f = report.findings;
    const body = html`<section class="card">
      ${crumbs([{ href: '/', label: 'Blends' }, { label: blend.name }])}
      <div class="head">
        <h1>${blend.name} ${statusPill(blend.status)}</h1>
        <div class="actions">
          <a class="btn" href="/blends/${blend.slug}/preview">Preview</a>
          ${canPublish ? html`<a class="btn primary" href="/blends/${blend.slug}/publish">Publish</a>` : ''}
        </div>
      </div>
      ${placeholderBanner(report)}
      ${canEdit
        ? ''
        : html`<div class="flash flash-warn">
            <b>Read only</b>
            <p>Your role is ${principal.role}, which reads everything including drafts and writes nothing. The editing controls are absent rather than disabled, because a disabled button still reads as a promise.</p>
          </div>`}

      <form method="post" action="/blends/${blend.slug}">
        ${csrf(request.session?.csrf)}
        <input type="hidden" name="version" value="${blend.version}" />

        <h2>Identity</h2>
        ${field({ name: 'slug', label: 'Slug', value: blend.slug, readOnly: true, hint: 'Not editable. A thousand encoded tags resolve to it through the redirect table.' })}
        ${field({ name: 'tagCode', label: 'Tag code', value: blend.tagCode ?? 'none', readOnly: true, hint: 'The code on the physical jar. Read only for every role, including Admin.' })}
        ${field({ name: 'name', label: 'Blend name', value: blend.name, readOnly: !canEdit, maxLength: 120, ...fieldState(f, 'name') })}
        ${field({ name: 'tagline', label: 'Tagline', value: blend.tagline ?? '', readOnly: !canEdit, maxLength: 200, hint: '40 to 120 characters.', ...fieldState(f, 'tagline') })}
        ${field({
          name: 'launchTier',
          label: 'Launch tier',
          readOnly: !canEdit,
          type: 'select',
          options: [
            { value: 'real', label: 'real', selected: blend.launchTier === 'real' },
            { value: 'seeded', label: 'seeded', selected: blend.launchTier === 'seeded' },
          ],
          ...fieldState(f, 'launchTier'),
        })}

        <h2>Origin</h2>
        ${field({ name: 'originCountry', label: 'Country (ISO 3166-1 alpha-2)', value: blend.originCountry ?? '', readOnly: !canEdit, maxLength: 2, ...fieldState(f, 'originCountry') })}
        ${field({ name: 'originRegion', label: 'Region', value: blend.originRegion ?? '', readOnly: !canEdit, maxLength: 120, ...fieldState(f, 'originRegion') })}
        ${field({ name: 'originCity', label: 'City', value: blend.originCity ?? '', readOnly: !canEdit, maxLength: 120, hint: 'Leave empty rather than guess.', ...fieldState(f, 'originCity') })}
        ${field({ name: 'farm_latitude', label: 'Farm latitude', value: blend.farm?.latitude ?? '', readOnly: !canEdit, type: 'number', hint: 'Decimal degrees. A coordinate renders as a pin on a map and a pin reads as a fact, so it is empty until Trevean supplies it.', ...fieldState(f, 'farm.latitude') })}
        ${field({ name: 'farm_longitude', label: 'Farm longitude', value: blend.farm?.longitude ?? '', readOnly: !canEdit, type: 'number', ...fieldState(f, 'farm.longitude') })}
        ${field({ name: 'farm_label', label: 'Farm map label', value: blend.farm?.label ?? '', readOnly: !canEdit, maxLength: 200, ...fieldState(f, 'farm.label') })}

        <h2>Origin story</h2>
        <div class="field-head"><label>Blocks</label>${fieldState(f, 'storyBlocks').state ? raw('') : raw('')}</div>
        <p class="hint">
          Heading, paragraph or quote. There is no HTML block type, deliberately: raw HTML from
          a content system is how a blocking script or a third party font ends up on the tap
          path without anyone deciding to put it there. Empty blocks are dropped on save.
        </p>
        ${storyRows}

        <h2>Grower and media</h2>
        ${field({ name: 'growerId', label: 'Grower', readOnly: !canEdit, type: 'select', options: growerOptions, hint: 'The grower record is snapshotted into the page at build time, so editing a grower does not change a page already built.', ...fieldState(f, 'growerId') })}
        ${field({ name: 'heroImageId', label: 'Hero image', readOnly: !canEdit, type: 'select', options: heroOptions, hint: 'One priority image above the fold. A hero still processing blocks publish.', ...fieldState(f, 'heroImageId') })}

        <h2>Freshness</h2>
        <p class="hint">Stated per blend and never per jar. Tag encoding is per SKU, so per lot attribution is not possible and is not offered rather than faked.</p>
        ${field({ name: 'harvestedOn', label: 'Harvested on', value: blend.freshness?.harvestedOn ?? '', readOnly: !canEdit, type: 'date', ...fieldState(f, 'freshness.harvestedOn') })}
        ${field({ name: 'blendedOn', label: 'Blended on', value: blend.freshness?.blendedOn ?? '', readOnly: !canEdit, type: 'date', ...fieldState(f, 'freshness.blendedOn') })}
        ${field({ name: 'bestBefore', label: 'Best before', value: blend.freshness?.bestBefore ?? '', readOnly: !canEdit, type: 'date', hint: 'A food safety claim, and the one field on this page a customer might act on.', ...fieldState(f, 'freshness.bestBefore') })}
        ${field({ name: 'lotLabel', label: 'Lot label', value: blend.freshness?.lotLabel ?? '', readOnly: !canEdit, maxLength: 40, ...fieldState(f, 'freshness.lotLabel') })}
        ${field({ name: 'freshnessNote', label: 'Freshness note', value: blend.freshness?.note ?? '', readOnly: !canEdit, maxLength: 300, ...fieldState(f, 'freshness.note') })}

        <h2>Shopify</h2>
        ${field({ name: 'sku', label: 'SKU', value: blend.shopify?.sku ?? '', readOnly: !canEdit, maxLength: 64, ...fieldState(f, 'shopify.sku') })}
        ${field({ name: 'productId', label: 'Product id', value: blend.shopify?.productId ?? '', readOnly: !canEdit, ...fieldState(f, 'shopify.productId') })}
        ${field({ name: 'variantId', label: 'Variant id', value: blend.shopify?.variantId ?? '', readOnly: !canEdit, ...fieldState(f, 'shopify.variantId') })}
        ${field({ name: 'cartPermalinkUrl', label: 'Cart permalink', value: blend.shopify?.cartPermalinkUrl ?? '', readOnly: !canEdit, hint: 'A static cart permalink. Zero API calls on the page. Empty means the reorder button renders disabled and labelled rather than pointed somewhere plausible.', ...fieldState(f, 'shopify.cartPermalinkUrl') })}

        ${canEdit
          ? html`<div class="formfoot">
              <button class="btn primary" type="submit">Save draft</button>
              <span class="hint">Saving never publishes. Version ${blend.version} will be sent, and a mismatch is refused rather than overwriting somebody else.</span>
            </div>`
          : ''}
      </form>
    </section>

    <section class="card">
      <div class="head">
        <h2>Recipes (${recipes.length})</h2>
        ${may(principal, 'adminCreateRecipe') ? html`<a class="btn" href="/recipes/new?blend=${blend.slug}">New recipe</a>` : ''}
      </div>
      <p class="hint">Five to ten per blend. Fewer than five and the carousel looks broken, more than ten and the page exceeds its image budget.</p>
      <table class="grid">
        <thead><tr><th>Order</th><th>Title</th><th>Status</th><th>Steps</th><th>Version</th><th></th></tr></thead>
        <tbody>
          ${join(
            recipes.map(
              (r: Recipe) => html`<tr>
                <td>${r.sortOrder}</td>
                <td><a href="/recipes/${r.recipeId}">${r.title}</a></td>
                <td>${statusPill(r.status)}</td>
                <td>${(r.steps ?? []).length}</td>
                <td>${r.version}</td>
                <td><code>${r.recipeId}</code></td>
              </tr>`,
            ),
          )}
        </tbody>
      </table>
      ${recipes.length === 0 ? html`<p class="empty">No recipes on this blend yet.</p>` : ''}
    </section>

    <section class="card">
      <h2>Content readiness for this blend</h2>
      <p class="hint">${report.headline}</p>
      ${findingsTable(report.findings.filter((x) => x.isPlaceholder))}
    </section>`;

    return sendHtml(reply, page({ title: blend.name, principal, active: 'blends', flash }, body));
  });

  // Save.
  app.post<{ Params: { slug: string } }>('/blends/:slug', async (request, reply) => {
    const principal = requireOperation(request, 'adminUpdateBlend');
    requireCsrf(request);
    const body = (request.body ?? {}) as FormBody;
    const { slug } = request.params;
    const api = apiFor(request);

    const latitude = num(body, 'farm_latitude');
    const longitude = num(body, 'farm_longitude');
    const farm =
      typeof latitude === 'number' && typeof longitude === 'number'
        ? { latitude, longitude, label: nullable(body, 'farm_label') ?? null }
        : null;

    const storyBlocks = indexed(body, 'story')
      .filter((entry) => (entry['text'] ?? '').trim() !== '')
      .map((entry) => ({ type: (entry['type'] ?? 'paragraph') as 'heading' | 'paragraph' | 'quote', text: (entry['text'] ?? '').trim() }));

    const payload = compact({
      version: intOf(body, 'version'),
      name: text(body, 'name'),
      tagline: nullable(body, 'tagline'),
      launchTier: text(body, 'launchTier'),
      originCountry: nullable(body, 'originCountry'),
      originRegion: nullable(body, 'originRegion'),
      originCity: nullable(body, 'originCity'),
      farm,
      storyBlocks,
      growerId: nullable(body, 'growerId'),
      heroImageId: nullable(body, 'heroImageId'),
      freshness: {
        harvestedOn: nullable(body, 'harvestedOn') ?? null,
        blendedOn: nullable(body, 'blendedOn') ?? null,
        bestBefore: nullable(body, 'bestBefore') ?? null,
        lotLabel: nullable(body, 'lotLabel') ?? null,
        note: nullable(body, 'freshnessNote') ?? null,
      },
      shopify: {
        sku: nullable(body, 'sku') ?? null,
        productId: nullable(body, 'productId') ?? null,
        variantId: nullable(body, 'variantId') ?? null,
        cartPermalinkUrl: nullable(body, 'cartPermalinkUrl') ?? null,
      },
    });

    try {
      await api.updateBlend(slug, payload);
      return reply.redirect(`/blends/${slug}?saved=1`, 302);
    } catch (err) {
      const view = html`<section class="card">
        ${crumbs([{ href: '/', label: 'Blends' }, { href: `/blends/${slug}`, label: slug }, { label: 'Save failed' }])}
        <h1>Nothing was saved</h1>
        ${apiFailure(err)}
        <p><a class="btn" href="/blends/${slug}">Back to the blend</a></p>
      </section>`;
      return sendHtml(
        reply,
        page({ title: 'Save failed', principal, active: 'blends' }, view),
        err instanceof ApiError ? err.status : 500,
      );
    }
  });

  // Preview, rendered inside the admin at a phone width.
  app.get<{ Params: { slug: string } }>('/blends/:slug/preview', async (request, reply) => {
    const principal = requireOperation(request, 'adminGetBlend');
    const body = html`<section class="card">
      ${crumbs([{ href: '/', label: 'Blends' }, { href: `/blends/${request.params.slug}`, label: request.params.slug }, { label: 'Preview' }])}
      <div class="head">
        <h1>Preview</h1>
        <div class="actions">
          <a class="btn" href="/blends/${request.params.slug}/preview.html" target="_blank" rel="noopener">Open full width</a>
          ${may(principal, 'adminPublishBlend') ? html`<a class="btn primary" href="/blends/${request.params.slug}/publish">Publish</a>` : ''}
        </div>
      </div>
      <p class="hint">
        The draft as a customer will read it, at 390 px, which is inside the 375 to 428 px
        responsive range in the acceptance criteria. Layout and content are the page. Byte
        weight and image derivatives are not measured here: those belong to the consumer build,
        which generates the real page from this same record on publish.
      </p>
      <div class="phone">
        <iframe title="Blend preview" src="/blends/${request.params.slug}/preview.html"></iframe>
      </div>
    </section>`;
    return sendHtml(reply, page({ title: 'Preview', principal, active: 'blends' }, body));
  });

  app.get<{ Params: { slug: string } }>('/blends/:slug/preview.html', async (request, reply) => {
    requireOperation(request, 'adminGetBlend');
    const api = apiFor(request);
    const blend = await api.getBlend(request.params.slug, ['grower', 'recipes']);
    const recipes = blend.recipes ?? [];
    const report = reportForBlend(blend, blend.grower, recipes);
    return sendHtml(
      reply,
      renderPreview({ blend, grower: blend.grower, recipes, report, sourceLabel: 'draft' }),
    );
  });

  // The publish screen.
  app.get<{ Params: { slug: string } }>('/blends/:slug/publish', async (request, reply) => {
    const principal = requireOperation(request, 'adminPublishBlend');
    const api = apiFor(request);
    const blend = await api.getBlend(request.params.slug, ['grower', 'recipes']);
    const report = reportForBlend(blend, blend.grower, blend.recipes ?? []);
    return sendHtml(reply, page({ title: 'Publish', principal, active: 'blends' }, publishForm(request, blend, report)));
  });

  app.post<{ Params: { slug: string } }>('/blends/:slug/publish', async (request, reply) => {
    const principal = requireOperation(request, 'adminPublishBlend');
    requireCsrf(request);
    const body = (request.body ?? {}) as FormBody;
    const api = apiFor(request);
    const { slug } = request.params;

    const blend = await api.getBlend(slug, ['grower', 'recipes']);
    const report = reportForBlend(blend, blend.grower, blend.recipes ?? []);
    const decision = evaluate(report, {
      phrase: str(body, 'override_phrase'),
      reason: str(body, 'override_reason'),
      acknowledged: checked(body, 'override_ack'),
    });

    if (!decision.allowed) {
      record({
        event: 'publish_blocked',
        subject: principal.subject,
        email: principal.email,
        role: principal.role,
        slug,
        detail: { blockingFields: decision.blockingFields, problems: decision.problems },
      });
      return sendHtml(
        reply,
        page(
          { title: 'Publish', principal, active: 'blends' },
          publishForm(request, blend, report, decision.problems),
        ),
        422,
      );
    }

    if (decision.overridden) {
      record({
        event: 'placeholder_override',
        subject: principal.subject,
        email: principal.email,
        role: principal.role,
        slug,
        detail: { reason: decision.reason, blockingFields: decision.blockingFields },
      });
    }

    try {
      const result = await api.publishBlend(slug, {
        version: intOf(body, 'version') ?? blend.version,
        note: nullable(body, 'note') ?? null,
      });
      record({
        event: 'publish',
        subject: principal.subject,
        email: principal.email,
        role: principal.role,
        slug,
        detail: {
          version: result.version,
          revalidationId: result.revalidationId,
          paths: result.paths,
          overridden: decision.overridden,
        },
      });

      const verification = await verifyPublished(api, result);
      const pipeline = await confirmThroughPipeline(result.revalidationId);
      const view = html`<section class="card">
        ${crumbs([{ href: '/', label: 'Blends' }, { href: `/blends/${slug}`, label: slug }, { label: 'Published' }])}
        <h1>Published</h1>
        <div class="flash flash-ok">
          <b>The API accepted the publish and queued regeneration</b>
          <p>Version ${result.version}, published at ${result.publishedAt}. Revalidation ${result.revalidationId}.</p>
        </div>
        ${decision.overridden
          ? html`<div class="flash flash-warn">
              <b>Placeholder content was published under an override</b>
              <p>Recorded against ${principal.email} with the reason you gave. ${decision.blockingFields.length} field${decision.blockingFields.length === 1 ? '' : 's'} on this page are not real.</p>
            </div>`
          : ''}

        <h2>Exactly the pages queued for regeneration</h2>
        <p class="hint">
          Publish does not wait for regeneration. The previous version keeps serving until the
          new one is ready, so no customer waits for a render and no editor waits for a deploy.
        </p>
        <ul class="paths">${join(result.paths.map((p) => html`<li><code>${p}</code></li>`))}</ul>

        <h2>Did it work</h2>
        <div class="flash flash-${verification.outcome === 'confirmed' ? 'ok' : verification.outcome === 'not_yet' ? 'warn' : 'error'}">
          <b>${verification.outcome === 'confirmed' ? 'Confirmed live at the origin' : verification.outcome === 'not_yet' ? 'Not confirmed yet' : 'Could not confirm'}</b>
          <p>${verification.message}</p>
          <p class="hint">
            Checked ${verification.attempts} time${verification.attempts === 1 ? '' : 's'} over
            ${Math.round(verification.elapsedMs / 100) / 10} seconds by re-reading the public
            content route. The contractual requirement is content live within
            ${config.publish.liveWithinMinutes} minutes.
          </p>
        </div>

        ${pipelinePanel(slug, result.revalidationId, pipeline)}

        <div class="actions">
          <a class="btn" href="/blends/${slug}">Back to the blend</a>
          <a class="btn" href="/blends/${slug}/preview">Preview</a>
        </div>
      </section>`;
      return sendHtml(reply, page({ title: 'Published', principal, active: 'blends' }, view));
    } catch (err) {
      const view = html`<section class="card">
        ${crumbs([{ href: '/', label: 'Blends' }, { href: `/blends/${slug}`, label: slug }, { label: 'Publish failed' }])}
        <h1>Not published</h1>
        ${apiFailure(err)}
        <p class="hint">Nothing changed. The previous version is still serving.</p>
        <p><a class="btn" href="/blends/${slug}/publish">Back to the publish screen</a></p>
      </section>`;
      return sendHtml(
        reply,
        page({ title: 'Publish failed', principal, active: 'blends' }, view),
        err instanceof ApiError ? err.status : 500,
      );
    }
  });

  /**
   * Ask the publish pipeline again.
   *
   * A full regeneration is measured in minutes on a cold machine, so the publish screen waits
   * briefly and then says exactly where it got to. This is how an editor finds out, without
   * a developer, whether the change reached the page. Viewer, because it reads and writes
   * nothing.
   */
  app.get('/blends/:slug/publish/status/:revalidationId', async (request, reply) => {
    const principal = requireSignedIn(request);
    const { slug, revalidationId } = request.params as { slug: string; revalidationId: string };

    let pipeline: PipelineResult;
    try {
      pipeline = describePipeline(await fetchJob(revalidationId));
    } catch (err) {
      pipeline = {
        outcome: 'unreachable',
        job: null,
        message: `The publish pipeline could not be reached: ${(err as Error).message}.`,
        elapsedMs: null,
      };
    }

    const view = html`<section class="card">
      ${crumbs([{ href: '/', label: 'Blends' }, { href: `/blends/${slug}`, label: slug }, { label: 'Publish status' }])}
      <h1>Publish status</h1>
      <p class="hint">Revalidation ${revalidationId}.</p>
      ${pipelinePanel(slug, revalidationId, pipeline)}
      <div class="actions">
        <a class="btn" href="/blends/${slug}">Back to the blend</a>
      </div>
    </section>`;
    return sendHtml(reply, page({ title: 'Publish status', principal, active: 'blends' }, view));
  });

  // The manual revalidation escape hatch.
  app.post('/revalidate', async (request, reply) => {
    const principal = requireOperation(request, 'adminRevalidate');
    requireCsrf(request);
    const body = (request.body ?? {}) as FormBody;
    const slug = text(body, 'slug');
    const api = apiFor(request);
    try {
      const result = await api.revalidate({
        blendSlugs: slug ? [slug] : undefined,
        reason: nullable(body, 'reason') ?? null,
      });
      record({
        event: 'revalidate',
        subject: principal.subject,
        email: principal.email,
        role: principal.role,
        slug,
        detail: { revalidationId: result.revalidationId, paths: result.paths },
      });
      const view = html`<section class="card">
        <h1>Revalidation queued</h1>
        <p class="hint">${result.revalidationId}</p>
        <ul class="paths">${join(result.paths.map((p) => html`<li><code>${p}</code></li>`))}</ul>
        <p><a class="btn" href="/">Back to blends</a></p>
      </section>`;
      return sendHtml(reply, page({ title: 'Revalidate', principal, active: 'blends' }, view));
    } catch (err) {
      return sendHtml(
        reply,
        page({ title: 'Revalidate', principal, active: 'blends' }, html`<section class="card">${apiFailure(err)}</section>`),
        err instanceof ApiError ? err.status : 500,
      );
    }
  });
}

/**
 * What the publish pipeline did, in the editor's words.
 *
 * The panel above this one says the origin is serving the new version, which is what the
 * frozen contract allows the admin to ask. This one says whether the page a customer reaches
 * by tapping a jar is serving it, which is the thing the acceptance criterion is actually
 * about, and it is only shown when there is a pipeline to ask.
 *
 * It never rounds a failure up into a success. "Published but not confirmed" is its own
 * outcome with its own wording, because an editor who is told the change is live when it is
 * not will find out from a customer.
 */
function pipelinePanel(slug: string, revalidationId: string, pipeline: PipelineResult): RawHtml {
  if (pipeline.outcome === 'not_configured') {
    return html`<h2>Is it live for a customer</h2>
      <p class="hint">${pipeline.message}</p>`;
  }

  const tone =
    pipeline.outcome === 'live' ? 'ok' : pipeline.outcome === 'running' ? 'warn' : 'error';
  const heading =
    pipeline.outcome === 'live'
      ? 'Live at the edge'
      : pipeline.outcome === 'running'
        ? 'Still regenerating'
        : pipeline.outcome === 'unconfirmed'
          ? 'Published, but not confirmed live'
          : pipeline.outcome === 'failed'
            ? 'The publish pipeline failed'
            : 'The publish pipeline could not be reached';

  const job = pipeline.job;

  return html`<h2>Is it live for a customer</h2>
    <div class="flash flash-${tone}">
      <b>${heading}</b>
      <p>${pipeline.message}</p>
    </div>
    ${job
      ? html`<ul class="paths">
          ${join(job.published.map((o) => html`<li><code>${o.path}</code> ${o.bytes} bytes, <code>${o.cacheControl}</code></li>`))}
        </ul>
        <p class="hint">
          Invalidated ${job.invalidation?.paths.length ?? 0} path${(job.invalidation?.paths.length ?? 0) === 1 ? '' : 's'},
          exactly the objects whose bytes changed.
          ${job.unchanged.length} object${job.unchanged.length === 1 ? '' : 's'} were unchanged and were
          neither re-uploaded nor invalidated.
          ${job.placeholder.objects.length > 0
            ? html` ${job.placeholder.objects.length} published object${job.placeholder.objects.length === 1 ? '' : 's'} still carry placeholder content. This is refused outright on production and there is no override that changes that.`
            : ''}
        </p>`
      : ''}
    <p><a class="btn" href="/blends/${slug}/publish/status/${revalidationId}">Check again</a></p>`;
}

function publishForm(
  request: { session?: { csrf: string } },
  blend: Blend,
  report: ReturnType<typeof reportForBlend>,
  problems: string[] = [],
): RawHtml {
  const blocking = report.findings.filter((x) => x.blocksPublish);
  return html`<section class="card">
    ${crumbs([{ href: '/', label: 'Blends' }, { href: `/blends/${blend.slug}`, label: blend.name }, { label: 'Publish' }])}
    <h1>Publish ${blend.name}</h1>
    ${placeholderBanner(report)}
    ${problems.length > 0
      ? html`<div class="flash flash-error">
          <b>Not published</b>
          <ul>${join(problems.map((p) => html`<li>${p}</li>`))}</ul>
        </div>`
      : ''}

    <p class="hint">
      Publishing writes an immutable published snapshot and queues regeneration of exactly the
      affected pages. It returns immediately: the previous version keeps serving until the new
      one is ready.
    </p>

    <form method="post" action="/blends/${blend.slug}/publish">
      ${csrf(request.session?.csrf)}
      <input type="hidden" name="version" value="${blend.version}" />
      ${field({ name: 'note', label: 'Change note', readOnly: false, hint: 'Optional. Recorded against the published snapshot.', maxLength: 500 })}

      ${report.safeToPublish
        ? ''
        : html`<div class="override">
            <h2>This page still carries placeholder content</h2>
            <p class="warn">${OVERRIDE_WARNING}</p>
            ${findingsTable(blocking)}
            ${field({
              name: 'override_reason',
              label: 'Why this must go live anyway',
              readOnly: false,
              type: 'textarea',
              rows: 3,
              hint: 'At least 20 characters. Recorded in the audit log against your name.',
            })}
            <label class="check"><input type="checkbox" name="override_ack" /> I have read the list above and I accept that this content is not real.</label>
            ${field({
              name: 'override_phrase',
              label: `Type ${config.publish.overridePhrase} to confirm`,
              readOnly: false,
              hint: 'Typed exactly. A checkbox on its own is one absent minded click.',
            })}
          </div>`}

      <div class="formfoot">
        <button class="btn primary" type="submit">${report.safeToPublish ? 'Publish' : 'Publish anyway'}</button>
      </div>
    </form>
  </section>`;
}
