/*
 * The Storefront API network boundary. Same shape and same reasoning as the Admin one.
 *
 * One difference matters for security review: the Storefront access token is a PUBLIC
 * token. It is designed to be readable by a browser, it grants read access to published
 * products and the ability to create carts, and it grants nothing else. It is still
 * fetched from the managed store rather than committed, because "public" is a statement
 * about its blast radius and not a licence to put a credential in version control, and
 * because a token in a repository cannot be rotated without a commit.
 */

import type { CredentialProvider } from '../admin/transport.js';

export interface StorefrontResponse<T = unknown> {
  data?: T;
  errors?: Array<{ message: string }>;
}

export interface StorefrontRequest {
  query: string;
  variables?: Record<string, unknown>;
}

export interface StorefrontTransport {
  execute<T = unknown>(request: StorefrontRequest): Promise<StorefrontResponse<T>>;
}

export interface HttpStorefrontTransportOptions {
  /** Public storefront domain, for example shop.treveanspice.com. */
  storefrontDomain: string;
  /** Storefront API version, pinned as YYYY-MM. */
  apiVersion: string;
  /** Name of the public storefront token in the managed store. NOT the token. */
  accessTokenSecretName: string;
  credentials: CredentialProvider;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/** NEVER EXERCISED BY THE TEST SUITE. See the note on HttpAdminTransport. */
export class HttpStorefrontTransport implements StorefrontTransport {
  constructor(private readonly options: HttpStorefrontTransportOptions) {
    if (!/^\d{4}-\d{2}$/.test(options.apiVersion)) {
      throw new Error(`Storefront API version must be pinned as YYYY-MM, received ${options.apiVersion}.`);
    }
  }

  get endpoint(): string {
    return `https://${this.options.storefrontDomain}/api/${this.options.apiVersion}/graphql.json`;
  }

  async execute<T = unknown>(request: StorefrontRequest): Promise<StorefrontResponse<T>> {
    const doFetch = this.options.fetchImpl ?? globalThis.fetch;
    const token = await this.options.credentials.get(this.options.accessTokenSecretName);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 10000);
    try {
      const response = await doFetch(this.endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-shopify-storefront-access-token': token,
          accept: 'application/json',
        },
        body: JSON.stringify({ query: request.query, variables: request.variables ?? {} }),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`Shopify Storefront API returned ${response.status}`);
      }
      return (await response.json()) as StorefrontResponse<T>;
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Replays a fixed response. Used by tests, never in production. */
export class RecordedStorefrontTransport implements StorefrontTransport {
  readonly requests: StorefrontRequest[] = [];
  constructor(private readonly responses: StorefrontResponse[]) {}

  async execute<T = unknown>(request: StorefrontRequest): Promise<StorefrontResponse<T>> {
    this.requests.push(request);
    const next = this.responses[this.requests.length - 1];
    if (!next) throw new Error('RecordedStorefrontTransport ran out of responses.');
    return next as StorefrontResponse<T>;
  }
}
