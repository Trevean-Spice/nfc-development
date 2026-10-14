import type { FastifyInstance } from 'fastify';
import { may, requireCsrf, requireOperation } from '../auth/guard.js';
import { ApiError } from '../api/errors.js';
import type { Media } from '../api/types.js';
import { apiFailure, crumbs, csrf, field } from '../views/components.js';
import { html, join, type RawHtml } from '../views/html.js';
import { page } from '../views/layout.js';
import { apiFor, intOf, nullable, sendHtml, text, type FormBody } from './support.js';

/**
 * The media library.
 *
 * Three calls, and the middle one does not touch this server at all: request a presigned S3
 * PUT, upload the file from the browser directly to S3, then mark it complete so derivative
 * generation starts. A large photograph never passes through an application function.
 * Premium brand photography plus a function mediated upload is a timeout and a memory limit
 * waiting to happen, and it puts image bytes on a code path that has to stay fast for other
 * reasons.
 *
 * Locally there is no S3, so step two fails and this screen says so plainly instead of
 * leaving a record stuck at `pending` with no explanation. The three call shape is the
 * shape that runs on AWS and it is the shape built here.
 */

function mediaRow(m: Media): RawHtml {
  return html`<tr>
    <td><code>${m.mediaId}</code></td>
    <td>${m.filename}</td>
    <td>${m.kind}</td>
    <td><span class="pill pill-${m.status}">${m.status}</span></td>
    <td>${m.bytes ? `${Math.round(m.bytes / 1024)} KB` : ''}</td>
    <td>${m.width && m.height ? `${m.width} by ${m.height}` : ''}</td>
    <td class="val">${m.alt ?? html`<span class="chip chip-placeholder_null">Alt text missing</span>`}</td>
  </tr>`;
}

export async function registerMediaRoutes(app: FastifyInstance): Promise<void> {
  app.get('/media', async (request, reply) => {
    const principal = requireOperation(request, 'adminListMedia');
    const api = apiFor(request);
    let media: Media[] = [];
    let failure: RawHtml | undefined;
    try {
      media = (await api.listMedia({ limit: 100 })).data;
    } catch (err) {
      failure = apiFailure(err);
    }

    const canUpload = may(principal, 'adminCreateMediaUpload');
    const body = html`<section class="card">
      <h1>Media</h1>
      ${failure ?? ''}
      <p class="hint">
        Alternative text is required before an image can appear on a published page, and a hero
        image that is still processing blocks publish. Both are the API's rules, shown here so
        an editor meets them before the publish screen refuses.
      </p>
      <table class="grid">
        <thead><tr><th>Id</th><th>File</th><th>Kind</th><th>Status</th><th>Size</th><th>Pixels</th><th>Alt text</th></tr></thead>
        <tbody>${join(media.map(mediaRow))}</tbody>
      </table>
      ${media.length === 0 && !failure ? html`<p class="empty">The media library is empty.</p>` : ''}
    </section>

    ${canUpload
      ? html`<section class="card">
          <h2>Upload</h2>
          <p class="hint">
            Hero images are served at 1280 by 955 and capped at 90 KB. Send the largest and
            least processed file you have, at least 2560 px wide; the derivatives are generated
            for you and nobody at Trevean has to think about image formats.
          </p>
          <form id="upload-form" data-csrf="${request.session?.csrf ?? ''}">
            <div class="field">
              <div class="field-head"><label for="file">File</label></div>
              <input type="file" id="file" name="file" accept="image/jpeg,image/png,image/webp,image/avif" />
            </div>
            <div class="field">
              <div class="field-head"><label for="kind">Kind</label></div>
              <select id="kind" name="kind">
                <option value="hero">hero</option>
                <option value="gallery">gallery</option>
                <option value="grower_portrait">grower_portrait</option>
                <option value="recipe">recipe</option>
              </select>
            </div>
            <div class="field">
              <div class="field-head"><label for="alt">Alternative text</label></div>
              <input type="text" id="alt" name="alt" maxlength="300" />
              <p class="hint">40 to 140 characters describing the photograph for somebody who cannot see it.</p>
            </div>
            <button class="btn primary" type="submit">Upload</button>
          </form>
          <div id="upload-log" class="uploadlog"></div>
        </section>`
      : ''}`;

    return sendHtml(reply, page({ title: 'Media', principal, active: 'media' }, body));
  });

  /** Step 1. Returns the presigned ticket to the browser, which then PUTs to S3 itself. */
  app.post('/media/ticket', async (request, reply) => {
    requireOperation(request, 'adminCreateMediaUpload');
    requireCsrf(request);
    const body = (request.body ?? {}) as FormBody;
    const api = apiFor(request);
    try {
      const ticket = await api.createMediaUpload({
        filename: text(body, 'filename'),
        contentType: text(body, 'contentType'),
        bytes: intOf(body, 'bytes'),
        kind: text(body, 'kind'),
        alt: nullable(body, 'alt'),
      });
      return reply.header('cache-control', 'private, no-store').send(ticket);
    } catch (err) {
      return replyApiError(reply, err);
    }
  });

  /** Step 3. The browser has finished its PUT. */
  app.post<{ Params: { mediaId: string } }>('/media/:mediaId/complete', async (request, reply) => {
    requireOperation(request, 'adminCompleteMediaUpload');
    requireCsrf(request);
    const body = (request.body ?? {}) as FormBody;
    const api = apiFor(request);
    try {
      const media = await api.completeMediaUpload(request.params.mediaId, { alt: nullable(body, 'alt') ?? null });
      return reply.header('cache-control', 'private, no-store').send(media);
    } catch (err) {
      return replyApiError(reply, err);
    }
  });

  app.get<{ Params: { mediaId: string } }>('/media/:mediaId', async (request, reply) => {
    const principal = requireOperation(request, 'adminGetMedia');
    const api = apiFor(request);
    try {
      const media = await api.getMedia(request.params.mediaId);
      const body = html`<section class="card narrow">
        ${crumbs([{ href: '/media', label: 'Media' }, { label: media.filename }])}
        <h1>${media.filename}</h1>
        ${field({ name: 'status', label: 'Status', value: media.status, readOnly: true, hint: 'Derivatives are asynchronous, so processing for a few seconds after an upload is normal rather than broken.' })}
        ${field({ name: 'alt', label: 'Alternative text', value: media.alt ?? '', readOnly: true })}
        ${field({ name: 'cdnUrl', label: 'CDN url', value: media.cdnUrl ?? '', readOnly: true })}
      </section>`;
      return sendHtml(reply, page({ title: media.filename, principal, active: 'media' }, body));
    } catch (err) {
      return sendHtml(
        reply,
        page({ title: 'Media', principal, active: 'media' }, html`<section class="card">${apiFailure(err)}</section>`),
        err instanceof ApiError ? err.status : 500,
      );
    }
  });
}

function replyApiError(reply: { status: (n: number) => { send: (b: unknown) => unknown } }, err: unknown): unknown {
  if (err instanceof ApiError) {
    return reply.status(err.status).send({
      error: { code: err.code, message: err.message, requestId: err.requestId, details: err.details },
    });
  }
  return reply.status(502).send({
    error: { code: 'UPSTREAM_UNAVAILABLE', message: (err as Error).message, requestId: '', details: [] },
  });
}
