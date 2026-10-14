/**
 * Browser wiring. Everything that is not a DOM concern lives in lib/ and is unit tested
 * there; this file resolves a credential, reads the controls, calls the API and puts the
 * rendered string on the page.
 */

import { loadDashboard } from './lib/api.js';
import { csvFilename, geographyToCsv, seriesToCsv } from './lib/csv.js';
import { mergeGeography, summarise } from './lib/derive.js';
import { isoDay, slugToName } from './lib/format.js';
import { renderBlendOptions, renderDashboard, renderError } from './lib/render.js';
import { PRESETS, presetRange, selectionFromQuery, selectionToQuery, validateSelection } from './lib/state.js';

const TOKEN_KEY = 'trevean.dashboard.token';
const main = document.getElementById('main');
const controls = document.getElementById('controls');
const status = document.getElementById('status');

let token = null;
let lastPayload = null;

let selection = selectionFromQuery(window.location.search, {
  ...presetRange(PRESETS[1], isoDay(new Date())),
  blend: null,
});

let blends = [];

function setStatus(text, kind = 'info') {
  status.textContent = text;
  status.dataset.kind = kind;
}

/**
 * Local development has no identity provider, so the local stack mints a Viewer token and
 * serves it on a route that exists only there. Anywhere else the operator pastes a token
 * from the same provider the admin CMS uses. The page never stores a credential anywhere
 * but session storage, and never puts one in the address bar.
 */
async function resolveToken() {
  const stored = window.sessionStorage.getItem(TOKEN_KEY);
  if (stored) return stored;
  try {
    const response = await fetch('/dev/token');
    if (response.ok) {
      const body = await response.json();
      if (body && typeof body.token === 'string') {
        window.sessionStorage.setItem(TOKEN_KEY, body.token);
        return body.token;
      }
    }
  } catch {
    // No local stack. Fall through to the paste field.
  }
  return null;
}

function renderTokenPrompt() {
  main.innerHTML =
    '<section class="panel"><h2 class="panel-title">A Viewer credential is needed</h2>' +
    '<p>This dashboard reads the admin analytics endpoint, which requires the Viewer role. ' +
    'Paste a bearer token to continue. It is kept in session storage for this tab only.</p>' +
    '<form id="token-form" class="token-form"><label for="token-input">Bearer token</label>' +
    '<input id="token-input" name="token" type="password" autocomplete="off" spellcheck="false" required>' +
    '<button type="submit">Use this token</button></form></section>';
  document.getElementById('token-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const value = document.getElementById('token-input').value.trim();
    if (value === '') return;
    window.sessionStorage.setItem(TOKEN_KEY, value);
    token = value;
    refresh();
  });
}

function renderControls() {
  const presetButtons = PRESETS.map(
    (preset) => `<button type="button" class="preset" data-preset="${preset.id}">${preset.label}</button>`,
  ).join('');

  const blendOptions = renderBlendOptions(blends, selection.blend);

  controls.innerHTML =
    '<div class="control-row">' +
    `<label class="control"><span>Blend</span><select id="blend-select">${blendOptions}</select></label>` +
    `<label class="control"><span>From</span><input id="from-input" type="date" value="${selection.from}"></label>` +
    `<label class="control"><span>To</span><input id="to-input" type="date" value="${selection.to}"></label>` +
    '<label class="control"><span>Granularity</span><select id="granularity-select">' +
    `<option value="day"${selection.granularity === 'day' ? ' selected' : ''}>Day</option>` +
    `<option value="hour"${selection.granularity === 'hour' ? ' selected' : ''}>Hour</option>` +
    '</select></label>' +
    `<div class="control presets">${presetButtons}</div>` +
    '<div class="control exports">' +
    '<button type="button" id="export-series">Export series CSV</button>' +
    '<button type="button" id="export-geography">Export places CSV</button>' +
    '</div></div>';

  controls.querySelectorAll('.preset').forEach((button) => {
    button.addEventListener('click', () => {
      const preset = PRESETS.find((item) => item.id === button.dataset.preset);
      if (!preset) return;
      selection = { ...selection, ...presetRange(preset, isoDay(new Date())) };
      refresh();
    });
  });
  document.getElementById('blend-select').addEventListener('change', (event) => {
    selection = { ...selection, blend: event.target.value === '' ? null : event.target.value };
    refresh();
  });
  document.getElementById('from-input').addEventListener('change', (event) => {
    selection = { ...selection, from: event.target.value };
    refresh();
  });
  document.getElementById('to-input').addEventListener('change', (event) => {
    selection = { ...selection, to: event.target.value };
    refresh();
  });
  document.getElementById('granularity-select').addEventListener('change', (event) => {
    selection = { ...selection, granularity: event.target.value };
    refresh();
  });
  document.getElementById('export-series').addEventListener('click', () => {
    if (!lastPayload) return;
    download(csvFilename(selection), seriesToCsv(lastPayload.series));
  });
  document.getElementById('export-geography').addEventListener('click', () => {
    if (!lastPayload) return;
    const geography = mergeGeography(lastPayload.geographySeries);
    download(`places-${csvFilename(selection)}`, geographyToCsv(geography.places, lastPayload.series));
  });
}

function download(filename, text) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

async function refresh() {
  if (!token) {
    renderTokenPrompt();
    return;
  }
  const legal = validateSelection(selection);
  renderControls();
  if (!legal.ok) {
    setStatus(legal.reason, 'warn');
    return;
  }

  const query = selectionToQuery(selection);
  window.history.replaceState(null, '', `?${query}`);
  setStatus('Reading rollups...');

  try {
    const payload = await loadDashboard(selection, { baseUrl: '', token });
    lastPayload = payload;
    if (Array.isArray(payload.blends) && payload.blends.length > 0) blends = payload.blends;
    const summary = summarise(payload.series);
    main.innerHTML = renderDashboard({ ...payload, selection });
    renderControls();
    const failures = payload.geographyFailures ?? [];
    setStatus(
      `${summary.totals.scans.toLocaleString('en-GB')} counted scans in ${summary.bucketCount} buckets` +
        (failures.length > 0 ? `. ${failures.length} geography request(s) failed and those places are missing.` : '.'),
      failures.length > 0 ? 'warn' : 'ok',
    );
    document.title = `${selection.blend ? slugToName(selection.blend) : 'All blends'} scans, Trevean Spice`;
  } catch (error) {
    if (error && error.status === 401) {
      window.sessionStorage.removeItem(TOKEN_KEY);
      token = null;
      setStatus('The credential was rejected.', 'warn');
      renderTokenPrompt();
      return;
    }
    main.innerHTML = renderError(error);
    setStatus('The dashboard could not load.', 'warn');
  }
}

async function start() {
  token = await resolveToken();
  renderControls();
  await refresh();
}

start();
