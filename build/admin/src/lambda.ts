import awsLambdaFastify from '@fastify/aws-lambda';
import { buildApp } from './server.js';
import { config } from './config.js';

/**
 * AWS Lambda entry point behind a function URL, which is where the admin is hosted.
 *
 * WHY LAMBDA AND NOT A CONTAINER. The admin is a Fastify server rendering forms, so it needs
 * a process rather than a bucket, but it does not need a process that is always awake. It is
 * used by a handful of people a few times a day. The publisher earns its always on Fargate
 * task because a render needs minutes of CPU and a writable filesystem; this does not, and a
 * second always on task would be a second $100 a month on the bill Trevean keeps after
 * handover. This is the same shape as content_api and scan_ingest: Fastify, a function URL,
 * an origin access control in front.
 *
 * THE FILESYSTEM IS READ ONLY EXCEPT /tmp, AND THAT IS DELIBERATELY NOT WORKED AROUND. The
 * seeded identity provider in auth/users.ts persists to disk, so on Lambda it would rewrite
 * its published passwords into an ephemeral directory on every cold start. That path is shut
 * by config.devIdentity rather than by making the write succeed, because the answer to "this
 * dangerous thing does not survive a cold start" is not to give it somewhere to live.
 *
 * The refusal below is the last line of that defence rather than the first. config.devIdentity
 * already defaults to false everywhere, and users.ts already throws if it is somehow on. This
 * exists because those are two files somebody could edit without thinking about deployment,
 * and this one is named lambda.ts, so it is where a person asks "what happens when this is
 * public".
 */

if (config.devIdentity) {
  throw new Error(
    'ADMIN_DEV_IDENTITY is set on a Lambda deployment. The seeded identity provider carries ' +
      'passwords that are written in this repository, and this function is reachable from the ' +
      'internet through CloudFront. Refusing to start. Identity comes from the managed provider ' +
      'in a deployed environment, per the frozen API contract, section 5.3.',
  );
}

type Proxy = ReturnType<typeof awsLambdaFastify>;

let proxyPromise: Promise<Proxy> | undefined;

function proxy(): Promise<Proxy> {
  if (!proxyPromise) {
    // The app and the proxy are built once per execution environment and reused, so a warm
    // invocation pays for neither. Cold start reads the frozen contract off disk to derive
    // the minimum role for every operation, which is the slowest thing here and is also the
    // thing that must not be skipped: it is what stops the admin and the API disagreeing
    // about who may do what.
    proxyPromise = buildApp().then((app) =>
      awsLambdaFastify(app, {
        // The admin serves its own CSS and a handful of images through @fastify/static.
        // Without these declared, binary responses arrive at the browser corrupted, because
        // the adapter has to know which content types to base64 encode on the way out.
        binaryMimeTypes: [
          'image/png',
          'image/jpeg',
          'image/webp',
          'image/avif',
          'image/x-icon',
          'font/woff2',
        ],
      }),
    );
  }
  return proxyPromise;
}

export const handler = async (event: unknown, context: unknown): Promise<unknown> => {
  const run = (await proxy()) as unknown as (e: unknown, c: unknown) => Promise<unknown>;
  return run(event, context);
};
