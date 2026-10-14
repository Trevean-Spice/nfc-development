/**
 * Every word the dashboard says about what its numbers mean, in one file.
 *
 * It is one file on purpose. The measurement labelling is a contractual obligation, not a
 * styling choice: the Architecture document, "Scan tracking", requires the dashboard to
 * label NFC and QR counts as measured by the same method rather than implying an NFC
 * precision the hardware does not provide, and the Acceptance criteria document, section
 * 6.2, "Scan deduplication", says the same thing in the words that get tested at the gate.
 * Copy scattered through view code drifts. Copy in one file gets reviewed.
 *
 * The rule these strings exist to keep: nothing here may imply a per jar or per tag count.
 * There is no per tag identifier and no chip UID available to the page, because the 1,000
 * shipped tags were encoded per SKU before the engagement began, and Augmented NDEF and
 * TruST25 are deliberately dormant on this run. A dashboard that quietly implied it was
 * counting jars would be a defect, not a design choice.
 */

/**
 * The product facing sentence, from the QR attribution deliverable, section 6.
 *
 * This sentence says "per blend". The deliverable originally said "per jar", this package
 * declined to reproduce the error and flagged it, and the deliverable was corrected on
 * Saturday 22 August 2026 to match. The two now agree, and this note is kept so nobody
 * "restores" the older wording from an older copy of the document.
 *
 * Deduplication is keyed on the blend slug and a browser side token, so the count is one
 * per browser per blend per window. A jar is not in the key and cannot be. "Per jar" in a
 * sentence whose whole job is to deny per jar precision is the one place that error would
 * do the most damage.
 */
export const HEADLINE_MEASUREMENT_LINE =
  'Taps (NFC) and scans (QR) are counted the same way: one per browser per blend per 30 ' +
  'minutes. Neither is a count of jars. Shared links and typed URLs are counted separately ' +
  'as direct.';

/** What the counts are, in the order a reader needs them. */
export const MEASUREMENT_POINTS = [
  'Both channels are deduplicated by the same browser side token. Neither channel is more ' +
    'precise than the other, and the ratio between them is the trustworthy number.',
  'A count is deduplicated browser sessions, not jars and not people. One person tapping ' +
    'four times in half an hour counts once. A jar passed round a table of three counts three.',
  'Absolute totals are a floor. A browser that clears storage between visits is counted ' +
    'again, and a scan that never reaches the beacon is never counted at all.',
  'Direct is its own channel and is never folded into NFC. It is someone who reached the ' +
    'page without a tap and without the printed code, by a shared link or a typed address.',
];

/** Why there is no per tag number anywhere on this page. */
export const WHY_NO_PER_TAG =
  'The 1,000 tags in this production run were encoded per SKU, so every jar of a blend ' +
  'carries the same address. There is no per tag identifier and no chip UID available to ' +
  'the page. Per jar attribution is a decision made at encoding time, on a future tag ' +
  'order, and it is not recoverable afterwards.';

/**
 * Shown when the QR channel has no counted scans in the window.
 *
 * The on pack QR codes are printed and point at Squarespace rather than at a route of our
 * own, which is unresolved. Under most resolutions a QR scan arrives on a route that is
 * distinguishable from the tap and the split is exact. Under the resolutions where it does
 * not, the scan arrives without a channel and is counted as direct. That understates QR
 * rather than overstating NFC, which is the right way round, and it is said here rather
 * than absorbed quietly.
 */
export const QR_NOT_DISTINGUISHABLE = {
  title: 'No QR scans counted in this window',
  body:
    'The QR split only works when a scan arrives on a route of its own. The on pack codes ' +
    'are already printed and point at a destination outside our routing, which is not yet ' +
    'resolved. Until it is, a scan that arrives without a channel is counted as direct. ' +
    'That understates QR. It does not inflate NFC.',
  ifTrulyZero:
    'If the printed code is already resolving through our own route, then this window ' +
    'genuinely contains no QR scans and the panel is correct as shown.',
};

/** Shown beside the platform breakdown. */
export const PLATFORM_CAVEAT =
  'Platform family, not handset model. The rollups counters are iOS, Android and other. ' +
  'Handset model is recorded on the raw event and is deliberately not read here, because ' +
  'this page reads pre-aggregated rollups only.';

/** Shown beside the geography panel. */
export const GEOGRAPHY_CAVEAT =
  'Country, region and city, derived server side from CDN viewer headers. No IP address is ' +
  'stored and the browser is never asked for location permission. City is approximate and ' +
  'is missing for some networks, which is shown as unknown rather than dropped.';

/** Shown beside engagement. */
export const ENGAGEMENT_CAVEAT =
  'Recipe opens and reorder clicks are counted against the same deduplicated sessions as ' +
  'the scans above, so the rates share the scan number as their denominator. A reorder ' +
  'click is a click, not an order. Orders are attributed per SKU through Shopify.';

/** Empty and sparse states, worded so that empty never reads as broken. */
export const STATES = {
  emptyTitle: 'No scans recorded in this window',
  emptyBody:
    'This is what an empty window looks like, and before launch it is the expected result ' +
    'rather than a fault. The query ran, the rollups answered, and there were no counted ' +
    'scans between these two dates.',
  emptyChecks: [
    'Widen the date range, or switch to the all blends view.',
    'A blend with no jars in trade has nothing to count. Kyoto Garden carries no tag in ' +
      'this production run at all.',
    'If jars are in trade and this stays empty, the thing to check is the beacon, not this ' +
      'page.',
  ],
  sparseTitle: 'Sparse window',
  sparseBody:
    'There is data here but not much of it. Percentages are shown because hiding them would ' +
    'be its own kind of lie, and they are volatile at this volume: with this many counted ' +
    'scans a single extra scan moves a share by a visible amount.',
  noTimingTitle: 'No timing recorded',
  noTimingBody:
    'Time to readable is measured by the field beacon on the page. No sample landed in this ' +
    'window, so the percentiles are shown as not measured rather than as zero.',
};

/** Rendered whenever the response carries a measurement method we do not recognise. */
export const UNEXPECTED_METHOD = (method) =>
  'This page is written for counts deduplicated by a browser side token. The API reported ' +
  'the measurement method as "' +
  String(method) +
  '", which this page does not know how to label. The numbers are shown unlabelled rather ' +
  'than described wrongly.';

/** Rendered if a response ever arrives with a source other than the rollups. */
export const UNEXPECTED_SOURCE = (source) =>
  'This page reads pre-aggregated rollups only. The API reported the source as "' +
  String(source) +
  '". Nothing below should be trusted until that is explained.';

export const AUDIENCE_NOTE =
  'Built for marketing self serve. Every control on this page is on the page: pick a blend, ' +
  'pick a window, change the granularity, export what you are looking at. The Viewer role ' +
  'is enough to use all of it and no engineer is needed to answer a question about a number.';

/** Titles, so a heading and its export share one string. */
export const PANEL = {
  volume: 'Scan volume over time',
  split: 'NFC and QR split',
  platform: 'Platform breakdown',
  geography: 'Where scans happened',
  engagement: 'Content engagement and reorder clicks',
  timing: 'Time to readable',
};

export const CHANNEL_LABEL = { nfc: 'NFC tap', qr: 'QR scan', direct: 'Direct' };
export const PLATFORM_LABEL = { ios: 'iOS', android: 'Android', other: 'Other' };
