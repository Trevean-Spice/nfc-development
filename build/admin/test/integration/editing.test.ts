import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setup, form, FORM_HEADERS, type Harness, type Session } from '../helpers/harness.js';

/**
 * The acceptance bar, exercised as close as a test can get to it: a member of the marketing
 * team edits a blend, adds a recipe, edits a grower, previews and publishes, with nobody
 * helping. Every step below is one an editor performs with no developer involved.
 */

let h: Harness;
let editor: Session;
let viewer: Session;

beforeAll(async () => {
  h = await setup();
  editor = await h.signIn('Editor');
  viewer = await h.signIn('Viewer');
});

afterAll(async () => {
  await h.close();
});

describe('the blend editor', () => {
  it('saves a story, a tagline and a coordinate through a plain form', async () => {
    const response = await h.app.inject({
      method: 'POST',
      url: '/blends/kyoto-garden',
      payload: form(editor, {
        version: 1,
        name: 'Kyoto Garden',
        tagline: 'Sesame, nori, yuzu and green tea from Kyoto',
        launchTier: 'seeded',
        originCountry: 'JP',
        originRegion: 'Kyoto',
        farm_latitude: 35.0116,
        farm_longitude: 135.7681,
        farm_label: 'Smallholding outside Kyoto',
        story_type_0: 'heading',
        story_text_0: 'Picked before the heat',
        story_type_1: 'paragraph',
        story_text_1: 'The tea is shaded for three weeks before it is picked.',
        story_type_2: 'paragraph',
        story_text_2: '',
      }),
      headers: { cookie: editor.cookie, ...FORM_HEADERS },
    });
    expect(response.statusCode).toBe(302);

    const saved = h.stub.state.blends.get('kyoto-garden') as Record<string, unknown>;
    expect(saved['tagline']).toBe('Sesame, nori, yuzu and green tea from Kyoto');
    expect(saved['farm']).toEqual({ latitude: 35.0116, longitude: 135.7681, label: 'Smallholding outside Kyoto' });
    // The empty third block is dropped rather than saved as an empty paragraph.
    expect(saved['storyBlocks']).toEqual([
      { type: 'heading', text: 'Picked before the heat' },
      { type: 'paragraph', text: 'The tea is shaded for three weeks before it is picked.' },
    ]);
  });

  it('clears a field by submitting it empty, which the contract expresses as an explicit null', async () => {
    const blend = h.stub.state.blends.get('kyoto-garden') as Record<string, unknown>;
    const response = await h.app.inject({
      method: 'POST',
      url: '/blends/kyoto-garden',
      payload: form(editor, { version: blend['version'] as number, name: 'Kyoto Garden', tagline: '' }),
      headers: { cookie: editor.cookie, ...FORM_HEADERS },
    });
    expect(response.statusCode).toBe(302);
    expect(h.stub.state.blends.get('kyoto-garden')?.['tagline']).toBeNull();
  });

  it('never offers the slug as an editable field, because a slug change strands inventory', async () => {
    const response = await h.app.inject({
      method: 'GET',
      url: '/blends/persian-sunrise',
      headers: { cookie: editor.cookie },
    });
    expect(response.body).not.toContain('name="slug"');
    expect(response.body).toContain('A thousand encoded tags resolve to it');
  });

  it('never offers the tag code as an editable field either', async () => {
    const response = await h.app.inject({
      method: 'GET',
      url: '/blends/persian-sunrise',
      headers: { cookie: editor.cookie },
    });
    expect(response.body).not.toContain('name="tagCode"');
  });
});

describe('what a Viewer sees', () => {
  it('the whole record including drafts, and no editing control at all', async () => {
    const response = await h.app.inject({
      method: 'GET',
      url: '/blends/persian-sunrise',
      headers: { cookie: viewer.cookie },
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('Persian Sunrise');
    expect(response.body).toContain('Read only');
    expect(response.body).not.toContain('Save draft');
    expect(response.body).not.toContain('>Publish<');
  });

  it('no navigation entry for a screen the role cannot open', async () => {
    const response = await h.app.inject({ method: 'GET', url: '/', headers: { cookie: viewer.cookie } });
    expect(response.body).not.toContain('href="/nfc"');
    expect(response.body).not.toContain('href="/users"');
  });

  it('an Editor sees neither the tag screen nor the role screen in the navigation', async () => {
    const response = await h.app.inject({ method: 'GET', url: '/', headers: { cookie: editor.cookie } });
    expect(response.body).not.toContain('href="/nfc"');
    expect(response.body).not.toContain('href="/users"');
  });
});

describe('recipes', () => {
  it('creates one with ingredients as four separate values and steps one per line', async () => {
    const response = await h.app.inject({
      method: 'POST',
      url: '/recipes',
      payload: form(editor, {
        blendSlug: 'persian-sunrise',
        title: 'Saffron rice with rose and pistachio',
        summary: 'One pan, thirty minutes, very little attention.',
        servings: 4,
        prepMinutes: 10,
        cookMinutes: 25,
        difficulty: 'easy',
        sortOrder: 2,
        status: 'draft',
        ing_quantity_0: '2',
        ing_unit_0: 'tsp',
        ing_item_0: 'Persian Sunrise blend',
        ing_note_0: 'ground',
        ing_quantity_1: '300',
        ing_unit_1: 'g',
        ing_item_1: 'basmati rice',
        ing_item_2: '',
        steps: 'Rinse the rice until the water runs clear.\n\nSteep the saffron in warm water.\nSteam for twenty minutes.',
      }),
      headers: { cookie: editor.cookie, ...FORM_HEADERS },
    });
    expect(response.statusCode).toBe(302);

    const created = [...h.stub.state.recipes.values()].find((r) => r['title'] === 'Saffron rice with rose and pistachio');
    expect(created).toBeDefined();
    expect(created?.['ingredients']).toEqual([
      { quantity: 2, unit: 'tsp', item: 'Persian Sunrise blend', note: 'ground' },
      { quantity: 300, unit: 'g', item: 'basmati rice', note: null },
    ]);
    expect(created?.['steps']).toEqual([
      'Rinse the rice until the water runs clear.',
      'Steep the saffron in warm water.',
      'Steam for twenty minutes.',
    ]);
  });

  it('archives rather than deletes', async () => {
    const response = await h.app.inject({
      method: 'POST',
      url: '/recipes/rcp_01J9Z91B2C3D4E5F6G7H8J9K0M/archive',
      payload: form(editor, {}),
      headers: { cookie: editor.cookie, ...FORM_HEADERS },
    });
    expect(response.statusCode).toBe(302);
    expect(h.stub.state.recipes.get('rcp_01J9Z91B2C3D4E5F6G7H8J9K0M')?.['status']).toBe('archived');
  });
});

describe('growers', () => {
  it('shows which published pages hold a stale snapshot after an edit', async () => {
    const response = await h.app.inject({
      method: 'POST',
      url: '/growers/grw_01J9Z900A1B2C3D4E5F6G7H8J9',
      payload: form(editor, { version: 3, name: 'A named consenting grower' }),
      headers: { cookie: editor.cookie, ...FORM_HEADERS },
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('stale grower snapshot');
    expect(response.body).toContain('persian-sunrise');
  });

  it('warns next to the coordinate field rather than in a policy document', async () => {
    const response = await h.app.inject({
      method: 'GET',
      url: '/growers/grw_01J9Z900A1B2C3D4E5F6G7H8J9',
      headers: { cookie: editor.cookie },
    });
    expect(response.body).toContain('a pin reads as a fact');
  });
});

describe('the NFC screens', () => {
  it('group the redirect table into batches and encoding runs without inventing a per tag view', async () => {
    const admin = await h.signIn('Admin');
    const response = await h.app.inject({ method: 'GET', url: '/nfc', headers: { cookie: admin.cookie } });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('SO4731');
    expect(response.body).toContain('ST25TV02KC');
    expect(response.body).toContain('Tag batches');
    expect(response.body).toContain('Encoding runs');
    expect(response.body).toContain('attribution is per SKU');
    // Read only, for everyone.
    expect(response.body).not.toContain('<form method="post" action="/nfc');
  });

  it('never claims write protection is false when the answer is unknown', async () => {
    const admin = await h.signIn('Admin');
    const response = await h.app.inject({ method: 'GET', url: '/nfc', headers: { cookie: admin.cookie } });
    expect(response.body).toContain('Unknown');
    expect(response.body).not.toContain('Not write protected');
  });
});

describe('analytics', () => {
  it('states how the numbers are counted on every load', async () => {
    const response = await h.app.inject({ method: 'GET', url: '/analytics', headers: { cookie: viewer.cookie } });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('browser_token');
    expect(response.body).toContain('rollup');
    expect(response.body).toContain('no per tag counter');
  });
});
