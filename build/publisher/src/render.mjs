/*
 * Rendering, which is a child process and not a second template.
 *
 * The pages a customer reads are produced by build/web: `next build` in export mode, then
 * scripts/postbuild.mjs, which rebuilds each document from the rendered markup, inlines the
 * critical CSS, strips the framework runtime and asserts the byte budget. That pipeline is
 * what produced every page currently in the site bucket.
 *
 * So the publisher runs THAT, rather than rendering a page of its own. A second renderer
 * would be a second definition of what a blend page is, and the two would drift in exactly
 * the places nobody is looking. It costs more seconds per publish than a bespoke template
 * would, and the budget for those seconds is five minutes.
 *
 * Two modes:
 *
 *   prebuilt   publish whatever is already in the render directory. This is what a
 *              re-publish of unchanged content needs, what the manual revalidate escape
 *              hatch needs, and what most of the test suite needs.
 *   build      run the web build first, with TREVEAN_CONTENT_API pointed at the API, so
 *              that the edit an editor just saved is what gets rendered. This is the mode
 *              that makes the acceptance criterion true.
 *
 * The build is not incremental. `next build` renders every page, and the publisher then
 * publishes only the objects whose bytes changed, so the work that reaches the origin and
 * the CDN is exactly the affected pages even though the render is not. That is the honest
 * description and it is worth stating, because the Architecture document, "Rendering", says
 * regeneration takes a couple of hundred milliseconds and a full export does not.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { assertFreshContentRead, newReadToken, TOKEN_ENV } from './content-read.mjs';

export class RenderFailed extends Error {
  constructor(message, detail) {
    super(message);
    this.name = 'RenderFailed';
    this.detail = detail;
  }
}

function npm(args, { cwd, env, timeoutMs, label }) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const child = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, {
      cwd,
      env,
      shell: process.platform === 'win32',
    });

    /*
     * The child's output is both buffered and echoed, and the echo is not a debugging
     * leftover.
     *
     * Buffered, because the tail of it becomes the detail on RenderFailed, which is what a
     * caller reading the job status needs. Echoed, because that detail does not reach
     * CloudWatch: the task log held eight startup lines and nothing else, so three
     * consecutive render failures on Monday 7 September 2026 each had to be diagnosed by
     * reproducing them on a laptop instead of by reading the log of the run that failed.
     * A render is minutes and a reproduction is twenty, and the log is free.
     *
     * Line prefixed with the step label, because two steps write to this stream and a
     * `next build` trace interleaved with a content fetch trace is worse than either alone.
     */
    let stdout = '';
    let stderr = '';
    const echo = (stream, chunk) => {
      for (const line of String(chunk).split('\n')) {
        if (line.trim() !== '') stream.write(`  [${label}] ${line}\n`);
      }
    };
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      echo(process.stdout, chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      echo(process.stderr, chunk);
    });

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new RenderFailed(`${label} did not finish within ${timeoutMs} ms.`, stderr.slice(-4000)));
    }, timeoutMs);

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new RenderFailed(`${label} could not be started: ${err.message}`, null));
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ elapsedMs: Date.now() - started, stdout: stdout.slice(-4000) });
      else {
        reject(
          new RenderFailed(
            `${label} exited ${code}. The previous version is still serving and nothing was published.`,
            `${stdout.slice(-2000)}\n${stderr.slice(-2000)}`,
          ),
        );
      }
    });
  });
}

/**
 * Two steps, and the first one is the one that makes an edit visible.
 *
 * `content:fetch` reads the API and writes the snapshot the build renders from. Without it
 * the build renders the fixtures in build/content and an editor's change never reaches a
 * page, which is a failure that looks exactly like success on every local run.
 *
 * With no content API configured the fetch is skipped and the build renders the content
 * package, which is the correct behaviour for a re-publish of the current fixtures.
 *
 * THE READ IS PROVED FRESH BETWEEN THE TWO STEPS, and the position in the order is the
 * point. /v1 content reads are cacheable at the edge by the frozen contract, so a read taken
 * through the apex distribution can be answered with the version from before the edit this
 * publish was dispatched for. Every read carries a per render cache buster; this is where it
 * is checked that every read actually carried it and that no response was claimed by a cache.
 * Checking here rather than after the build means a stale read costs a refusal instead of two
 * hundred seconds of rendering followed by a refusal, and checking here rather than at the
 * read back is the whole point: the read back compares the published page against what the
 * renderer produced, so a renderer fed stale content compares stale against stale and passes.
 *
 * See content-read.mjs for the argument, and for the four alternatives that were rejected.
 */
export async function runWebBuild({ webDir, contentApiBaseUrl, timeoutMs, env = process.env }) {
  if (!existsSync(webDir)) throw new RenderFailed(`the web package was not found at ${webDir}.`, null);

  const childEnv = { ...env };
  const readToken = newReadToken();
  if (contentApiBaseUrl) {
    childEnv.TREVEAN_CONTENT_API = contentApiBaseUrl;
    childEnv[TOKEN_ENV] = readToken;
  } else {
    delete childEnv.TREVEAN_CONTENT_API;
    delete childEnv[TOKEN_ENV];
  }

  // build/web resolves the snapshot the same way, from TREVEAN_CONTENT_SNAPSHOT or from its
  // own directory. Resolved here from the child's environment rather than from this process's,
  // so the two can never disagree about which file is being judged.
  const snapshotDir = resolve(childEnv.TREVEAN_CONTENT_SNAPSHOT ?? join(webDir, '.content-snapshot'));

  const steps = [];
  let contentRead = null;
  if (contentApiBaseUrl) {
    steps.push(
      await npm(['run', 'content:fetch'], {
        cwd: webDir,
        env: childEnv,
        timeoutMs,
        label: 'the content snapshot fetch',
      }),
    );
    // Deliberately not wrapped in RenderFailed. A StaleContentRead is not a render that went
    // wrong, it is a render that must not happen, and it carries its own explanation.
    contentRead = assertFreshContentRead({ snapshotDir, baseUrl: contentApiBaseUrl, token: readToken });
  }
  steps.push(await npm(['run', 'build'], { cwd: webDir, env: childEnv, timeoutMs, label: 'the web build' }));

  return {
    elapsedMs: steps.reduce((total, step) => total + step.elapsedMs, 0),
    fetchMs: contentApiBaseUrl ? steps[0].elapsedMs : 0,
    buildMs: steps[steps.length - 1].elapsedMs,
    stdout: steps[steps.length - 1].stdout,
    contentRead,
  };
}
