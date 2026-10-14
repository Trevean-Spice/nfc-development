/*
 * The network boundary, and the reason it is a separate file with one interface in it.
 *
 * We do not have Shopify Plus store access or credentials. That is an outstanding client
 * dependency, and it means the Admin API half of this package cannot be run against a real
 * store today. The choice that follows is between two things:
 *
 *   a) write the sync against fetch, leave it untested, and rewrite it when access lands;
 *   b) put the single network call behind an interface, write the sync against the
 *      interface, test it end to end against a recorded response, and make pointing it at
 *      a real store a matter of which implementation is constructed.
 *
 * This is (b). AdminTransport has one method. Everything above it, pagination, cost aware
 * throttling, retries, mapping, is real code exercised by the real test suite. The only
 * thing that has never run is HttpAdminTransport.execute, which is twenty lines of fetch,
 * and the only thing that changes when credentials arrive is which class is constructed.
 *
 * So the boundary is not architectural neatness, it is the difference between "this awaits
 * a configuration value" and "this awaits a rewrite".
 */

export interface AdminGraphQLResponse<T = unknown> {
  data?: T;
  errors?: Array<{ message: string; extensions?: Record<string, unknown> }>;
  extensions?: {
    cost?: {
      requestedQueryCost?: number;
      actualQueryCost?: number;
      throttleStatus?: {
        maximumAvailable?: number;
        currentlyAvailable?: number;
        restoreRate?: number;
      };
    };
  };
}

export interface AdminRequest {
  query: string;
  variables?: Record<string, unknown>;
}

export interface AdminTransport {
  execute<T = unknown>(request: AdminRequest): Promise<AdminGraphQLResponse<T>>;
}

export class AdminTransportError extends Error {
  readonly status: number | null;
  readonly retryable: boolean;
  constructor(message: string, status: number | null, retryable: boolean) {
    super(message);
    this.name = 'AdminTransportError';
    this.status = status;
    this.retryable = retryable;
  }
}

/** Resolves a secret by name from a managed store. Never a secret value in configuration. */
export interface CredentialProvider {
  get(name: string): Promise<string>;
}

export interface HttpAdminTransportOptions {
  /** The myshopify admin domain, for example trevean-spice.myshopify.com. */
  shopDomain: string;
  /** Admin API version, for example 2025-01. Pinned, never "unstable" and never latest. */
  apiVersion: string;
  /** Name of the access token in the managed secret store. NOT the token. */
  accessTokenSecretName: string;
  credentials: CredentialProvider;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/**
 * The real transport. NEVER EXERCISED BY THE TEST SUITE, by design: a test that calls a
 * real store is a test that cannot run, and a test that mocks fetch proves only that the
 * mock was called. It is listed in the README under what awaits store access, because
 * claiming verified behaviour against a store we have never called would be a false claim.
 *
 * The token is fetched per call from the managed store rather than captured at
 * construction, so a rotation takes effect without a redeploy and the value is never held
 * on a long lived object where a heap dump would find it.
 */
export class HttpAdminTransport implements AdminTransport {
  private readonly options: HttpAdminTransportOptions;

  constructor(options: HttpAdminTransportOptions) {
    if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(options.shopDomain)) {
      throw new AdminTransportError(`Not a myshopify admin domain: ${options.shopDomain}`, null, false);
    }
    if (!/^\d{4}-\d{2}$/.test(options.apiVersion)) {
      throw new AdminTransportError(
        `Admin API version must be pinned as YYYY-MM, received ${options.apiVersion}. An unpinned version changes the payload shape without a deploy.`,
        null,
        false,
      );
    }
    this.options = options;
  }

  get endpoint(): string {
    return `https://${this.options.shopDomain}/admin/api/${this.options.apiVersion}/graphql.json`;
  }

  async execute<T = unknown>(request: AdminRequest): Promise<AdminGraphQLResponse<T>> {
    const doFetch = this.options.fetchImpl ?? globalThis.fetch;
    const token = await this.options.credentials.get(this.options.accessTokenSecretName);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 15000);
    try {
      const response = await doFetch(this.endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-shopify-access-token': token,
          accept: 'application/json',
        },
        body: JSON.stringify({ query: request.query, variables: request.variables ?? {} }),
        signal: controller.signal,
      });
      if (response.status === 429 || response.status >= 500) {
        throw new AdminTransportError(`Shopify Admin API returned ${response.status}`, response.status, true);
      }
      if (!response.ok) {
        // The body is deliberately not included. A 401 body from Shopify can echo request
        // details, and this message reaches logs.
        throw new AdminTransportError(`Shopify Admin API returned ${response.status}`, response.status, false);
      }
      return (await response.json()) as AdminGraphQLResponse<T>;
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Replays recorded or simulated responses in order.
 *
 * The fixtures behind this are SIMULATED, hand built to the documented Admin API response
 * shape, because there is no store to record from. They are labelled as such in the
 * fixture files themselves and in the README, and they are not evidence about Trevean's
 * catalog. What they do prove is that pagination, cost handling, mapping and error
 * handling behave correctly on a response of that shape.
 */
export class RecordedAdminTransport implements AdminTransport {
  private readonly responses: AdminGraphQLResponse[];
  private index = 0;
  readonly requests: AdminRequest[] = [];

  constructor(responses: AdminGraphQLResponse[]) {
    this.responses = responses;
  }

  async execute<T = unknown>(request: AdminRequest): Promise<AdminGraphQLResponse<T>> {
    this.requests.push(request);
    const response = this.responses[this.index];
    if (!response) {
      throw new AdminTransportError(
        `RecordedAdminTransport ran out of responses after ${this.index}. The sync made more calls than the recording covers.`,
        null,
        false,
      );
    }
    this.index += 1;
    return response as AdminGraphQLResponse<T>;
  }
}

/** Fails on demand, so retry and backoff behaviour is exercised without a network. */
export class FailingAdminTransport implements AdminTransport {
  private attempts = 0;
  constructor(
    private readonly failures: number,
    private readonly then: AdminTransport,
    private readonly retryable = true,
  ) {}

  async execute<T = unknown>(request: AdminRequest): Promise<AdminGraphQLResponse<T>> {
    if (this.attempts < this.failures) {
      this.attempts += 1;
      throw new AdminTransportError('Simulated upstream failure', this.retryable ? 503 : 400, this.retryable);
    }
    return this.then.execute<T>(request);
  }
}
