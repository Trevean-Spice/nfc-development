import awsLambdaFastify from '@fastify/aws-lambda';
import { buildApp } from './app.js';

/**
 * AWS Lambda entry point behind API Gateway or a Lambda function URL.
 *
 * The app and the proxy are built once per container and reused across invocations, which
 * is what keeps warm invocations inside the <200 ms p95 content retrieval target. That
 * target protects publish-to-live and the admin experience, not the 2.0 second tap budget:
 * the tap path does not call this API at all.
 *
 * The rollup stream consumer is a separate handler. See stream/consumer.ts.
 */

type Proxy = ReturnType<typeof awsLambdaFastify>;

let proxyPromise: Promise<Proxy> | undefined;

function proxy(): Promise<Proxy> {
  if (!proxyPromise) {
    proxyPromise = buildApp().then((app) => awsLambdaFastify(app));
  }
  return proxyPromise;
}

export const handler = async (event: unknown, context: unknown): Promise<unknown> => {
  const run = (await proxy()) as unknown as (e: unknown, c: unknown) => Promise<unknown>;
  return run(event, context);
};
