import type { FastifyInstance } from 'fastify';
import { requireOperation } from '../auth/guard.js';
import { ApiError } from '../api/errors.js';
import type { TagRecord, TagRecordList } from '../api/types.js';
import { apiFailure } from '../views/components.js';
import { html, join, type RawHtml } from '../views/html.js';
import { page } from '../views/layout.js';
import { apiFor, sendHtml } from './support.js';

/**
 * The NFC screens, which are part of why this admin is custom rather than a CMS product.
 *
 * No generic content system models a tag batch, an encoding run or a redirect table, and
 * these are the screens the operation actually needs. All three are READ ONLY, and that is
 * not a limitation of this build:
 *
 *   The redirect table is a version controlled artifact deployed with the application. It is
 *   reviewed like code. A thousand encoded and possibly write protected tags resolve through
 *   it, so a change to it is a code review and a deployment, not a form submission. The
 *   frozen contract has no write operation for it at any role, including Admin, and this
 *   screen has no edit control for the same reason. Corrupting this table does not break a
 *   deployment. It strands physical inventory in customers' kitchens, and nobody finds out
 *   from a dashboard.
 *
 * ATTRIBUTION IS PER SKU. There is no per tag identifier and no chip UID available to
 * anything downstream, because the 1,000 tags were encoded per SKU before this engagement
 * began. So there is no screen here that lists individual tags, no serial column, and no
 * per jar anything. The unit is the code, and the count next to it is how many jars carry
 * that code. A screen that implied otherwise would be inviting somebody to ask for a report
 * the hardware cannot produce.
 */

interface Batch {
  supplierOrderRef: string;
  encodedOn: string | null;
  codes: TagRecord[];
  units: number;
  chipPartNumber: string | null;
  writeProtected: boolean | null;
}

export function groupIntoBatches(records: TagRecord[]): Batch[] {
  const byRef = new Map<string, Batch>();
  for (const record of records) {
    if (record.status !== 'encoded' || !record.supplierOrderRef) continue;
    const key = record.supplierOrderRef;
    const existing = byRef.get(key);
    if (existing) {
      existing.codes.push(record);
      existing.units += record.unitsEncoded ?? 0;
      // A batch claims a single write protection state only when every row agrees. Mixed or
      // unknown stays null, because false would be a claim nobody has made.
      if (existing.writeProtected !== record.writeProtected) existing.writeProtected = null;
    } else {
      byRef.set(key, {
        supplierOrderRef: key,
        encodedOn: record.encodedOn ?? null,
        codes: [record],
        units: record.unitsEncoded ?? 0,
        chipPartNumber: record.chipPartNumber ?? null,
        writeProtected: record.writeProtected ?? null,
      });
    }
  }
  return [...byRef.values()].sort((a, b) => a.supplierOrderRef.localeCompare(b.supplierOrderRef));
}

/** An encoding run is one supplier order encoded on one date. */
export function groupIntoRuns(records: TagRecord[]): Array<Batch & { runKey: string }> {
  const byRun = new Map<string, Batch & { runKey: string }>();
  for (const record of records) {
    if (record.status !== 'encoded') continue;
    const runKey = `${record.supplierOrderRef ?? 'unknown order'} on ${record.encodedOn ?? 'unknown date'}`;
    const existing = byRun.get(runKey);
    if (existing) {
      existing.codes.push(record);
      existing.units += record.unitsEncoded ?? 0;
      if (existing.writeProtected !== record.writeProtected) existing.writeProtected = null;
    } else {
      byRun.set(runKey, {
        runKey,
        supplierOrderRef: record.supplierOrderRef ?? 'unknown order',
        encodedOn: record.encodedOn ?? null,
        codes: [record],
        units: record.unitsEncoded ?? 0,
        chipPartNumber: record.chipPartNumber ?? null,
        writeProtected: record.writeProtected ?? null,
      });
    }
  }
  return [...byRun.values()];
}

function protection(value: boolean | null | undefined): RawHtml {
  if (value === true) return html`<span class="chip chip-client_real">Write protected</span>`;
  if (value === false) return html`<span class="chip chip-placeholder_null">Not write protected</span>`;
  return html`<span class="chip chip-unverified" title="Null means unknown. False would be a claim nobody has made.">Unknown</span>`;
}

export async function registerNfcRoutes(app: FastifyInstance): Promise<void> {
  app.get('/nfc', async (request, reply) => {
    const principal = requireOperation(request, 'adminListTagRecords');
    const api = apiFor(request);

    let table: TagRecordList | undefined;
    let failure: RawHtml | undefined;
    try {
      table = await api.tagRecords();
    } catch (err) {
      failure = apiFailure(err);
    }

    const records = table?.data ?? [];
    const batches = groupIntoBatches(records);
    const runs = groupIntoRuns(records);
    const totalEncoded = records.reduce((sum, r) => sum + (r.status === 'encoded' ? r.unitsEncoded ?? 0 : 0), 0);

    const body = html`<section class="card">
      <h1>NFC, tags and the redirect table</h1>
      ${failure ?? ''}
      <div class="flash flash-warn">
        <b>Read only, for every role including Admin</b>
        <p>
          The redirect table is a version controlled artifact deployed with the application and
          reviewed like code. There is no write operation for it anywhere in the API. A change
          here would not break a deployment, it would strand jars that are already in customers'
          kitchens, so a change is a pull request and a deploy.
        </p>
      </div>
      <p class="hint">
        Deployed ${table?.deployedAt ?? 'unknown'} from commit <code>${table?.sourceCommit ?? 'unknown'}</code>.
        ${totalEncoded} tags encoded across ${batches.length} supplier order${batches.length === 1 ? '' : 's'}.
      </p>
    </section>

    <section class="card">
      <h2>Tag batches</h2>
      <p class="hint">One row per supplier order. Chip is the ST25TV02KC, NFC Forum Type 5 and ISO 15693, not NTAG21x and not Type 2: a different air interface, a different memory model, and area based password protection rather than lock bits.</p>
      <table class="grid">
        <thead><tr><th>Supplier order</th><th>Encoded on</th><th>Codes</th><th>Units</th><th>Chip</th><th>Write protection</th></tr></thead>
        <tbody>
          ${join(
            batches.map(
              (b) => html`<tr>
                <td><code>${b.supplierOrderRef}</code></td>
                <td>${b.encodedOn ?? 'unknown'}</td>
                <td>${b.codes.map((c) => c.code).join(', ')}</td>
                <td>${b.units}</td>
                <td><code>${b.chipPartNumber ?? 'unknown'}</code></td>
                <td>${protection(b.writeProtected)}</td>
              </tr>`,
            ),
          )}
        </tbody>
      </table>
      ${batches.length === 0 && !failure ? html`<p class="empty">No encoded batches in the deployed table.</p>` : ''}
    </section>

    <section class="card">
      <h2>Encoding runs</h2>
      <p class="hint">One supplier order encoded on one date. Every run is a set of codes and a count of units, never a list of tags: attribution is per SKU, so there is no per tag identifier and no chip UID to list.</p>
      <table class="grid">
        <thead><tr><th>Run</th><th>Codes</th><th>Units</th><th>Blends</th></tr></thead>
        <tbody>
          ${join(
            runs.map(
              (r) => html`<tr>
                <td>${r.runKey}</td>
                <td>${r.codes.map((c) => c.code).join(', ')}</td>
                <td>${r.units}</td>
                <td>${[...new Set(r.codes.map((c) => c.blendSlug))].join(', ')}</td>
              </tr>`,
            ),
          )}
        </tbody>
      </table>
    </section>

    <section class="card wide">
      <h2>The redirect table as deployed</h2>
      <p class="hint">
        Which code maps to which blend. The 307 is deliberate and is checked in CI: a 301 gets
        cached permanently by browsers and intermediaries, which would destroy the one property
        the whole design rests on, that a destination can change by editing this table without
        re-encoding a single tag.
      </p>
      <table class="grid">
        <thead>
          <tr><th>Code</th><th>Blend</th><th>Request path</th><th>307 target</th><th>Status</th><th>Units</th><th>NDEF URI</th><th>Write protection</th><th>Last verified against a physical tag</th></tr>
        </thead>
        <tbody>
          ${join(
            records.map(
              (r) => html`<tr>
                <td><code>${r.code}</code></td>
                <td>${r.blendSlug}</td>
                <td><code>${r.requestPath}</code></td>
                <td><code>${r.targetPath}</code></td>
                <td><span class="pill pill-${r.status}">${r.status}</span></td>
                <td>${r.unitsEncoded ?? 0}</td>
                <td class="val"><code>${r.ndefUri ?? 'none'}</code></td>
                <td>${protection(r.writeProtected)}</td>
                <td>${r.lastVerifiedAgainstPhysicalTag ?? html`<span class="chip chip-placeholder_null">Never</span>`}</td>
              </tr>`,
            ),
          )}
        </tbody>
      </table>
      <p class="hint">
        Every code is tapped against a real tag and confirmed to open the correct blend page
        before and after any change of production host. That is the only check that closes the
        loop between what is encoded in silicon and what is deployed in a config file.
      </p>
    </section>`;

    return sendHtml(reply, page({ title: 'NFC and tags', principal, active: 'nfc', wide: true }, body));
  });
}
