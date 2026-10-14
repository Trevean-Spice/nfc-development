/*
 * Timing derivation for the field beacon, from Navigation Timing and Paint
 * Timing. No third party library, no polling, no measurement of our own that
 * could disagree with the browser's.
 *
 * The clock starts at navigation start, which for this product is the request
 * for /t/{code}, not the request for /blend.html after the 307. Decision D11,
 * adopted into the SOW section 6.2. The redirect hop is inside the budget.
 *
 * That works because /t/{code} and /blend.html are the same origin, so the
 * browser exposes redirect timing and timeOrigin sits at the start of the first
 * request. redirectInPath records whether that held on this particular tap. If
 * it ever goes false in production, the measured number has become flattering:
 * the redirect fell out of the measurement, not out of the customer's day.
 */
let latestLcpMs = null;
let lcpObserver = null;
/**
 * Start watching for the largest contentful paint. Safe to call more than once.
 * Buffered, so it picks up an entry that fired before this ran.
 */
export function watchLargestContentfulPaint() {
    if (lcpObserver !== null)
        return;
    if (typeof PerformanceObserver === 'undefined')
        return;
    try {
        lcpObserver = new PerformanceObserver((list) => {
            const entries = list.getEntries();
            const last = entries[entries.length - 1];
            if (last) {
                latestLcpMs = Math.round(last.startTime);
            }
        });
        lcpObserver.observe({
            type: 'largest-contentful-paint',
            buffered: true,
        });
    }
    catch {
        lcpObserver = null;
    }
}
function navigationEntry() {
    var _a;
    try {
        const entries = performance.getEntriesByType('navigation');
        const first = entries[0];
        return (_a = first) !== null && _a !== void 0 ? _a : null;
    }
    catch {
        return null;
    }
}
function firstContentfulPaint() {
    try {
        const paints = performance.getEntriesByType('paint');
        for (const entry of paints) {
            if (entry.name === 'first-contentful-paint') {
                return Math.round(entry.startTime);
            }
        }
    }
    catch {
        /* no paint timing on this browser */
    }
    return null;
}
function round(value) {
    if (!isFinite(value) || value < 0)
        return null;
    return Math.round(value);
}
/**
 * Read the edge cache result from a Server-Timing header. The edge has to set
 * it, because a cross origin response header is not otherwise visible to the
 * page. See the README, Wiring the beacon into the blend page.
 */
function edgeCacheFrom(nav) {
    if (!nav)
        return 'unknown';
    const timings = nav
        .serverTiming;
    if (!timings || timings.length === 0)
        return 'unknown';
    for (const entry of timings) {
        const name = (entry.name || '').toLowerCase();
        if (name !== 'edge' && name !== 'cdn-cache' && name !== 'cache')
            continue;
        const description = (entry.description || '').toLowerCase();
        if (description.indexOf('hit') !== -1)
            return 'hit';
        if (description.indexOf('miss') !== -1)
            return 'miss';
    }
    return 'unknown';
}
export function collectTiming() {
    const nav = navigationEntry();
    const fcp = firstContentfulPaint();
    const lcp = latestLcpMs;
    let readable = null;
    let readableSource = 'unavailable';
    // Readable, in order of preference. Largest contentful paint is the closest
    // proxy for "the customer can read the blend story", because on this page the
    // largest element is the hero or the origin story block. First contentful
    // paint is the fallback where the browser has no LCP. All three are recorded
    // so the definition can be re-derived later without re-running the gate.
    if (lcp !== null) {
        readable = lcp;
        readableSource = 'largest-contentful-paint';
    }
    else if (fcp !== null) {
        readable = fcp;
        readableSource = 'first-contentful-paint';
    }
    else if (nav && nav.domContentLoadedEventEnd > 0) {
        readable = Math.round(nav.domContentLoadedEventEnd);
        readableSource = 'dom-content-loaded';
    }
    if (!nav) {
        return {
            navigationToReadableMs: readable,
            readableSource,
            redirectInPath: false,
            redirectMs: null,
            dnsMs: null,
            tcpMs: null,
            tlsMs: null,
            ttfbMs: null,
            responseMs: null,
            domContentLoadedMs: null,
            firstContentfulPaintMs: fcp,
            largestContentfulPaintMs: lcp,
            edgeCache: 'unknown',
            browserCacheReuse: null,
            protocol: null,
        };
    }
    const redirectInPath = nav.redirectCount > 0 || nav.redirectEnd > 0;
    const tls = nav.secureConnectionStart > 0 ? round(nav.connectEnd - nav.secureConnectionStart) : null;
    return {
        navigationToReadableMs: readable,
        readableSource,
        redirectInPath,
        redirectMs: redirectInPath ? round(nav.redirectEnd - nav.redirectStart) : 0,
        dnsMs: round(nav.domainLookupEnd - nav.domainLookupStart),
        tcpMs: round(nav.connectEnd - nav.connectStart),
        tlsMs: tls,
        ttfbMs: round(nav.responseStart - nav.requestStart),
        responseMs: round(nav.responseEnd - nav.responseStart),
        domContentLoadedMs: round(nav.domContentLoadedEventEnd),
        firstContentfulPaintMs: fcp,
        largestContentfulPaintMs: lcp,
        edgeCache: edgeCacheFrom(nav),
        browserCacheReuse: typeof nav.transferSize === 'number' && typeof nav.decodedBodySize === 'number'
            ? nav.transferSize === 0 && nav.decodedBodySize > 0
            : null,
        protocol: nav.nextHopProtocol || null,
    };
}
