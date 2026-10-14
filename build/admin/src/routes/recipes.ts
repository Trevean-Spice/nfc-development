import type { FastifyInstance } from 'fastify';
import { may, requireCsrf, requireOperation } from '../auth/guard.js';
import { ApiError } from '../api/errors.js';
import type { Recipe } from '../api/types.js';
import { scanForSentinels } from '../content/placeholder.js';
import { apiFailure, crumbs, csrf, field, statusPill } from '../views/components.js';
import { html, join, raw, type RawHtml } from '../views/html.js';
import { page } from '../views/layout.js';
import { apiFor, compact, indexed, intOf, lines, nullable, sendHtml, text, type FormBody } from './support.js';

/**
 * Recipes.
 *
 * Ingredients are four separate values and not one string. That is the request most likely
 * to be skipped and the most expensive to fix later: the page formats quantities differently
 * at different screen widths, a future translation cannot parse an English string, and a
 * scaled serving size needs the number on its own. So the form makes the four values the
 * only way to enter one.
 *
 * Steps are one per line and are never numbered in the text. The page numbers them, so
 * "1. Rinse the rice" becomes "1. 1. Rinse the rice".
 *
 * READ NOTE. The frozen contract has no GET for a single recipe under /v1/admin. The public
 * `GET /v1/recipes/{recipeId}` is used to load the editor, and it returns drafts as well
 * because a recipe carries its own status and the API serves it. Where the whole set for a
 * blend is wanted, `adminGetBlend?include=recipes` is used, because that is the only route
 * that returns draft recipes.
 */

function ingredientRows(recipe: Recipe | null, canEdit: boolean): RawHtml {
  const existing = recipe?.ingredients ?? [];
  const rows = [...existing, ...Array.from({ length: 3 }, () => ({ quantity: null, unit: null, item: '', note: null }))];
  return join(
    rows.map(
      (ing, i) => html`<div class="ingrow">
        <input type="text" name="ing_quantity_${i}" value="${ing.quantity ?? ''}" placeholder="2"${canEdit ? raw('') : raw(' disabled')} />
        <input type="text" name="ing_unit_${i}" value="${ing.unit ?? ''}" placeholder="tsp" maxlength="24"${canEdit ? raw('') : raw(' disabled')} />
        <input type="text" name="ing_item_${i}" value="${ing.item ?? ''}" placeholder="Persian Sunrise blend" maxlength="160"${canEdit ? raw('') : raw(' disabled')} />
        <input type="text" name="ing_note_${i}" value="${ing.note ?? ''}" placeholder="ground" maxlength="200"${canEdit ? raw('') : raw(' disabled')} />
      </div>`,
    ),
  );
}

function recipeForm(
  request: { session?: { csrf: string } },
  recipe: Recipe | null,
  blendSlug: string,
  canEdit: boolean,
  slugs: string[],
): RawHtml {
  const action = recipe ? `/recipes/${recipe.recipeId}` : '/recipes';
  const hits = recipe ? scanForSentinels(recipe) : [];
  return html`<section class="card">
    ${crumbs([
      { href: '/', label: 'Blends' },
      { href: `/blends/${blendSlug}`, label: blendSlug },
      { label: recipe ? recipe.title : 'New recipe' },
    ])}
    <div class="head">
      <h1>${recipe ? recipe.title : 'New recipe'} ${recipe ? statusPill(recipe.status) : raw('')}</h1>
    </div>
    ${hits.length > 0
      ? html`<div class="flash flash-warn">
          <b>Placeholder content on this recipe</b>
          <p>${hits.length} value${hits.length === 1 ? '' : 's'} still carry the placeholder marker. A recipe that looks plausible is a recipe somebody will cook.</p>
          <ul class="details">${join(hits.slice(0, 8).map((h) => html`<li><code>${h.path}</code> ${h.excerpt}</li>`))}</ul>
        </div>`
      : ''}
    <form method="post" action="${action}">
      ${csrf(request.session?.csrf)}
      ${recipe ? html`<input type="hidden" name="version" value="${recipe.version}" />` : ''}
      ${recipe
        ? html`<input type="hidden" name="blendSlug" value="${recipe.blendSlug}" />`
        : field({
            name: 'blendSlug',
            label: 'Blend',
            readOnly: false,
            type: 'select',
            options: slugs.map((s) => ({ value: s, label: s, selected: s === blendSlug })),
          })}
      ${field({ name: 'title', label: 'Title', value: recipe?.title ?? '', readOnly: !canEdit, maxLength: 160, hint: '20 to 60 characters.' })}
      ${field({ name: 'summary', label: 'Summary', value: recipe?.summary ?? '', readOnly: !canEdit, maxLength: 400, type: 'textarea', rows: 2, hint: '60 to 160 characters. It has to read on a carousel card at 375 px.' })}
      ${field({ name: 'servings', label: 'Servings', value: recipe?.servings ?? '', readOnly: !canEdit, type: 'number' })}
      ${field({ name: 'prepMinutes', label: 'Prep minutes', value: recipe?.prepMinutes ?? '', readOnly: !canEdit, type: 'number' })}
      ${field({ name: 'cookMinutes', label: 'Cook minutes', value: recipe?.cookMinutes ?? '', readOnly: !canEdit, type: 'number' })}
      ${field({
        name: 'difficulty',
        label: 'Difficulty',
        readOnly: !canEdit,
        type: 'select',
        options: [
          { value: '', label: 'not set', selected: !recipe?.difficulty },
          ...(['easy', 'medium', 'hard'] as const).map((d) => ({ value: d, label: d, selected: recipe?.difficulty === d })),
        ],
      })}
      ${field({
        name: 'sortOrder',
        label: 'Carousel position',
        value: recipe?.sortOrder ?? 0,
        readOnly: !canEdit,
        type: 'number',
        hint: 'Ties break on the recipe id, so the order is stable across builds and a rebuild does not produce a diff that hides a real change.',
      })}
      ${field({
        name: 'status',
        label: 'Status',
        readOnly: !canEdit,
        type: 'select',
        options: (['draft', 'published', 'archived'] as const).map((s) => ({
          value: s,
          label: s,
          selected: (recipe?.status ?? 'draft') === s,
        })),
        hint: 'A recipe carries its own status. It reaches the page at the next revalidation of its blend.',
      })}

      <h2>Ingredients</h2>
      <p class="hint">
        Four separate values, never one string. Quantity, unit, item, note. Empty rows are dropped.
      </p>
      <div class="ingrow ingrow-head"><span>Quantity</span><span>Unit</span><span>Item</span><span>Note</span></div>
      ${ingredientRows(recipe, canEdit)}

      <h2>Method</h2>
      ${field({
        name: 'steps',
        label: 'Steps, one per line',
        value: (recipe?.steps ?? []).join('\n'),
        readOnly: !canEdit,
        type: 'textarea',
        rows: 8,
        hint: 'Do not number the steps. The page numbers them.',
      })}

      ${canEdit ? html`<div class="formfoot"><button class="btn primary" type="submit">${recipe ? 'Save recipe' : 'Create recipe'}</button></div>` : ''}
    </form>

    ${recipe && canEdit
      ? html`<form method="post" action="/recipes/${recipe.recipeId}/archive" class="danger">
          ${csrf(request.session?.csrf)}
          <button class="btn" type="submit">Archive this recipe</button>
          <span class="hint">A soft delete. Nothing is destroyed, because content that has been on a printed jar's page is worth keeping.</span>
        </form>`
      : ''}
  </section>`;
}

const SLUGS = ['persian-sunrise', 'caribbean-sunset', 'north-african-night-market', 'silk-road', 'kyoto-garden'];

export async function registerRecipeRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { blend?: string } }>('/recipes/new', async (request, reply) => {
    const principal = requireOperation(request, 'adminCreateRecipe');
    const blendSlug = request.query.blend ?? SLUGS[0] ?? '';
    return sendHtml(
      reply,
      page({ title: 'New recipe', principal, active: 'blends' }, recipeForm(request, null, blendSlug, true, SLUGS)),
    );
  });

  app.post('/recipes', async (request, reply) => {
    const principal = requireOperation(request, 'adminCreateRecipe');
    requireCsrf(request);
    const body = (request.body ?? {}) as FormBody;
    const api = apiFor(request);
    const blendSlug = text(body, 'blendSlug') ?? '';
    try {
      const created = await api.createRecipe(compact({ blendSlug, ...recipePayload(body, false) }));
      return reply.redirect(`/recipes/${created.recipeId}?saved=1`, 302);
    } catch (err) {
      return sendHtml(
        reply,
        page({ title: 'New recipe', principal, active: 'blends' }, html`<section class="card">${apiFailure(err)}<p><a href="/recipes/new?blend=${blendSlug}">Back to the form</a></p></section>`),
        err instanceof ApiError ? err.status : 500,
      );
    }
  });

  app.get<{ Params: { recipeId: string }; Querystring: { saved?: string } }>('/recipes/:recipeId', async (request, reply) => {
    const principal = requireOperation(request, 'adminListBlends');
    const api = apiFor(request);
    try {
      const recipe = (await api.call('getRecipe', { recipeId: request.params.recipeId }, { anonymous: true })).body as Recipe;
      const canEdit = may(principal, 'adminUpdateRecipe');
      return sendHtml(
        reply,
        page(
          { title: recipe.title, principal, active: 'blends', flash: request.query.saved === '1' ? [{ kind: 'ok', title: 'Saved.' }] : [] },
          recipeForm(request, recipe, recipe.blendSlug, canEdit, SLUGS),
        ),
      );
    } catch (err) {
      return sendHtml(
        reply,
        page({ title: 'Recipe', principal, active: 'blends' }, html`<section class="card">${apiFailure(err)}</section>`),
        err instanceof ApiError ? err.status : 500,
      );
    }
  });

  app.post<{ Params: { recipeId: string } }>('/recipes/:recipeId', async (request, reply) => {
    const principal = requireOperation(request, 'adminUpdateRecipe');
    requireCsrf(request);
    const body = (request.body ?? {}) as FormBody;
    const api = apiFor(request);
    try {
      await api.updateRecipe(request.params.recipeId, compact({ version: intOf(body, 'version'), ...recipePayload(body, true) }));
      return reply.redirect(`/recipes/${request.params.recipeId}?saved=1`, 302);
    } catch (err) {
      return sendHtml(
        reply,
        page({ title: 'Recipe', principal, active: 'blends' }, html`<section class="card"><h1>Nothing was saved</h1>${apiFailure(err)}<p><a class="btn" href="/recipes/${request.params.recipeId}">Back to the recipe</a></p></section>`),
        err instanceof ApiError ? err.status : 500,
      );
    }
  });

  app.post<{ Params: { recipeId: string } }>('/recipes/:recipeId/archive', async (request, reply) => {
    const principal = requireOperation(request, 'adminDeleteRecipe');
    requireCsrf(request);
    const api = apiFor(request);
    try {
      await api.archiveRecipe(request.params.recipeId);
      return reply.redirect('/', 302);
    } catch (err) {
      return sendHtml(
        reply,
        page({ title: 'Recipe', principal, active: 'blends' }, html`<section class="card">${apiFailure(err)}</section>`),
        err instanceof ApiError ? err.status : 500,
      );
    }
  });
}

function recipePayload(body: FormBody, isUpdate: boolean): Record<string, unknown> {
  const ingredients = indexed(body, 'ing')
    .filter((row) => (row['item'] ?? '').trim() !== '')
    .map((row) => {
      const quantity = (row['quantity'] ?? '').trim();
      const parsed = quantity === '' ? null : Number(quantity);
      return {
        quantity: parsed !== null && Number.isFinite(parsed) ? parsed : null,
        unit: (row['unit'] ?? '').trim() || null,
        item: (row['item'] ?? '').trim(),
        note: (row['note'] ?? '').trim() || null,
      };
    });

  const difficulty = nullable(body, 'difficulty');
  const payload: Record<string, unknown> = {
    title: text(body, 'title'),
    summary: nullable(body, 'summary'),
    servings: intOf(body, 'servings'),
    prepMinutes: intOf(body, 'prepMinutes'),
    cookMinutes: intOf(body, 'cookMinutes'),
    difficulty,
    ingredients,
    steps: lines(body, 'steps'),
    sortOrder: intOf(body, 'sortOrder'),
    status: text(body, 'status'),
  };

  // RecipeCreate does not accept `archived`, RecipeUpdate does. Sending a value the schema
  // rejects would be a 400 an editor cannot read, so it is filtered here rather than there.
  if (!isUpdate && payload['status'] === 'archived') delete payload['status'];
  if (payload['sortOrder'] === null) delete payload['sortOrder'];
  return payload;
}
