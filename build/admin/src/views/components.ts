import { ApiError, ApiUnreachable, CODE_EXPLANATIONS } from '../api/errors.js';
import type { Finding, PlaceholderReport } from '../content/placeholder.js';
import type { FieldState } from '../content/readiness.js';
import { html, join, raw, type RawHtml } from './html.js';

/** Hidden CSRF field. Every form that writes carries it, and guard.ts refuses without it. */
export function csrf(token: string | undefined): RawHtml {
  return html`<input type="hidden" name="_csrf" value="${token ?? ''}" />`;
}

const STATE_LABEL: Record<FieldState, string> = {
  client_real: 'Supplied by Trevean',
  contractor_real: 'Structural, authored by Serene Labs',
  placeholder_text: 'Placeholder text',
  placeholder_null: 'Not supplied',
  placeholder_media: 'Placeholder image',
  not_applicable: 'Not applicable',
  unverified: 'Unverified',
};

const STATE_HELP: Record<FieldState, string> = {
  client_real: 'Real content, used as given.',
  contractor_real: 'A structural value, not editorial about the supply chain.',
  placeholder_text: 'The value carries the placeholder marker. It is not real content and must not reach a customer.',
  placeholder_null:
    'Deliberately empty. A value invented here would be a claim about a person, a place, a date or a price that nobody at Trevean has made.',
  placeholder_media: 'Points at a generated placeholder image, sized and weighted to the performance budget.',
  not_applicable: 'Does not apply to this record.',
  unverified:
    'The content package could not be read, so nothing on this field can be confirmed as real. Treated as placeholder until it can be.',
};

export function stateChip(state: FieldState, blocking: boolean): RawHtml {
  return html`<span class="chip chip-${state}${blocking ? ' chip-blocking' : ''}" title="${STATE_HELP[state]}">${STATE_LABEL[state]}${blocking ? ' (blocks publish)' : ''}</span>`;
}

export interface FieldOptions {
  name: string;
  label: string;
  value?: string | number | null;
  hint?: string;
  type?: 'text' | 'number' | 'date' | 'textarea' | 'select';
  rows?: number;
  options?: Array<{ value: string; label: string; selected?: boolean }>;
  maxLength?: number;
  readOnly: boolean;
  state?: FieldState;
  blocking?: boolean;
  disabled?: boolean;
}

/**
 * One editable field, with its placeholder state next to it rather than in a separate
 * report. An editor should be able to answer "is what I am looking at real" without
 * leaving the field.
 */
export function field(options: FieldOptions): RawHtml {
  const value = options.value === null || options.value === undefined ? '' : String(options.value);
  const chip = options.state ? stateChip(options.state, options.blocking ?? false) : raw('');

  if (options.readOnly) {
    return html`<div class="field readonly">
      <div class="field-head"><label>${options.label}</label>${chip}</div>
      <div class="value">${value === '' ? html`<span class="empty">not set</span>` : value}</div>
      ${options.hint ? html`<p class="hint">${options.hint}</p>` : ''}
    </div>`;
  }

  let control: RawHtml;
  if (options.type === 'textarea') {
    control = html`<textarea name="${options.name}" rows="${options.rows ?? 4}"${options.maxLength ? raw(` maxlength="${options.maxLength}"`) : raw('')}${options.disabled ? raw(' disabled') : raw('')}>${value}</textarea>`;
  } else if (options.type === 'select') {
    control = html`<select name="${options.name}"${options.disabled ? raw(' disabled') : raw('')}>
      ${join(
        (options.options ?? []).map(
          (o) => html`<option value="${o.value}"${o.selected ? raw(' selected') : raw('')}>${o.label}</option>`,
        ),
      )}
    </select>`;
  } else {
    control = html`<input type="${options.type ?? 'text'}" name="${options.name}" value="${value}"${options.maxLength ? raw(` maxlength="${options.maxLength}"`) : raw('')}${options.disabled ? raw(' disabled') : raw('')} />`;
  }

  return html`<div class="field">
    <div class="field-head"><label for="${options.name}">${options.label}</label>${chip}</div>
    ${control}
    ${options.hint ? html`<p class="hint">${options.hint}</p>` : ''}
  </div>`;
}

/**
 * Failure, shown rather than swallowed.
 *
 * Every API failure reaches the editor with its stable code, its message, its request id and
 * every field level detail. The request id is the value that gets pasted into a support
 * message and matches the structured log line on the API side.
 */
export function apiFailure(err: unknown): RawHtml {
  if (err instanceof ApiUnreachable) {
    return html`<div class="flash flash-error">
      <b>The API did not answer</b>
      <p>${err.message}</p>
      <p class="hint">Nothing was saved. Start the API with <code>npm run local:up</code> in <code>build/api</code> and try again.</p>
    </div>`;
  }
  if (err instanceof ApiError) {
    const explanation = CODE_EXPLANATIONS[err.code];
    return html`<div class="flash flash-error">
      <b>${err.code}</b>
      <p>${explanation ?? err.message}</p>
      ${explanation ? html`<p class="hint">${err.message}</p>` : ''}
      ${err.details.length > 0
        ? html`<ul class="details">
            ${join(err.details.map((d) => html`<li><code>${d.field}</code> ${d.issue.replace(/_/g, ' ')}</li>`))}
          </ul>`
        : ''}
      <p class="hint">HTTP ${err.status} from ${err.operationId}. Request id ${err.requestId || 'not returned'}.</p>
    </div>`;
  }
  return html`<div class="flash flash-error"><b>Unexpected failure</b><p>${(err as Error).message}</p></div>`;
}

export function placeholderBanner(report: PlaceholderReport): RawHtml {
  if (report.safeToPublish) {
    return html`<div class="flash flash-ok"><b>No placeholder content on this blend</b><p>${report.headline}</p></div>`;
  }
  return html`<div class="flash flash-warn">
    <b>Placeholder content on this blend</b>
    <p>${report.headline}</p>
    ${report.readinessAvailable
      ? ''
      : html`<p class="hint">${report.readinessNote}</p>`}
  </div>`;
}

export function findingsTable(findings: Finding[]): RawHtml {
  if (findings.length === 0) return html`<p class="empty">Nothing outstanding.</p>`;
  return html`<table class="grid">
    <thead>
      <tr><th>Record</th><th>Field</th><th>Owner</th><th>State</th><th>Current value</th><th>Detected by</th></tr>
    </thead>
    <tbody>
      ${join(
        findings.map(
          (f) => html`<tr class="${f.blocksPublish ? 'row-blocking' : ''}">
            <td>${f.record}</td>
            <td>${f.label}<br /><code>${f.path}</code></td>
            <td>${f.owner}</td>
            <td>${stateChip(f.state, f.blocksPublish)}</td>
            <td class="val">${f.value}</td>
            <td class="det">${f.detectedBy.map((d) => d.replace(/_/g, ' ')).join(', ') || 'nothing'}</td>
          </tr>`,
        ),
      )}
    </tbody>
  </table>`;
}

export function statusPill(status: string): RawHtml {
  return html`<span class="pill pill-${status}">${status}</span>`;
}

export function crumbs(parts: Array<{ href?: string; label: string }>): RawHtml {
  return html`<nav class="crumbs">
    ${join(
      parts.map((p) => (p.href ? html`<a href="${p.href}">${p.label}</a>` : html`<span>${p.label}</span>`)),
      raw('<span class="sep">/</span>'),
    )}
  </nav>`;
}
