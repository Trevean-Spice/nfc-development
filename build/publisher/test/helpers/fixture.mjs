/*
 * A render directory and a stand in site, built fresh per test, in a temporary directory.
 * Nothing here touches the real build/web output and nothing here needs AWS.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { loadConfig } from '../../src/config.mjs';

export const REAL_BLEND_HTML = (slug, marker = '') =>
  `<!doctype html><html lang="en"><head><title>${slug}</title></head><body><h1>${slug}</h1>${marker}</body></html>`;

export function makeFixture({ stage = 'local', placeholder = false, extraFiles = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'trevean-publisher-'));
  const renderDir = join(root, 'out');
  const siteDir = join(root, 'site');
  const contentDir = join(root, 'content');

  mkdirSync(join(contentDir, 'spec'), { recursive: true });
  writeFileSync(
    join(contentDir, 'spec', 'content-field-spec.json'),
    JSON.stringify({
      conventionVersion: 1,
      sentinel: '[PLACEHOLDER]',
      secondaryMarker: 'NOT REAL CONTENT',
      entities: { blend: { label: 'Blend', fields: [] } },
    }),
  );

  const marker = placeholder ? '<p>[PLACEHOLDER] NOT REAL CONTENT</p>' : '';
  const files = {
    'blends/persian-sunrise.html': REAL_BLEND_HTML('persian-sunrise', marker),
    'blends/caribbean-sunset.html': REAL_BLEND_HTML('caribbean-sunset'),
    'blend.html': REAL_BLEND_HTML('jar not recognised'),
    'sitemap.xml': '<?xml version="1.0"?><urlset></urlset>',
    'js/enhance.js': 'console.log("after paint only");',
    'media/persian-sunrise/hero.avif': 'not really an image',
    ...extraFiles,
  };
  for (const [key, body] of Object.entries(files)) {
    const file = join(renderDir, ...key.split('/'));
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, body);
  }

  const config = loadConfig({
    STAGE: stage,
    PUBLISH_TARGET: stage === 'production' ? 's3' : 'local',
    PUBLISHER_RENDER_DIR: renderDir,
    PUBLISHER_LOCAL_SITE_DIR: siteDir,
    PUBLISHER_CONTENT_DIR: contentDir,
    PUBLISHER_RENDER_MODE: 'prebuilt',
    PUBLISHER_VERIFY_ATTEMPTS: '25',
    PUBLISHER_VERIFY_INTERVAL_MS: '20',
    SITE_BUCKET: 'trevean-test-site',
    CLOUDFRONT_DISTRIBUTION_ID: 'ETESTDISTRIBUTION',
  });

  return {
    root,
    renderDir,
    siteDir,
    contentDir,
    config,
    writeRendered(key, body) {
      const file = join(renderDir, ...key.split('/'));
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, body);
    },
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

export function listen(server) {
  return new Promise((resolveListen) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolveListen(`http://127.0.0.1:${port}`);
    });
  });
}

export function close(server) {
  return new Promise((resolveClose) => server.close(resolveClose));
}

export const publisherRoot = resolve(dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), '..', '..');
