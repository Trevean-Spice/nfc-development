/**
 * The single error envelope. API contract, section 4: every non 2xx response from every
 * endpoint has exactly this body, and no endpoint invents its own shape.
 */

export interface ErrorDetail {
  field: string;
  issue: string;
}

export interface ErrorBody {
  error: {
    code: string;
    message: string;
    requestId: string;
    details?: ErrorDetail[];
  };
}

/** Every error code the contract names, in one place, so a typo is a compile error. */
export const ErrorCodes = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  MALFORMED_JSON: 'MALFORMED_JSON',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  INSUFFICIENT_ROLE: 'INSUFFICIENT_ROLE',
  BLEND_NOT_FOUND: 'BLEND_NOT_FOUND',
  RECIPE_NOT_FOUND: 'RECIPE_NOT_FOUND',
  GROWER_NOT_FOUND: 'GROWER_NOT_FOUND',
  MEDIA_NOT_FOUND: 'MEDIA_NOT_FOUND',
  CATALOG_NOT_FOUND: 'CATALOG_NOT_FOUND',
  NOT_FOUND: 'NOT_FOUND',
  VERSION_CONFLICT: 'VERSION_CONFLICT',
  SLUG_TAKEN: 'SLUG_TAKEN',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  UNSUPPORTED_MEDIA_TYPE: 'UNSUPPORTED_MEDIA_TYPE',
  PUBLISH_BLOCKED: 'PUBLISH_BLOCKED',
  GROWER_REQUIRED: 'GROWER_REQUIRED',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  UPSTREAM_UNAVAILABLE: 'UPSTREAM_UNAVAILABLE',
  UPSTREAM_TIMEOUT: 'UPSTREAM_TIMEOUT',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  INVALID_SIGNATURE: 'INVALID_SIGNATURE',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly details?: ErrorDetail[],
    readonly headers?: Record<string, string>,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  toBody(requestId: string): ErrorBody {
    const body: ErrorBody = {
      error: { code: this.code, message: this.message, requestId },
    };
    if (this.details && this.details.length > 0) body.error.details = this.details;
    return body;
  }
}

export const badRequest = (message: string, details?: ErrorDetail[]): ApiError =>
  new ApiError(400, ErrorCodes.VALIDATION_FAILED, message, details);

export const malformedJson = (): ApiError =>
  new ApiError(400, ErrorCodes.MALFORMED_JSON, 'The request body is not valid JSON.');

export const unauthenticated = (message = 'Authentication is required for this endpoint.'): ApiError =>
  new ApiError(401, ErrorCodes.UNAUTHENTICATED, message);

export const tokenExpired = (): ApiError =>
  new ApiError(401, ErrorCodes.TOKEN_EXPIRED, 'The access token has expired. Sign in again.');

export const insufficientRole = (required: string, actual: string): ApiError =>
  new ApiError(403, ErrorCodes.INSUFFICIENT_ROLE, `This operation requires the ${required} role. Your role is ${actual}.`);

export const notFound = (code: ErrorCode, message: string, details?: ErrorDetail[]): ApiError =>
  new ApiError(404, code, message, details);

export const versionConflict = (message: string): ApiError =>
  new ApiError(409, ErrorCodes.VERSION_CONFLICT, message, [{ field: 'version', issue: 'stale' }]);

export const slugTaken = (slug: string): ApiError =>
  new ApiError(409, ErrorCodes.SLUG_TAKEN, `A blend already exists with slug '${slug}'.`);

export const payloadTooLarge = (maxBytes: number): ApiError =>
  new ApiError(413, ErrorCodes.PAYLOAD_TOO_LARGE, `The declared size exceeds the ${maxBytes} byte limit.`, [
    { field: 'bytes', issue: 'too_large' },
  ]);

export const unsupportedMediaType = (contentType: string): ApiError =>
  new ApiError(415, ErrorCodes.UNSUPPORTED_MEDIA_TYPE, `Content type '${contentType}' is not supported.`, [
    { field: 'contentType', issue: 'unsupported' },
  ]);

export const publishBlocked = (details: ErrorDetail[]): ApiError =>
  new ApiError(
    422,
    ErrorCodes.PUBLISH_BLOCKED,
    `This blend cannot be published yet. ${details.length} problem${details.length === 1 ? '' : 's'} must be fixed.`,
    details,
  );

export const rateLimited = (retryAfterSeconds: number): ApiError =>
  new ApiError(429, ErrorCodes.RATE_LIMITED, `Rate limit exceeded. Retry in ${retryAfterSeconds} seconds.`, undefined, {
    'retry-after': String(retryAfterSeconds),
  });

export const upstreamUnavailable = (message: string): ApiError =>
  new ApiError(502, ErrorCodes.UPSTREAM_UNAVAILABLE, message);

export const internalError = (): ApiError =>
  new ApiError(500, ErrorCodes.INTERNAL_ERROR, 'Something went wrong. Quote the requestId when reporting this.');
