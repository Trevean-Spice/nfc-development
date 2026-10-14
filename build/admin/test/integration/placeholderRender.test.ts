import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { renderPreview } from '../../src/preview/render.js';
import { reportForBlend } from '../../src/content/placeholder.js';
import { loadReadiness } from '../../src/content/readiness.js';
import { setup, type Harness } from '../helpers/harness.js';
import type { Blend, Grower } from '../../src/api/types.js';
import { CONTENT_DIR } from '../helpers/harness.js';

/**
 * The values on this page that are claims rather than copy.
 *
 * A date, a coordinate and a lot label are the placeholders that do the most damage, because
 * they read as facts and carry no marker of their own. A best before date is the one value on
 * this page a customer might act on. These assertions exist because a preview that outlines
 * the prose and leaves the numbers looking finished is a preview that gives false comfort.
 */

let h: Harness;
const source = loadReadiness(CONTENT_DIR);

beforeAll(async () => {
  h = await setup();
});

afterAll(async () => {
  await h.close();
});

function blendWithInventedFacts(): Blend {
  return {
    slug: 'persian-sunrise',
    name: 'Persian Sunrise',
    status: 'published',
    launchTier: 'real',
    tagCode: 'ps',
    version: 1,
    updatedAt: '2026-08-22T12:00:00Z',
    tagline: 'Saffron, cardamom, rose petals and lime from Isfahan',
    originCountry: 'IR',
    originRegion: 'Isfahan',
    farm: { latitude: 32.6539, longitude: 51.666, label: 'Smallholding outside Isfahan' },
    storyBlocks: [{ type: 'paragraph', text: 'Saffron is harvested in the cool hours after dawn.' }],
    freshness: {
      harvestedOn: '2026-05-12',
      blendedOn: '2026-06-30',
      bestBefore: '2027-06-30',
      lotLabel: 'PS-2606',
      note: null,
    },
    growerId: 'grw_01J9Z900A1B2C3D4E5F6G7H8J9',
    shopify: {},
    heroImage: null,
  };
}

const grower: Grower = {
  growerId: 'grw_01J9Z900A1B2C3D4E5F6G7H8J9',
  name: 'A plausible name',
  bio: 'A plausible profile.',
  farm: { latitude: 32.6539, longitude: 51.666 },
  blendSlugs: ['persian-sunrise'],
  version: 1,
  updatedAt: '2026-08-22T12:00:00Z',
};

describe('values that read as facts', () => {
  const blend = blendWithInventedFacts();
  const report = reportForBlend(blend, grower, [], source);
  const html = renderPreview({ blend, grower, recipes: [], report, sourceLabel: 'draft' });

  it('outlines a harvest date the content package has not confirmed', () => {
    expect(html).toContain('<p class="when is-placeholder">2026-05-12</p>');
  });

  it('outlines a best before date, which is the one value a customer might act on', () => {
    expect(html).toContain('<p class="when is-placeholder">2027-06-30</p>');
  });

  it('outlines a lot label', () => {
    expect(html).toContain('<span class="is-placeholder">PS-2606</span>');
  });

  it('outlines a coordinate, because a pin on a map reads as a fact', () => {
    expect(html).toMatch(/class="is-placeholder"[\s\S]{0,60}32\.654, 51\.666/);
  });

  it('outlines a tagline and a story that read as finished copy and carry no marker', () => {
    expect(html).toContain('<p class="is-placeholder">Saffron, cardamom, rose petals and lime from Isfahan</p>');
    expect(html).toContain('<p class="is-placeholder">Saffron is harvested in the cool hours after dawn.</p>');
  });

  it('shows the banner, because none of this is real', () => {
    expect(report.safeToPublish).toBe(false);
    expect(html).toContain('placeholder-banner');
  });
});
