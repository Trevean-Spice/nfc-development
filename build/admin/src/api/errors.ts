/**
 * The single error shape returned by every non 2xx response from every operation, per the
 * frozen API contract, section 4. The admin branches on `code` and never on `message`.
 *
 * Nothing here is swallowed. An operation that fails is shown to the editor with its code,
 * its message, its requestId and every field level detail, because the requestId is what
 * gets pasted into a support message and a failure an editor cannot see is a failure they
 * will report as "the site is broken".
 */

export interface ErrorDetail {
  field: string;
  issue: string;
}

export interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    requestId: string;
    details?: ErrorDetail[];
  };
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    override readonly message: string,
    readonly requestId: string,
    readonly details: ErrorDetail[],
    readonly operationId: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  static from(status: number, body: unknown, operationId: string, requestId: string): ApiError {
    const envelope = body as ErrorEnvelope | undefined;
    const error = envelope?.error;
    if (error && typeof error.code === 'string') {
      return new ApiError(
        status,
        error.code,
        error.message ?? 'The API returned an error with no message.',
        error.requestId ?? requestId,
        Array.isArray(error.details) ? error.details : [],
        operationId,
      );
    }
    return new ApiError(
      status,
      'UNEXPECTED_RESPONSE',
      `The API returned ${status} with a body that is not the contract error envelope.`,
      requestId,
      [],
      operationId,
    );
  }
}

/** A failure to reach the API at all. Distinct from an error the API chose to return. */
export class ApiUnreachable extends Error {
  constructor(
    readonly operationId: string,
    readonly baseUrl: string,
    override readonly message: string,
  ) {
    super(message);
    this.name = 'ApiUnreachable';
  }
}

/**
 * Plain language for the codes an editor can actually cause. Anything not in this map is
 * shown with its raw code, which is better than a friendly sentence that hides which
 * condition fired.
 */
export const CODE_EXPLANATIONS: Record<string, string> = {
  VERSION_CONFLICT:
    'Somebody else saved this record after you opened it. Nothing has been lost. Reload the page, read their change, and apply yours on top.',
  PUBLISH_BLOCKED:
    'The blend cannot be published yet. Every blocking problem is listed below, all at once rather than one at a time.',
  INSUFFICIENT_ROLE: 'Your role does not allow this action.',
  UNAUTHENTICATED: 'Your session is not valid for the API. Sign out and sign in again.',
  TOKEN_EXPIRED: 'Your session expired. Sign in again.',
  SLUG_TAKEN: 'A blend already exists with that slug.',
  VALIDATION_FAILED: 'The API rejected the values below. Nothing was saved.',
  BLEND_NOT_FOUND: 'No blend exists with that slug.',
  RECIPE_NOT_FOUND: 'No recipe exists with that id.',
  GROWER_NOT_FOUND: 'No grower exists with that id.',
  MEDIA_NOT_FOUND: 'No media record exists with that id.',
  RATE_LIMITED: 'Too many requests. Wait a moment and try again.',
  UPSTREAM_UNAVAILABLE: 'A service the API depends on did not answer.',
  INTERNAL_ERROR: 'The API failed on its own side. Quote the request id below when reporting it.',
};
