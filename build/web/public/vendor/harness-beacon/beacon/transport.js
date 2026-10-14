/*
 * Delivery for the field beacon.
 *
 * AMENDED 5 September 2026, and this reverses the previous preference for
 * navigator.sendBeacon. Read this before changing it back.
 *
 * The beacon posts to CloudFront, which reaches the API through an origin
 * access control in front of a Lambda function URL. CloudFront signs that
 * origin request with SigV4, and Lambda does not accept unsigned payloads, so
 * any POST carrying a body must arrive at CloudFront with an
 * x-amz-content-sha256 header holding the SHA256 of that body. The caller
 * computes it; CloudFront will not compute it for you.
 *
 * navigator.sendBeacon cannot set headers at all. That is the API, not a gap in
 * this code, and it means sendBeacon can never satisfy the requirement: every
 * beacon it sent was refused with a 403 before any application code ran, and
 * the measurement was lost silently. So the order is inverted here.
 *
 * WHAT WAS GIVEN UP, said plainly. sendBeacon hands the payload to the browser,
 * which owns delivery from that moment and completes it after the page is gone.
 * fetch with keepalive is the standard replacement and is specified to survive
 * the document being unloaded, but it is the browser's fetch rather than the
 * browser's beacon queue, and on older engines the guarantee is weaker. This is
 * a delivery change and not a measurement change: what is measured, how it is
 * projected onto the frozen contract, and the dedupe window are all untouched,
 * so a number measured after this amendment is comparable with one measured
 * before it.
 *
 * WHAT IS STILL TRUE. Nothing here blocks the tap. The hash is computed off the
 * critical path, the fetch is never awaited, and every failure path is silent.
 * A measurement that breaks a page is worse than a measurement that is missing.
 *
 * See "Decision log", D38.
 */
/** Lowercase hex of the SHA256 of the body, which is the form SigV4 wants. */
async function payloadHash(body) {
    const bytes = new TextEncoder().encode(body);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
}
function subtleCryptoAvailable() {
    return (typeof crypto !== 'undefined' &&
        typeof crypto.subtle !== 'undefined' &&
        typeof crypto.subtle.digest === 'function');
}
export function send(endpoint, payload) {
    let body;
    try {
        body = JSON.stringify(payload);
    }
    catch {
        return 'dropped';
    }
    // The signed path, and the only one that reaches an origin access control.
    //
    // The promise is deliberately not awaited and the result deliberately not
    // reported: the caller invokes this from a visibility handler and must not be
    // made to wait on a hash. Returning 'fetch-signed' says the attempt was
    // started, which is the same guarantee the sendBeacon branch ever gave.
    if (typeof fetch === 'function' && subtleCryptoAvailable()) {
        try {
            void payloadHash(body)
                .then((hash) => fetch(endpoint, {
                method: 'POST',
                body,
                keepalive: true,
                credentials: 'omit',
                mode: 'same-origin',
                headers: {
                    'Content-Type': 'application/json',
                    'x-amz-content-sha256': hash,
                },
            }))
                .catch(() => undefined);
            return 'fetch-signed';
        }
        catch {
            /* fall through to the unsigned attempts below */
        }
    }
    // Unsigned fallbacks, kept for two reasons rather than out of caution. Not
    // every deployment of this harness posts through an origin access control:
    // the bench runs and the local recorder post to a plain endpoint, where an
    // unsigned body is accepted and sendBeacon is still the better instrument.
    // And crypto.subtle is absent in an insecure context, where sending something
    // that may be refused beats sending nothing.
    try {
        if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
            const blob = new Blob([body], { type: 'application/json' });
            if (navigator.sendBeacon(endpoint, blob)) {
                return 'sendBeacon';
            }
        }
    }
    catch {
        /* fall through to fetch */
    }
    try {
        if (typeof fetch === 'function') {
            void fetch(endpoint, {
                method: 'POST',
                body,
                keepalive: true,
                credentials: 'omit',
                mode: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
            }).catch(() => undefined);
            return 'fetch-keepalive';
        }
    }
    catch {
        /* nothing left to try */
    }
    return 'dropped';
}
