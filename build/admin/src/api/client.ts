import { config } from '../config.js';
import { contract } from '../contract.js';
import { satisfies, type Principal } from '../auth/roles.js';
import { ApiError, ApiUnreachable } from './errors.js';
import type {
  Blend,
  BlendSummary,
  Grower,
  ListEnvelope,
  Media,
  MediaUploadTicket,
  PublishResult,
  Recipe,
  RevalidateResult,
  ScanTimeSeries,
  TagRecordList,
} from './types.js';

/**
 * The one door to the API.
 *
 * Every method names the contract operation it calls. Before a request leaves this process
 * the caller's role is checked against that operation's `x-minimum-role` in the frozen
 * document. That is the second of the three role checks in the system, and it exists so a
 * route registered without a guard, or guarded with the wrong role, fails here rather than
 * reaching the API and depending on the API being right.
 *
 * Nothing in this file invents an endpoint. Where the admin needs something the contract
 * does not offer, it is reported as a gap in the README rather than added quietly, because
 * a contract two engineers have been building against for seven weeks is only worth
 * freezing if it stays frozen.
 */

export interface ApiCallOptions {
  method?: string;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  idempotencyKey?: string;
  /** Public content reads take no credential, per the contract, section 5.1. */
  anonymous?: boolean;
}

export interface RawResponse {
  status: number;
  requestId: string;
  body: unknown;
}

export type TokenMinter = (principal: Principal) => Promise<string>;

export class ApiClient {
  constructor(
    private readonly principal: Principal | undefined,
    private readonly mintToken: TokenMinter,
    private readonly baseUrl: string = config.apiBaseUrl,
  ) {}

  private assertRole(operationId: string): void {
    const required = contract().minimumRole(operationId);
    const path = contract().operation(operationId).path;
    if (!path.startsWith('/v1/admin/')) return;
    if (!this.principal) {
      throw new ApiError(401, 'UNAUTHENTICATED', 'No signed in user for an admin operation.', '', [], operationId);
    }
    if (!satisfies(this.principal.role, required)) {
      throw new ApiError(
        403,
        'INSUFFICIENT_ROLE',
        `${operationId} requires the ${required} role. Your role is ${this.principal.role}.`,
        '',
        [],
        operationId,
      );
    }
  }

  async call(operationId: string, pathParams: Record<string, string>, options: ApiCallOptions = {}): Promise<RawResponse> {
    const op = contract().operation(operationId);
    this.assertRole(operationId);

    let path = op.path;
    for (const [key, value] of Object.entries(pathParams)) {
      path = path.replace(`{${key}}`, encodeURIComponent(value));
    }
    if (path.includes('{')) {
      throw new Error(`Path parameters missing for ${operationId}: ${path}`);
    }

    const url = new URL(this.baseUrl + path);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
    }

    const headers: Record<string, string> = { accept: 'application/json' };
    if (options.body !== undefined) headers['content-type'] = 'application/json';
    if (options.idempotencyKey) headers['idempotency-key'] = options.idempotencyKey;
    if (!options.anonymous && this.principal) {
      headers['authorization'] = `Bearer ${await this.mintToken(this.principal)}`;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.api.timeoutMs);
    let response: Response;
    try {
      response = await fetch(url, {
        method: options.method ?? op.method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal,
      });
    } catch (err) {
      throw new ApiUnreachable(
        operationId,
        this.baseUrl,
        `Could not reach the API at ${this.baseUrl}. ${(err as Error).message}`,
      );
    } finally {
      clearTimeout(timer);
    }

    const requestId = response.headers.get('x-request-id') ?? '';
    const text = await response.text();
    let body: unknown = undefined;
    if (text.length > 0) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }

    if (response.status >= 400) {
      throw ApiError.from(response.status, body, operationId, requestId);
    }
    return { status: response.status, requestId, body };
  }

  private async json<T>(operationId: string, pathParams: Record<string, string>, options: ApiCallOptions = {}): Promise<T> {
    const res = await this.call(operationId, pathParams, options);
    return res.body as T;
  }

  // Admin content

  listBlends(query: { status?: string; limit?: number; cursor?: string } = {}): Promise<ListEnvelope<BlendSummary>> {
    return this.json('adminListBlends', {}, { query });
  }

  getBlend(slug: string, include: string[] = []): Promise<Blend> {
    return this.json('adminGetBlend', { slug }, { query: { include: include.join(',') || undefined } });
  }

  createBlend(body: Record<string, unknown>, idempotencyKey?: string): Promise<Blend> {
    return this.json('adminCreateBlend', {}, { body, idempotencyKey });
  }

  updateBlend(slug: string, body: Record<string, unknown>): Promise<Blend> {
    return this.json('adminUpdateBlend', { slug }, { body });
  }

  publishBlend(slug: string, body: { version?: number; note?: string | null }): Promise<PublishResult> {
    return this.json('adminPublishBlend', { slug }, { body });
  }

  revalidate(body: { blendSlugs?: string[]; paths?: string[]; reason?: string | null }): Promise<RevalidateResult> {
    return this.json('adminRevalidate', {}, { body });
  }

  createRecipe(body: Record<string, unknown>, idempotencyKey?: string): Promise<Recipe> {
    return this.json('adminCreateRecipe', {}, { body, idempotencyKey });
  }

  updateRecipe(recipeId: string, body: Record<string, unknown>): Promise<Recipe> {
    return this.json('adminUpdateRecipe', { recipeId }, { body });
  }

  async archiveRecipe(recipeId: string): Promise<void> {
    await this.call('adminDeleteRecipe', { recipeId });
  }

  createGrower(body: Record<string, unknown>, idempotencyKey?: string): Promise<Grower> {
    return this.json('adminCreateGrower', {}, { body, idempotencyKey });
  }

  updateGrower(growerId: string, body: Record<string, unknown>): Promise<Grower> {
    return this.json('adminUpdateGrower', { growerId }, { body });
  }

  listMedia(query: { kind?: string; limit?: number; cursor?: string } = {}): Promise<ListEnvelope<Media>> {
    return this.json('adminListMedia', {}, { query });
  }

  getMedia(mediaId: string): Promise<Media> {
    return this.json('adminGetMedia', { mediaId });
  }

  createMediaUpload(body: Record<string, unknown>): Promise<MediaUploadTicket> {
    return this.json('adminCreateMediaUpload', {}, { body });
  }

  completeMediaUpload(mediaId: string, body: { alt?: string | null }): Promise<Media> {
    return this.json('adminCompleteMediaUpload', { mediaId }, { body });
  }

  scanTimeSeries(query: { from: string; to: string; granularity?: string; blend?: string }): Promise<ScanTimeSeries> {
    return this.json('adminGetScanTimeSeries', {}, { query });
  }

  tagRecords(): Promise<TagRecordList> {
    return this.json('adminListTagRecords', {});
  }

  // Public content reads. Unauthenticated by design, per the contract, section 5.1: every
  // byte they return is already public in the rendered page. Used by the admin for exactly
  // one purpose, which is confirming after a publish that the origin is serving the new
  // version. See publish/verify.ts.

  publicBlend(slug: string): Promise<BlendSummary> {
    return this.json('getBlendBySlug', { slug }, { anonymous: true });
  }

  /**
   * The grower list and the single grower read.
   *
   * GAP IN THE FROZEN CONTRACT, reported rather than worked around: there is no
   * `GET /v1/admin/growers` and no `GET /v1/admin/growers/{growerId}`. The contract has
   * POST and PATCH for growers and nothing to read them with under `/v1/admin`. The
   * public routes are used instead, which is contract legal and costs nothing here because
   * growers carry no publication status and every field on them is already public in the
   * rendered page. See the README, "Gaps found in the frozen contract".
   */
  listGrowers(query: { limit?: number; cursor?: string } = {}): Promise<ListEnvelope<Grower>> {
    return this.json('listGrowers', {}, { query, anonymous: true });
  }

  getGrower(growerId: string): Promise<Grower> {
    return this.json('getGrower', { growerId }, { anonymous: true });
  }

  /**
   * Recipes for a blend. The admin reads them through `adminGetBlend?include=recipes`,
   * which is the only route that returns DRAFT recipes. This public route is used only
   * where the published set is what is wanted.
   */
  listBlendRecipes(slug: string): Promise<ListEnvelope<Recipe>> {
    return this.json('listRecipesForBlend', { slug }, { anonymous: true });
  }
}
