#!/usr/bin/env node
/**
 * Measure the built page rather than assert things about it.
 *
 * Three passes, because two different questions need two different instruments
 * and conflating them produces a number that is wrong in a way nobody notices.
 *
 *   score       /blend.html on its own, Lighthouse default mobile throttling.
 *               This is the run that gates "Performance score at least 90 on
 *               landing pages" (Acceptance criteria, section 6.2), and it uses
 *               the defaults so the score is comparable with any other
 *               Lighthouse run anywhere.
 *
 *   tap         /t/{code}, so the 307 is inside the measurement, simulated at
 *               the design point from the budget document section 2: 150 ms
 *               round trip, 4 Mbps, 4x CPU. A regression tripwire, NOT evidence
 *               of the contractual 2.0 s, which is measured on real handsets by
 *               the measurement harness at the M2 gate.
 *
 *   tap-wire    /t/{code} again, this time with the throttling applied to the
 *               real network rather than simulated afterwards.
 *
 * The third pass exists for one reason and it is worth reading before quoting
 * any request count. "Before readable" is defined as every network request that
 * finished at or before Largest Contentful Paint. In Lighthouse's simulate
 * mode, LCP is a modelled number on a throttled clock while the per-request end
 * times in the network-requests audit are observed on an unthrottled one. On a
 * localhost origin every request finishes in a few hundred observed
 * milliseconds, which is under a modelled LCP of about 1,700 ms, so everything
 * on the page counts as "before readable" including images the browser
 * deliberately deferred. The two clocks are not the same clock. Applying the
 * throttling to the wire puts both numbers on the same clock and makes the
 * comparison mean what it says.
 *
 * Usage:
 *   node scripts/measure.mjs [--runs 3] [--port 3100] [--viewport 375,428]
 */

import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const lhrRoot = join(root, '.lighthouseci');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const RUNS = Number(arg('runs', '3'));
const PORT = Number(arg('port', '3100'));
const VIEWPORTS = arg('viewport', '375,428')
  .split(',')
  .map((w) => Number(w.trim()));

const HEIGHTS = { 360: 780, 375: 812, 428: 926 };

/* Budget, section 4.1. Restated here only for the printed table. The gate that
   decides pass or fail is the M1 CI package, which reads budget.json, the one
   machine-readable copy of every number. */
const BUDGET = {
  totalBytes: 153600,
  totalRequests: 5,
  documentBytes: 14336,
  scriptBytes: 0,
  imageBytes: 92160,
  fontBytes: 46080,
  stylesheetBytes: 0,
  thirdPartyRequests: 0,
  whole: { totalBytes: 1024000, totalRequests: 35, imageBytes: 614400, scriptBytes: 122880 },
};

const DESIGN_POINT = { rttMs: 150, throughputKbps: 4000, cpuSlowdownMultiplier: 4 };

/* `decides` marks the one phase whose byte and request numbers are allowed to
   set the exit code. Only tap-wire puts Largest Contentful Paint and the
   per-request end times on the same clock, so it is the only phase whose
   "before readable" partition means what it says. The simulate phases are
   printed because their timings are the comparable ones, and their byte tables
   are advisory for the reason set out at the top of this file. Failing the build
   on a number this file already explains is wrong would be a gate nobody trusts,
   which is worse than no gate. */
const PHASES = [
  {
    name: 'score',
    gatePhase: 'direct',
    decides: false,
    paths: ['/blend.html?blend=persian-sunrise&via=nfc', '/blend.html?blend=caribbean-sunset&via=qr'],
    method: 'simulate',
    throttling: null,
    label: 'Lighthouse default mobile throttling. This is the score section 6.2 names.',
  },
  {
    name: 'tap',
    gatePhase: 'tap',
    decides: false,
    paths: ['/t/ps', '/t/cs'],
    method: 'simulate',
    throttling: DESIGN_POINT,
    label: 'design point simulated, 307 inside the measurement. Timings are the tripwire, not the contractual 2.0 s. Byte and request counts here are advisory: they are on two clocks.',
  },
  {
    name: 'tap-wire',
    gatePhase: 'tap',
    decides: true,
    paths: ['/t/ps', '/t/cs'],
    method: 'devtools',
    throttling: DESIGN_POINT,
    label: 'design point applied to the wire, so request end times and LCP share one clock. Quote the byte and request counts from here. This phase sets the exit code.',
  },
];

/* ------------------------------------------------------------------ server -- */

const server = spawn(process.execPath, [join(here, 'serve.mjs'), String(PORT)], {
  stdio: ['ignore', 'pipe', 'inherit'],
});
server.stdout.on('data', (chunk) => {
  const text = String(chunk);
  if (text.includes('beacon ')) process.stdout.write(text);
});

async function waitForServer() {
  for (let i = 0; i < 80; i += 1) {
    try {
      const response = await fetch(`http://localhost:${PORT}/blend.html?blend=persian-sunrise`);
      if (response.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('the edge stand-in did not start');
}

/* -------------------------------------------------------------- lighthouse -- */

/* Lighthouse is a pinned devDependency and is invoked through Node directly,
   not through npx and not through a shell. A shell splits the URL at the
   ampersand in ?blend=...&via=nfc, which is the URL under test. */
const LIGHTHOUSE_CLI = join(root, 'node_modules', 'lighthouse', 'cli', 'index.js');

function runLighthouse({ url, outFile, width, height, method, throttling }) {
  const args = [
    LIGHTHOUSE_CLI,
    url,
    '--quiet',
    '--only-categories=performance',
    '--output=json',
    `--output-path=${outFile}`,
    '--chrome-flags=--headless=new --no-sandbox --disable-gpu --disable-dev-shm-usage',
    '--form-factor=mobile',
    '--screenEmulation.mobile',
    `--screenEmulation.width=${width}`,
    `--screenEmulation.height=${height}`,
    '--screenEmulation.deviceScaleFactor=3',
    '--max-wait-for-load=60000',
    `--throttling-method=${method}`,
  ];
  if (throttling) {
    args.push(
      `--throttling.rttMs=${throttling.rttMs}`,
      `--throttling.throughputKbps=${throttling.throughputKbps}`,
      `--throttling.cpuSlowdownMultiplier=${throttling.cpuSlowdownMultiplier}`,
      `--throttling.requestLatencyMs=${throttling.rttMs}`,
      `--throttling.downloadThroughputKbps=${throttling.throughputKbps}`,
      `--throttling.uploadThroughputKbps=${Math.round(throttling.throughputKbps / 4)}`,
    );
  }
  const result = spawnSync(process.execPath, args, {
    stdio: ['ignore', 'ignore', 'pipe'],
    shell: false,
    cwd: root,
  });
  if (result.status !== 0) {
    throw new Error(`lighthouse failed for ${url}\n${String(result.stderr).slice(-1500)}`);
  }
}

/* ---------------------------------------------------------------- analysis -- */

const endTimeOf = (item) => {
  const v = item.networkEndTime ?? item.endTime ?? item.finished ?? null;
  return typeof v === 'number' ? v : Number.POSITIVE_INFINITY;
};
const isHttp = (url) => typeof url === 'string' && /^https?:/i.test(url);
const hostOf = (url) => {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
};

function analyse(lhr) {
  const lcp = lhr.audits['largest-contentful-paint'].numericValue;
  const items = lhr.audits['network-requests'].details.items.filter(
    (it) => isHttp(it.url) && (it.sessionTargetType === undefined || it.sessionTargetType === 'page'),
  );
  const pre = items.filter((it) => endTimeOf(it) <= lcp);
  const isRedirect = (it) => Number(it.statusCode) >= 300 && Number(it.statusCode) < 400;
  const type = (t) => (it) => it.resourceType === t && !isRedirect(it);
  const sum = (list, pred) =>
    list.filter(pred).reduce((acc, it) => acc + (Number(it.transferSize) || 0), 0);
  const pageHost = hostOf(lhr.finalDisplayedUrl || lhr.finalUrl || lhr.requestedUrl);

  return {
    score: lhr.categories.performance.score,
    lcp,
    fcp: lhr.audits['first-contentful-paint'].numericValue,
    tbt: lhr.audits['total-blocking-time'].numericValue,
    cls: lhr.audits['cumulative-layout-shift'].numericValue,
    si: lhr.audits['speed-index'].numericValue,
    renderBlocking: (lhr.audits['render-blocking-resources']?.details?.items || []).length,
    unsizedImages: (lhr.audits['unsized-images']?.details?.items || []).length,
    lcpLazyLoaded: lhr.audits['lcp-lazy-loaded']?.score,
    redirects: pre.filter(isRedirect).length,
    pre: {
      requests: pre.length,
      totalBytes: sum(pre, () => true),
      documentBytes: sum(pre, type('Document')),
      scriptBytes: sum(pre, type('Script')),
      imageBytes: sum(pre, type('Image')),
      fontBytes: sum(pre, type('Font')),
      stylesheetBytes: sum(pre, type('Stylesheet')),
      thirdParty: pre.filter((it) => hostOf(it.url) !== pageHost).map((it) => it.url),
      urls: pre.map(
        (it) => `${it.statusCode} ${(it.resourceType || 'Redirect').padEnd(10)} ${String(it.transferSize).padStart(6)} B  ${it.url}`,
      ),
    },
    all: {
      requests: items.filter((it) => !isRedirect(it)).length,
      totalBytes: sum(items, () => true),
      imageBytes: sum(items, type('Image')),
      scriptBytes: sum(items, type('Script')),
      stylesheetBytes: sum(items, type('Stylesheet')),
    },
  };
}

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
const median = (list, key) => [...list].sort((a, b) => key(a) - key(b))[Math.floor(list.length / 2)];

/* -------------------------------------------------------------------- run -- */

const summary = { generatedAt: new Date().toISOString(), runs: RUNS, designPoint: DESIGN_POINT, results: [] };
const gateDirs = [];
let breaches = 0;

try {
  await waitForServer();
  rmSync(lhrRoot, { recursive: true, force: true });

  for (const viewport of VIEWPORTS) {
    for (const phase of PHASES) {
      const dir = join(lhrRoot, `${phase.name}-${viewport}`);
      mkdirSync(dir, { recursive: true });
      gateDirs.push({ dir, phase: phase.gatePhase, viewport, name: phase.name });
      let n = 0;
      for (const path of phase.paths) {
        const url = `http://localhost:${PORT}${path}`;
        const analysed = [];
        for (let run = 0; run < RUNS; run += 1) {
          n += 1;
          const outFile = join(dir, `lhr-${String(n).padStart(3, '0')}.json`);
          process.stderr.write(`  ${phase.name} ${viewport}px run ${run + 1}/${RUNS} ${path}\n`);
          runLighthouse({
            url,
            outFile,
            width: viewport,
            height: HEIGHTS[viewport] || 812,
            method: phase.method,
            throttling: phase.throttling,
          });
          analysed.push(analyse(JSON.parse(readFileSync(outFile, 'utf8'))));
        }
        summary.results.push({
          phase: phase.name,
          method: phase.method,
          viewport,
          path,
          ...median(analysed, (a) => a.lcp),
        });
      }
    }
  }
} finally {
  server.kill();
}

/* ----------------------------------------------------------------- report -- */

const line = '='.repeat(100);
console.log('');
for (const phase of PHASES) {
  console.log(line);
  console.log(`PHASE ${phase.name}   ${phase.label}`);
  console.log(line);
  for (const r of summary.results.filter((x) => x.phase === phase.name)) {
    console.log('');
    console.log(`${r.path}   viewport ${r.viewport} px   median of ${RUNS} runs   throttling ${r.method}`);
    console.log(
      `  performance ${Math.round(r.score * 100)}   LCP ${Math.round(r.lcp)} ms   FCP ${Math.round(r.fcp)} ms   ` +
        `TBT ${Math.round(r.tbt)} ms   CLS ${r.cls.toFixed(3)}   SI ${Math.round(r.si)} ms`,
    );
    console.log(
      `  render-blocking ${r.renderBlocking}   unsized images ${r.unsizedImages}   ` +
        `lcp-lazy-loaded audit ${r.lcpLazyLoaded}   redirects before readable ${r.redirects}`,
    );
    console.log('');
    const checks = [
      ['before readable: total transfer', r.pre.totalBytes, BUDGET.totalBytes, kb],
      ['before readable: requests', r.pre.requests, BUDGET.totalRequests, String],
      ['before readable: HTML document', r.pre.documentBytes, BUDGET.documentBytes, kb],
      ['before readable: JavaScript', r.pre.scriptBytes, BUDGET.scriptBytes, kb],
      ['before readable: hero and images', r.pre.imageBytes, BUDGET.imageBytes, kb],
      ['before readable: fonts', r.pre.fontBytes, BUDGET.fontBytes, kb],
      ['before readable: blocking stylesheets', r.pre.stylesheetBytes, BUDGET.stylesheetBytes, kb],
      ['before readable: third-party requests', r.pre.thirdParty.length, BUDGET.thirdPartyRequests, String],
      ['whole page: total transfer', r.all.totalBytes, BUDGET.whole.totalBytes, kb],
      ['whole page: requests', r.all.requests, BUDGET.whole.totalRequests, String],
      ['whole page: images', r.all.imageBytes, BUDGET.whole.imageBytes, kb],
      ['whole page: JavaScript', r.all.scriptBytes, BUDGET.whole.scriptBytes, kb],
    ];
    for (const [label, actual, limit, fmt] of checks) {
      const ok = actual <= limit;
      if (!ok && phase.decides) breaches += 1;
      const pct = limit > 0 ? ` (${Math.round((actual / limit) * 100)}%)` : '';
      const verdict = ok ? 'PASS' : phase.decides ? 'FAIL' : 'over';
      console.log(`    ${verdict.padEnd(4)}  ${label.padEnd(40)} ${fmt(actual).padStart(10)} / ${fmt(limit)}${pct}`);
    }
    console.log('    requests counted before readable:');
    for (const u of r.pre.urls) console.log(`      ${u}`);
  }
  console.log('');
}

writeFileSync(join(root, 'measurement-report.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
console.log(`Wrote measurement-report.json and ${lhrRoot}.`);

/* Hand the same result files to the contractual gate, if it is on this machine.
   Its numbers come from budget.json, which is the only copy of them. */
const gate = resolve(root, '..', '..', 'deliverables', 'm1', '06-performance-budget-ci', 'scripts', 'check-budget.mjs');
if (existsSync(gate)) {
  for (const g of gateDirs) {
    console.log('');
    console.log(`M1 contractual gate, ${g.name} at ${g.viewport} px:`);
    spawnSync(process.execPath, [gate, '--lhr-dir', g.dir, '--phase', g.phase, '--viewport', String(g.viewport)], {
      stdio: 'inherit',
      cwd: root,
    });
  }
} else {
  console.log('');
  console.log('M1 CI package not present on this machine, so only the table above was checked.');
}

process.exit(breaches > 0 ? 1 : 0);
