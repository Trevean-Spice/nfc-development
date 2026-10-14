import { config } from '../config.js';
import { may } from '../auth/guard.js';
import type { Principal } from '../auth/roles.js';
import { html, join, raw, type RawHtml } from './html.js';

/**
 * The shell.
 *
 * Two rules govern what appears in the navigation and on every screen:
 *
 * 1. A control the signed in role cannot use is not rendered. Not disabled, not greyed out,
 *    not hidden behind a tooltip. The acceptance bar is a member of Trevean's marketing team
 *    publishing a blend end to end while we watch and say nothing, and a person who clicks a
 *    button that returns a 403 has already stopped trusting the tool.
 *
 * 2. The role is always on screen. Somebody who cannot find the save button needs to see
 *    why in the same glance.
 */

export interface Flash {
  kind: 'ok' | 'warn' | 'error';
  title: string;
  body?: RawHtml | string;
}

export interface PageOptions {
  title: string;
  principal?: Principal;
  active?: string;
  flash?: Flash[];
  wide?: boolean;
}

interface NavItem {
  href: string;
  label: string;
  key: string;
  /** The contract operation this screen needs. Absent means everyone signed in. */
  operationId?: string;
}

const NAV: NavItem[] = [
  { href: '/', label: 'Blends', key: 'blends', operationId: 'adminListBlends' },
  { href: '/growers', label: 'Growers', key: 'growers' },
  { href: '/media', label: 'Media', key: 'media', operationId: 'adminListMedia' },
  { href: '/analytics', label: 'Analytics', key: 'analytics', operationId: 'adminGetScanTimeSeries' },
  { href: '/nfc', label: 'NFC and tags', key: 'nfc', operationId: 'adminListTagRecords' },
  { href: '/content-readiness', label: 'Content readiness', key: 'readiness' },
  { href: '/users', label: 'Roles', key: 'users' },
  { href: '/audit', label: 'Audit', key: 'audit' },
];

function navFor(principal: Principal | undefined, active: string | undefined): RawHtml {
  if (!principal) return raw('');
  const items = NAV.filter((item) => {
    if (item.key === 'users') return principal.role === 'Admin';
    if (!item.operationId) return true;
    return may(principal, item.operationId);
  });
  return join(
    items.map(
      (item) => html`<a class="${item.key === active ? 'nav-item current' : 'nav-item'}" href="${item.href}">${item.label}</a>`,
    ),
  );
}

export function page(options: PageOptions, body: RawHtml): string {
  const { principal } = options;
  const flashes = join(
    (options.flash ?? []).map(
      (f) => html`<div class="flash flash-${f.kind}"><b>${f.title}</b>${f.body ? html`<div>${f.body}</div>` : ''}</div>`,
    ),
  );

  return `<!doctype html>
${html`<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${options.title} | Trevean Spice admin</title>
    <link rel="stylesheet" href="/static/admin.css" />
  </head>
  <body class="${options.wide ? 'wide' : ''}">
    <header class="top">
      <a class="wordmark" href="/">Trevean Spice <span>admin</span></a>
      <nav class="nav">${navFor(principal, options.active)}</nav>
      <div class="who">
        ${principal
          ? html`<span class="role role-${principal.role}">${principal.role}</span>
              <span class="email">${principal.email}</span>
              <a class="signout" href="/sign-out">Sign out</a>`
          : html`<a class="signout" href="/sign-in">Sign in</a>`}
      </div>
    </header>
${
      /*
       * A developer's banner, shown only to a developer.
       *
       * It was gated on the stage not being production, which meant it appeared on the
       * deployed admin the client signs into. Three things wrong with that: it printed the
       * internal API hostname on every page, it announced the stage to somebody for whom the
       * word means nothing, and it claimed "development identity provider in use, no AWS
       * account required" while the deployed admin authenticates against Cognito, so it was
       * also untrue.
       *
       * Gated on the development identity instead, which is the thing it actually describes.
       */
      config.devIdentity
        ? html`<div class="stagebar">Stage: ${config.stage}. API: ${config.apiBaseUrl}. Development identity provider in use, no AWS account required.</div>`
        : ''
    }
    <main class="page">
      ${flashes}
      ${body}
    </main>
    <footer class="foot">
      <p>Built against the frozen API contract, version 1.0.0. This tool never writes the redirect table.</p>
    </footer>
    <script src="/static/admin.js" defer></script>
  </body>
</html>`.value}`;
}
