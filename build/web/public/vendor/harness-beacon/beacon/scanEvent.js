/*
 * The field beacon's wire format: the frozen API contract's ScanEventInput.
 *
 * WHY THIS FILE EXISTS, because the next person will otherwise delete it as an
 * unnecessary layer.
 *
 * The beacon measures one thing and that measurement is the BeaconEvent record
 * in ../shared/schema.ts. That record is the instrument: it is what the gate-run
 * analysis reads, what the self test replays, and what carries the fields the
 * acceptance report prints (readableSource, largestContentfulPaintMs,
 * repeatWithinWindow, geolocationRequested). None of those exist in the API
 * contract and none of them should: POST /v1/scan-events is a deliberately
 * narrow, unauthenticated write on the tap path with additionalProperties set to
 * false.
 *
 * So the record and the request body are two different documents describing the
 * same measurement, and this file is the one place the second is derived from
 * the first. Deriving it rather than measuring it twice is what keeps the
 * Architecture document's "Measurement" commitment intact: one instrument
 * records the bench runs, the gate, the September matrix and every customer tap,
 * and the number accepted in August is measured the same way as the number
 * reviewed in December.
 *
 * THIS IS ALSO THE PRIVACY BOUNDARY, not merely a rename.
 *
 * The record carries the full user agent string, because the instrument needs it
 * to classify a handset. The frozen contract, section 8.3, names the user agent
 * among the things the beacon must not send, and permits "coarse device and
 * platform strings" instead. The projection is where the full string is read and
 * dropped. Classifying here rather than server side is not a preference: the
 * contract has no field the string could travel in.
 *
 * WHAT IT MAY NOT BECOME. There is no per-SKU-finer identifier to add. The 1,000
 * shipped tags were encoded per SKU, the chip serial is not in the NDEF payload
 * and is not available to the page, and Augmented NDEF and TruST25 are dormant
 * by decision. Deduplication is a browser-side token, the same mechanism on the
 * NFC and the QR paths, which is why the dashboard can compare the two honestly.
 *
 * The frozen OpenAPI document governs the wire format. Where this file and that
 * document disagree, that document is right and this file is the defect. It is
 * transcribed here rather than imported because the beacon has no dependencies,
 * runs in a browser, and ships to a repository that does not contain the
 * contract.
 */
const CONNECTION_TYPES = ['slow-2g', '2g', '3g', '4g', '5g', 'wifi', 'unknown'];
/** Contract: minimum 0, maximum 120000, integer or null. */
const DURATION_MAX_MS = 120000;
/** Contract: deviceFamily is a coarse family, never a full user agent. */
const DEVICE_FAMILY_MAX = 40;
/** Whole milliseconds inside the documented range, or null. Never a clamp. */
function duration(value) {
    if (typeof value !== 'number' || !isFinite(value))
        return null;
    const rounded = Math.round(value);
    if (rounded < 0 || rounded > DURATION_MAX_MS)
        return null;
    return rounded;
}
/**
 * Contract: dedupToken matches ^[0-9a-f]{32}$, a random 128 bit value from the
 * browser. resolveDedupe now produces exactly that, so the normal path is the
 * identity. The rest of this function is for a token already sitting in a
 * customer's localStorage from an earlier build, which would otherwise be a 400
 * on every tap from that browser for as long as the value survives. The
 * derivation is deterministic, so such a browser keeps one stable token rather
 * than being counted as a new visitor on every tap.
 */
export function toDedupToken(raw) {
    const hex = String(raw || '').toLowerCase().replace(/[^0-9a-f]/g, '');
    if (hex.length >= 32)
        return hex.slice(0, 32);
    // FNV-1a, four times with four offsets. A shape adapter, not a security
    // function: the token is not a secret and carries no personal data.
    const source = String(raw || '') || 'empty';
    let out = '';
    for (let round = 0; round < 4; round += 1) {
        let h = (2166136261 ^ (round * 0x01000193)) >>> 0;
        for (let i = 0; i < source.length; i += 1) {
            h ^= source.charCodeAt(i);
            h = Math.imul(h, 16777619) >>> 0;
        }
        out += h.toString(16).padStart(8, '0');
    }
    return out.slice(0, 32);
}
/**
 * Platform, from client hints where the browser offers them and from the user
 * agent string where it does not. Safari on iOS exposes no userAgentData at all,
 * so without the fallback every iPhone would report "other" and the dashboard
 * would lose the split the whole acceptance matrix is organised around.
 *
 * The string is read here and goes no further. See the file header.
 */
export function toPlatform(event) {
    const hint = String(event.platformHint || '').toLowerCase();
    if (hint === 'android')
        return 'android';
    if (hint === 'ios' || hint === 'iphone' || hint === 'ipados')
        return 'ios';
    const ua = String(event.userAgent || '');
    if (/android/i.test(ua))
        return 'android';
    if (/iphone|ipad|ipod/i.test(ua))
        return 'ios';
    return 'other';
}
/**
 * Coarse family only. Bounded to the characters and the length the API accepts,
 * because a value outside them is dropped server side and the field is then
 * silently empty rather than obviously wrong.
 */
export function toDeviceFamily(event) {
    let raw = event.deviceModelHint ? String(event.deviceModelHint) : '';
    if (!raw) {
        const ua = String(event.userAgent || '');
        const match = /(iPhone|iPad|iPod)/i.exec(ua);
        if (match)
            raw = match[1];
    }
    const cleaned = raw.replace(/[^A-Za-z0-9 ._-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, DEVICE_FAMILY_MAX);
    return cleaned.length > 0 ? cleaned : null;
}
/**
 * The contract's connectionType conflates the transport with the effective
 * speed, so wifi wins when the browser reports it and the effective type is used
 * otherwise. Anything the contract does not enumerate, ethernet included,
 * becomes unknown rather than a value the API would reject.
 */
export function toConnectionType(event) {
    const type = String(event.connectionType || '').toLowerCase();
    if (type === 'wifi')
        return 'wifi';
    const effective = String(event.effectiveConnectionType || '').toLowerCase();
    for (const allowed of CONNECTION_TYPES) {
        if (effective === allowed)
            return allowed;
    }
    return 'unknown';
}
/**
 * Project one measurement onto the frozen request body.
 *
 * Returns null when there is no blend, which is the only case the API could not
 * accept: blendSlug is required and attribution is per SKU, so an event with no
 * blend is not a scan of anything. The beacon sends nothing rather than sending
 * a 400. That case is reachable only on /blend.html with no slug the edge could
 * resolve, and that page carries no scan endpoint, so in practice it does not
 * arise at all.
 */
export function toScanEventInput(event, options = {}) {
    if (!event.blend)
        return null;
    const occurredAt = typeof event.clientTime === 'string' && /Z$/.test(event.clientTime)
        ? event.clientTime
        : new Date().toISOString();
    return {
        blendSlug: event.blend,
        tagCode: options.tagCode === undefined ? null : options.tagCode,
        channel: event.arrival,
        dedupToken: toDedupToken(event.dedupeToken),
        occurredAt,
        platform: toPlatform(event),
        deviceFamily: toDeviceFamily(event),
        connectionType: toConnectionType(event),
        cacheStatus: event.edgeCache,
        ttfbMs: duration(event.ttfbMs),
        // The interval the 2.0 second acceptance number is measured against, and the
        // reason the same instrument has to be on the page in production: the number
        // reviewed in December is produced by the code that produced the August one.
        timeToReadableMs: duration(event.navigationToReadableMs),
        pageVersion: options.pageVersion === undefined ? null : options.pageVersion,
        // The 307 from /t/{code} is inside the measured interval, because the 2.0
        // second clock starts at the request for /t/{code}. Its cost has to stay
        // visible.
        redirected: event.redirectInPath,
    };
}
