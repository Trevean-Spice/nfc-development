import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setup, form, FORM_HEADERS, type Harness, type Session } from '../helpers/harness.js';

/**
 * Preview before publish, and the placeholder render contract inside it.
 */

let h: Harness;
let editor: Session;

beforeAll(async () => {
  h = await setup();
  editor = await h.signIn('Editor');
});

afterAll(async () => {
  await h.close();
});

describe('preview', () => {
  it('renders the draft as a customer will read it', async () => {
    const response = await h.app.inject({
      method: 'GET',
      url: '/blends/persian-sunrise/preview.html',
      headers: { cookie: editor.cookie },
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('Persian Sunrise');
    expect(response.body).toContain('id="story"');
    expect(response.body).toContain('id="grower"');
    expect(response.body).toContain('id="freshness"');
    expect(response.body).toContain('id="recipes"');
    expect(response.body).toContain('id="reorder"');
  });

  it('shows draft content that has not been published, which is the point of previewing', async () => {
    await h.app.inject({
      method: 'POST',
      url: '/blends/kyoto-garden',
      payload: form(editor, {
        version: 1,
        name: 'Kyoto Garden',
        tagline: 'A tagline that has never been published',
        story_type_0: 'heading',
        story_text_0: 'An unpublished heading',
      }),
      headers: { cookie: editor.cookie, ...FORM_HEADERS },
    });
    const response = await h.app.inject({
      method: 'GET',
      url: '/blends/kyoto-garden/preview.html',
      headers: { cookie: editor.cookie },
    });
    expect(response.body).toContain('A tagline that has never been published');
    expect(response.body).toContain('An unpublished heading');
  });

  it('shows the undismissable banner when the record carries placeholder content', async () => {
    const response = await h.app.inject({
      method: 'GET',
      url: '/blends/persian-sunrise/preview.html',
      headers: { cookie: editor.cookie },
    });
    expect(response.body).toContain('placeholder-banner');
    expect(response.body).toContain('Placeholder content, not for release');
    // Nothing in the markup can turn it off.
    expect(response.body).not.toContain('dismiss');
  });

  it('renders a missing value as a pending slot rather than collapsing it', async () => {
    const response = await h.app.inject({
      method: 'GET',
      url: '/blends/persian-sunrise/preview.html',
      headers: { cookie: editor.cookie },
    });
    expect(response.body).toContain('class="pending"');
    expect(response.body).toContain('Hero photograph pending');
  });

  it('disables and labels the reorder button when there is no cart permalink', async () => {
    const response = await h.app.inject({
      method: 'GET',
      url: '/blends/persian-sunrise/preview.html',
      headers: { cookie: editor.cookie },
    });
    expect(response.body).toContain('class="btn disabled"');
    expect(response.body).toContain('aria-disabled="true"');
    expect(response.body).toContain('rather than hidden or pointed somewhere plausible');
  });

  it('outlines a value the report flags even when it carries no marker of its own', async () => {
    // The stub's Persian Sunrise tagline reads as finished copy and has no sentinel in it.
    // The content package still records the field as outstanding, so it is outlined.
    const response = await h.app.inject({
      method: 'GET',
      url: '/blends/persian-sunrise/preview.html',
      headers: { cookie: editor.cookie },
    });
    expect(response.body).toContain('is-placeholder');
  });

  it('is reachable by a Viewer, because reading everything is what a Viewer is for', async () => {
    const viewer = await h.signIn('Viewer');
    const response = await h.app.inject({
      method: 'GET',
      url: '/blends/persian-sunrise/preview.html',
      headers: { cookie: viewer.cookie },
    });
    expect(response.statusCode).toBe(200);
  });

  it('is never cached, because it renders unpublished content behind a role', async () => {
    const response = await h.app.inject({
      method: 'GET',
      url: '/blends/persian-sunrise/preview.html',
      headers: { cookie: editor.cookie },
    });
    expect(response.headers['cache-control']).toBe('private, no-store');
  });
});
