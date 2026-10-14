/**
 * A very small HTML templating helper.
 *
 * Escaping is the default and raw output has to be asked for by name. The admin renders
 * content an editor typed, including content that will later be a story on a consumer page,
 * so an escaping mistake here is a script injection into the tool that publishes the site.
 *
 * There is no template engine dependency for the same reason there is no client framework:
 * every third party library in this application has to be listed and licensed to Trevean
 * indefinitely under the Scope document, "IP and handoff". A tagged template literal and
 * one escape function is not worth a dependency.
 */

export class RawHtml {
  constructor(readonly value: string) {}
}

export function raw(value: string): RawHtml {
  return new RawHtml(value);
}

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ESCAPES[c] as string);
}

function render(value: unknown): string {
  if (value === null || value === undefined || value === false) return '';
  if (value instanceof RawHtml) return value.value;
  if (Array.isArray(value)) return value.map(render).join('');
  return escapeHtml(String(value));
}

export function html(strings: TemplateStringsArray, ...values: unknown[]): RawHtml {
  let out = strings[0] ?? '';
  for (let i = 0; i < values.length; i += 1) {
    out += render(values[i]);
    out += strings[i + 1] ?? '';
  }
  return new RawHtml(out);
}

/** Join a list of fragments with no separator. */
export function join(parts: unknown[], separator: RawHtml | string = ''): RawHtml {
  const sep = separator instanceof RawHtml ? separator.value : escapeHtml(separator);
  return new RawHtml(parts.map(render).join(sep));
}

export function attr(value: string | number | null | undefined): string {
  return value === null || value === undefined ? '' : escapeHtml(String(value));
}
