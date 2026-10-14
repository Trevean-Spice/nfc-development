/*
 * Everything that runs after the page is readable, and nothing that runs before.
 *
 * This module is fetched only after the window load event, by a 140 byte inline
 * loader at the end of the document. That is deliberate and it is the reason
 * the pre-readable script budget is zero rather than nearly zero: a deferred
 * <script src> in the head is still a network request that usually completes
 * before Largest Contentful Paint, and the CI gate counts every request that
 * finished at or before LCP.
 *
 * Three jobs, in the order they matter:
 *
 *   1. The field beacon, imported verbatim from the M1 measurement harness.
 *      Not reimplemented. Fires after paint, hands one JSON document to
 *      navigator.sendBeacon, dedupes with a browser-side token, and never asks
 *      for a geolocation permission. Geography comes from CDN viewer headers,
 *      server side.
 *   2. The service worker, which is what makes the offline case a branded page
 *      rather than the browser's error screen.
 *   3. The optional catalog refresh, which overwrites the baked price only if
 *      it returns. If it is slow, blocked, or the customer is offline, the page
 *      keeps the price it was built with and the reorder button still works,
 *      because a Shopify cart permalink is a static URL needing no API call.
 *
 * Every one of the three is wrapped. A failure in any of them leaves a good
 * page on screen. Nothing that measures the tap may delay the tap.
 */

const root = document.documentElement;
const config = {
  blend: root.getAttribute('data-blend'),
  scanEndpoint: root.getAttribute('data-scan-endpoint'),
  catalogEndpoint: root.getAttribute('data-catalog-endpoint'),
  serviceWorker: root.getAttribute('data-sw'),
};

/* ------------------------------------------------------------------ beacon -- */

async function startBeacon() {
  if (!config.scanEndpoint) return;
  const module = await import('/vendor/harness-beacon/beacon/beacon.js');
  // settleMs is left at the harness default. The blend param and the via param
  // are read by the beacon itself from window.location, which is why via can be
  // excluded from the CDN cache key without losing the nfc and qr split.
  //
  // Nothing is translated here on purpose. The beacon posts the frozen
  // contract's ScanEventInput itself, from its own projection of its own
  // measurement, so there is exactly one place where the wire format is
  // defined and it travels with the instrument into any repository the beacon
  // is copied into. A mapping written on this page instead would be a second
  // definition of the measurement, outside the harness self test, and getting
  // it wrong is a 400 on every customer tap and a scan count of zero.
  module.initFieldBeacon({ endpoint: config.scanEndpoint });
}

/* ---------------------------------------------------------- service worker -- */

function startServiceWorker() {
  if (config.serviceWorker !== '1') return;
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => undefined);
}

/* --------------------------------------------------------- catalog refresh -- */

function formatMoney(price) {
  if (!price || typeof price.amount !== 'number') return null;
  const major = (price.amount / 100).toFixed(2);
  return price.currency === 'USD' ? '$' + major : major + ' ' + price.currency;
}

async function refreshCatalog() {
  if (!config.catalogEndpoint || !config.blend) return;
  const target = document.querySelector('[data-catalog="price"]');
  if (!target) return;

  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), 4000) : null;
  try {
    const response = await fetch(config.catalogEndpoint + encodeURIComponent(config.blend), {
      credentials: 'omit',
      signal: controller ? controller.signal : undefined,
    });
    if (timer) clearTimeout(timer);
    if (!response.ok) return;
    const body = await response.json();
    const text = formatMoney(body && body.price);
    if (text) target.textContent = text;
    const availability = document.querySelector('[data-catalog="availability"]');
    if (availability && body && body.available === false) {
      availability.textContent = availability.textContent.replace(/ · out of stock$/, '') + ' · out of stock';
    }
  } catch {
    /* The page keeps the price it was built with. That is the design. */
    if (timer) clearTimeout(timer);
  }
}

/* -------------------------------------------------------------------- run -- */

for (const job of [startBeacon, startServiceWorker, refreshCatalog]) {
  try {
    const result = job();
    if (result && typeof result.catch === 'function') result.catch(() => undefined);
  } catch {
    /* one broken enhancement must never take the blend page with it */
  }
}
