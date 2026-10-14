import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setup, form, FORM_HEADERS, type Harness, type Session } from '../helpers/harness.js';

/**
 * Publish, the placeholder guard, and whether the editor is told the truth about what
 * happened.
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

const PHRASE = 'PUBLISH PLACEHOLDER CONTENT';

describe('the placeholder publish guard', () => {
  it('refuses a publish of placeholder content with no override, and says which fields', async () => {
    const response = await h.app.inject({
      method: 'POST',
      url: '/blends/persian-sunrise/publish',
      payload: form(editor, { version: 1 }),
      headers: { cookie: editor.cookie, ...FORM_HEADERS },
    });
    expect(response.statusCode).toBe(422);
    expect(response.body).toContain('Not published');
    expect(response.body).toContain(PHRASE);
    expect(h.stub.state.publishCalls).toBe(0);
  });

  it('refuses when the phrase is typed but the reason is too short', async () => {
    const response = await h.app.inject({
      method: 'POST',
      url: '/blends/persian-sunrise/publish',
      payload: form(editor, { version: 1, override_phrase: PHRASE, override_reason: 'because', override_ack: 'on' }),
      headers: { cookie: editor.cookie, ...FORM_HEADERS },
    });
    expect(response.statusCode).toBe(422);
    expect(response.body).toContain('at least 20 characters');
    expect(h.stub.state.publishCalls).toBe(0);
  });

  it('refuses when the acknowledgement is not ticked', async () => {
    const response = await h.app.inject({
      method: 'POST',
      url: '/blends/persian-sunrise/publish',
      payload: form(editor, {
        version: 1,
        override_phrase: PHRASE,
        override_reason: 'The gate rehearsal needs a live page even though content is outstanding.',
      }),
      headers: { cookie: editor.cookie, ...FORM_HEADERS },
    });
    expect(response.statusCode).toBe(422);
    expect(response.body).toContain('acknowledgement');
    expect(h.stub.state.publishCalls).toBe(0);
  });

  it('refuses when the phrase is close but not exact', async () => {
    const response = await h.app.inject({
      method: 'POST',
      url: '/blends/persian-sunrise/publish',
      payload: form(editor, {
        version: 1,
        override_phrase: 'publish placeholder content',
        override_reason: 'The gate rehearsal needs a live page even though content is outstanding.',
        override_ack: 'on',
      }),
      headers: { cookie: editor.cookie, ...FORM_HEADERS },
    });
    expect(response.statusCode).toBe(422);
    expect(h.stub.state.publishCalls).toBe(0);
  });

  it('allows the publish when all three are given together, and records the override', async () => {
    const response = await h.app.inject({
      method: 'POST',
      url: '/blends/persian-sunrise/publish',
      payload: form(editor, {
        version: 1,
        override_phrase: PHRASE,
        override_reason: 'The M2 gate rehearsal needs a live page while content is still outstanding from Trevean.',
        override_ack: 'on',
      }),
      headers: { cookie: editor.cookie, ...FORM_HEADERS },
    });
    expect(response.statusCode).toBe(200);
    expect(h.stub.state.publishCalls).toBe(1);
    expect(response.body).toContain('Placeholder content was published under an override');

    const { recent } = await import('../../src/publish/audit.js');
    const events = recent(20).map((e) => e.event);
    expect(events).toContain('placeholder_override');
    expect(events).toContain('publish');
    const override = recent(20).find((e) => e.event === 'placeholder_override');
    expect(override?.email).toBe('editor@treveanspice.com');
    expect(String(override?.detail['reason'])).toContain('M2 gate rehearsal');
  });
});

describe('publish tells the editor exactly what was queued', () => {
  it('lists the affected paths and nothing else', async () => {
    const response = await h.app.inject({
      method: 'POST',
      url: '/blends/persian-sunrise/publish',
      payload: form(editor, {
        version: 2,
        override_phrase: PHRASE,
        override_reason: 'Second publish, checking the queued path list is the affected pages only.',
        override_ack: 'on',
      }),
      headers: { cookie: editor.cookie, ...FORM_HEADERS },
    });
    expect(response.body).toContain('/blend.html?blend=persian-sunrise');
    expect(response.body).toContain('/blends/persian-sunrise');
    expect(response.body).toContain('/sitemap.xml');
    expect(response.body).not.toContain('/blends/kyoto-garden');
  });

  it('confirms the public route is serving the new version rather than assuming it', async () => {
    const response = await h.app.inject({
      method: 'POST',
      url: '/blends/persian-sunrise/publish',
      payload: form(editor, {
        version: 3,
        override_phrase: PHRASE,
        override_reason: 'Third publish, checking the confirming read reports what it actually observed.',
        override_ack: 'on',
      }),
      headers: { cookie: editor.cookie, ...FORM_HEADERS },
    });
    expect(response.body).toContain('Confirmed live at the origin');
    expect(response.body).toContain('within 5 minutes');
  });
});

describe('failure is surfaced and never swallowed', () => {
  it('a 422 from the API is shown with its code, its message and every blocking field', async () => {
    // kyoto-garden has no grower in the stub, which is exactly what the API refuses on.
    const response = await h.app.inject({
      method: 'POST',
      url: '/blends/kyoto-garden/publish',
      payload: form(editor, {
        version: 1,
        override_phrase: PHRASE,
        override_reason: 'Deliberately publishing a blend the API will refuse, to check the refusal is shown.',
        override_ack: 'on',
      }),
      headers: { cookie: editor.cookie, ...FORM_HEADERS },
    });
    expect(response.statusCode).toBe(422);
    expect(response.body).toContain('PUBLISH_BLOCKED');
    expect(response.body).toContain('growerId');
    expect(response.body).toContain('required for publish');
    expect(response.body).toContain('Not published');
  });

  it('a version conflict on save is shown as a conflict, not as a success', async () => {
    const response = await h.app.inject({
      method: 'POST',
      url: '/blends/persian-sunrise',
      payload: form(editor, { version: 1, name: 'Persian Sunrise' }),
      headers: { cookie: editor.cookie, ...FORM_HEADERS },
    });
    expect(response.statusCode).toBe(409);
    expect(response.body).toContain('VERSION_CONFLICT');
    expect(response.body).toContain('Nothing was saved');
  });

  it('an API that cannot be reached is reported rather than rendered as an empty list', async () => {
    const { ApiClient } = await import('../../src/api/client.js');
    const { mintApiToken } = await import('../../src/auth/tokens.js');
    const client = new ApiClient(
      { subject: 'usr_test', email: 'admin@treveanspice.com', name: 'Admin', role: 'Admin' },
      mintApiToken,
      'http://127.0.0.1:1',
    );
    await expect(client.listBlends()).rejects.toMatchObject({ name: 'ApiUnreachable' });
  });
});

describe('the manual revalidation escape hatch', () => {
  it('queues the affected paths and records who asked for it', async () => {
    const response = await h.app.inject({
      method: 'POST',
      url: '/revalidate',
      payload: form(editor, { slug: 'persian-sunrise', reason: 'Cache and data disagreed after the 08:00 sync.' }),
      headers: { cookie: editor.cookie, ...FORM_HEADERS },
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('Revalidation queued');
    const { recent } = await import('../../src/publish/audit.js');
    expect(recent(20).some((e) => e.event === 'revalidate')).toBe(true);
  });
});
