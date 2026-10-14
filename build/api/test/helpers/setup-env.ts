/**
 * Test environment. Set before any src module is imported, because configuration is read
 * once at module load so a misconfiguration is a startup failure rather than a 500.
 *
 * Everything points at an in process DynamoDB compatible server. There is no AWS account
 * involved in running this suite, which is the point: the API has to be demonstrably
 * working before access lands.
 */

process.env.STAGE = 'local';
process.env.LOG_LEVEL = 'error';
process.env.AWS_REGION = 'us-east-1';
process.env.DYNAMODB_ENDPOINT = `http://127.0.0.1:${process.env.TEST_DDB_PORT ?? '4571'}`;
process.env.AWS_ACCESS_KEY_ID = 'local';
process.env.AWS_SECRET_ACCESS_KEY = 'local';

process.env.AUTH_ISSUER = 'https://auth.test.treveanspice.com';
process.env.AUTH_AUDIENCE = 'trevean-admin';
process.env.AUTH_ALLOW_DEV_TOKENS = 'true';
process.env.AUTH_DEV_SECRET_NAME = 'trevean/api/dev-jwt-secret';
process.env.SECRET_TREVEAN_API_DEV_JWT_SECRET = 'test-only-signing-key-0123456789abcdef';
process.env.SECRET_TREVEAN_API_SHOPIFY_WEBHOOK_SECRET = 'test-only-shopify-webhook-secret';

process.env.MEDIA_BUCKET = 'trevean-media-test';
process.env.MEDIA_CDN_BASE_URL = 'https://cdn.treveanspice.com';
