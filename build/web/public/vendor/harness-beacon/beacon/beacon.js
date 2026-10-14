/*
 * Field beacon: the customer tap half of the measurement harness.
 *
 * Runs on the blend page after paint, reports once, and never blocks anything.
 * Rule 3 of the Architecture document: nothing that measures the tap may delay
 * the tap. Every path in this file is wrapped so that a failure here cannot
 * take the page with it.
 *
 * What it records, and where each field is defined:
 *   navigation start to readable   the interval scored against 2.0 s
 *   connection type                Network Information, where the browser has it
 *   device and platform            client hints, with server side classification
 *   edge cache hit or miss         from a Server-Timing header set at the edge
 *   blend                          per SKU, the finest grain that exists
 *   arrival                        nfc or qr, from the via parameter
 *   dedupe token                   browser side, the same mechanism as QR
 *
 * What it never does: ask for a geolocation permission, set a cookie, load a
 * third party script, or invent a per-tag identifier.
 */
import { BEACON_SCHEMA, HARNESS_VERSION, READABLE_BUDGET_MS, } from '../shared/schema.js';
import { collectTiming, watchLargestContentfulPaint } from './timing.js';
import { collectEnvironment } from './environment.js';
import { resolveDedupe } from './dedupe.js';
import { toScanEventInput } from './scanEvent.js';
import { send } from './transport.js';
const DEFAULT_SETTLE_MS = 1200;
let alreadyReported = false;
function readParam(name) {
    try {
        const params = new URLSearchParams(window.location.search);
        const value = params.get(name);
        if (value === null)
            return null;
        const trimmed = value.trim();
        return trimmed.length > 0 ? trimmed : null;
    }
    catch {
        return null;
    }
}
/**
 * Arrival channel. Strictly nfc or qr from the via parameter, anything else is
 * direct. An allowlist rather than a passthrough, so a crawler cannot write
 * arbitrary text into the analytics.
 */
function readArrival(param) {
    const raw = (readParam(param) || '').toLowerCase();
    if (raw === 'nfc')
        return 'nfc';
    if (raw === 'qr')
        return 'qr';
    return 'direct';
}
/** Blend slug only. Per SKU attribution, and there is no finer grain to have. */
function readBlend(param) {
    const raw = readParam(param);
    if (raw === null)
        return null;
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/i.test(raw))
        return null;
    return raw.toLowerCase();
}
async function buildEvent(config) {
    const blend = readBlend(config.blendParam || 'blend');
    const arrival = readArrival(config.viaParam || 'via');
    const timing = collectTiming();
    const dedupe = resolveDedupe(blend);
    const environment = await collectEnvironment();
    return {
        schema: BEACON_SCHEMA,
        kind: 'field-tap',
        harnessVersion: HARNESS_VERSION,
        clientTime: new Date().toISOString(),
        blend,
        arrival,
        dedupeToken: dedupe.token,
        dedupeTokenIsNew: dedupe.isNew,
        dedupeTokenAgeDays: dedupe.ageDays,
        repeatWithinWindow: dedupe.repeatWithinWindow,
        navigationToReadableMs: timing.navigationToReadableMs,
        readableSource: timing.readableSource,
        withinBudget: timing.navigationToReadableMs === null
            ? null
            : timing.navigationToReadableMs <= READABLE_BUDGET_MS,
        redirectInPath: timing.redirectInPath,
        redirectMs: timing.redirectMs,
        dnsMs: timing.dnsMs,
        tcpMs: timing.tcpMs,
        tlsMs: timing.tlsMs,
        ttfbMs: timing.ttfbMs,
        responseMs: timing.responseMs,
        domContentLoadedMs: timing.domContentLoadedMs,
        firstContentfulPaintMs: timing.firstContentfulPaintMs,
        largestContentfulPaintMs: timing.largestContentfulPaintMs,
        edgeCache: timing.edgeCache,
        browserCacheReuse: timing.browserCacheReuse,
        protocol: timing.protocol,
        connectionType: environment.connectionType,
        effectiveConnectionType: environment.effectiveConnectionType,
        downlinkMbps: environment.downlinkMbps,
        rttMs: environment.rttMs,
        saveData: environment.saveData,
        platformHint: environment.platformHint,
        deviceModelHint: environment.deviceModelHint,
        osVersionHint: environment.osVersionHint,
        mobileHint: environment.mobileHint,
        userAgent: environment.userAgent,
        viewportWidth: environment.viewportWidth,
        viewportHeight: environment.viewportHeight,
        devicePixelRatio: environment.devicePixelRatio,
        geolocationRequested: false,
    };
}
function report(config) {
    if (alreadyReported)
        return;
    alreadyReported = true;
    buildEvent(config).then((event) => {
        // The record is always built in full, whatever goes on the wire. It is
        // the measurement; the request body is a projection of it. See
        // scanEvent.ts.
        const body = config.wireFormat === 'harness-record'
            ? event
            : toScanEventInput(event, { pageVersion: config.pageVersion });
        if (config.debug) {
            // eslint-disable-next-line no-console
            console.info('[trevean field beacon] record', event);
            // eslint-disable-next-line no-console
            console.info('[trevean field beacon] body', body);
            return;
        }
        // No blend is no scan of anything, and blendSlug is required. Sending
        // nothing beats sending a body the API answers 400 to.
        if (body === null)
            return;
        send(config.endpoint, body);
    }, () => undefined);
}
function afterPaint(run) {
    const schedule = () => {
        const idle = window.requestIdleCallback;
        if (typeof idle === 'function') {
            idle(run, { timeout: 3000 });
        }
        else {
            window.setTimeout(run, 0);
        }
    };
    if (document.readyState === 'complete') {
        schedule();
    }
    else {
        window.addEventListener('load', schedule, { once: true });
    }
}
/**
 * Start the beacon. Call it as early as the page can, because the largest
 * contentful paint observer wants to be watching before the paint happens. The
 * reporting itself still waits for paint and idle.
 */
export function initFieldBeacon(config) {
    try {
        if (typeof window === 'undefined' || typeof document === 'undefined')
            return;
        if (!config || typeof config.endpoint !== 'string' || config.endpoint.length === 0)
            return;
        watchLargestContentfulPaint();
        const settleMs = typeof config.settleMs === 'number' ? config.settleMs : DEFAULT_SETTLE_MS;
        afterPaint(() => {
            window.setTimeout(() => report(config), settleMs);
        });
        // If the customer taps straight through to a recipe or closes the jar page,
        // flush what is known rather than losing the tap.
        const flush = () => report(config);
        window.addEventListener('pagehide', flush, { once: true });
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden')
                flush();
        });
    }
    catch {
        /* a broken beacon must never break a blend page */
    }
}
/**
 * Convenience entry for a plain script tag:
 *   <script type="module" src="/harness/beacon/beacon.js"
 *           data-endpoint="/api/scan" defer></script>
 */
function autoInit() {
    try {
        const script = document.currentScript;
        if (!script)
            return;
        const endpoint = script.getAttribute('data-endpoint');
        if (!endpoint)
            return;
        const settle = script.getAttribute('data-settle-ms');
        const wire = script.getAttribute('data-wire-format');
        initFieldBeacon({
            endpoint,
            settleMs: settle ? Number(settle) : undefined,
            wireFormat: wire === 'harness-record' ? 'harness-record' : 'scan-event',
            debug: script.getAttribute('data-debug') === 'true',
        });
    }
    catch {
        /* ignored on purpose */
    }
}
autoInit();
