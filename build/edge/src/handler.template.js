/*
 * Trevean Spice, /t/{code} and /q/{code} edge redirect.
 *
 * CloudFront Function, JavaScript runtime 2.0, viewer request event, attached to
 * the /t/* and /q/* cache behaviours. One thousand encoded tags resolve through
 * this file, and so does every on-pack QR code.
 *
 * TEMPLATE. Do not deploy this file. scripts/build.mjs substitutes the tokens
 * below from redirect-table.json and writes dist/redirect.js, which is the
 * artifact that ships. Editing the mapping here instead of in the table would
 * create a second copy of the load-bearing artifact of the whole design, which
 * is the failure mode the version-controlled table exists to prevent.
 *
 * Runtime constraints this file is written against:
 *   1. 10 KB maximum function size. The build fails above it.
 *   2. No network access and no filesystem. Nothing here may look anything up.
 *   3. Sub millisecond budget. The tap path is two object lookups and a slice.
 *
 * Behaviour, from "M1 Deliverable 3: Redirect-Serving Decision and Apex Domain
 * Routing", section 5:
 *   307 exactly, never 301, 302 or 308. A permanent redirect is cached by
 *   browsers and intermediaries, which would make the destination un-editable on
 *   every device that had ever tapped a jar and destroy the one property the
 *   design is built on: destinations change by editing the table, tags are never
 *   re-encoded.
 *   Location is a relative same-origin path, so the browser keeps the connection
 *   it already has. A cross-origin target costs a second DNS lookup plus a second
 *   TCP and TLS handshake, 450 ms at the design point in "Per-page byte and speed
 *   budget", section 3.
 *   Cache-Control: no-store on the 307. A cached redirect is an uneditable redirect.
 *   An unknown code gets a branded 404, never the home page and never a generic
 *   landing page, because SOW section 6.1 treats a generic landing page as a
 *   failure in the same way a wrong blend is.
 *
 * The query string of the incoming request is never read. That is deliberate and
 * it is asserted by the test suite: attribution parameters must not enter the
 * cache key, per Architecture, "Hypotheses to confirm in the audit", item 3.
 *
 * The two routes, from "M1 Deliverable 14: QR attribution", section 2:
 *   /t/{code}  the tap. The 1,000 shipped tags carry it, unchanged.
 *   /q/{code}  the on-pack QR. Same row, same 307, same destination page, same
 *              cache entry, differing only in the via value the beacon reads
 *              after paint. Carried by the path so the QR needs no query string
 *              and this function still never reads one.
 */

var TARGETS = __TARGETS__;
var QR_TARGETS = __QR_TARGETS__;
var PRELOADS = __PRELOADS__;
var TABLE_ID = __TABLE_ID__;
var NOT_FOUND_BODY = __NOT_FOUND_BODY__;

var HAS = Object.prototype.hasOwnProperty;

function handler(event) {
    var uri = event.request.uri;

    // Shape check before anything else. "/t/x" is the shortest valid request.
    if (uri.length < 4 || uri.charAt(0) !== '/' || uri.charAt(2) !== '/') {
        return notFound(null);
    }

    // The route is one character of the path and nothing else. No parameter, no
    // header, no cookie, so no untrusted input reaches the Location header and
    // no attribution value can enter the cache key.
    var t = uri.charAt(1);
    var map;
    if (t === 't' || t === 'T') {
        map = TARGETS;
    } else if (t === 'q' || t === 'Q') {
        map = QR_TARGETS;
    } else {
        return notFound(null);
    }

    // Normalise: lowercase, then strip any trailing slashes. Tags encode
    // lowercase with no trailing slash, but the QR path and hand typed URLs
    // exist and this is free insurance.
    var code = uri.slice(3).toLowerCase();
    var end = code.length;
    while (end > 0 && code.charCodeAt(end - 1) === 47) {
        end = end - 1;
    }
    if (end !== code.length) {
        code = code.slice(0, end);
    }

    // hasOwnProperty rather than a truthiness test on map[code]. A plain lookup
    // would resolve "constructor", "__proto__" and "toString" off the prototype
    // chain and answer 307 with a garbage Location.
    if (code.length === 0 || !HAS.call(map, code)) {
        return notFound(code);
    }

    var headers = {
        'location': { value: map[code] },
        'cache-control': { value: 'no-store' },
        'x-trevean-table': { value: TABLE_ID }
    };

    // Optional hero preload hint, per "Per-page byte and speed budget",
    // section 3, decision C. Emitted only for codes that carry heroPreloadPath
    // in the table, so turning it on is a table edit and not a code change.
    if (HAS.call(PRELOADS, code)) {
        headers['link'] = { value: PRELOADS[code] };
    }

    return {
        statusCode: 307,
        statusDescription: 'Temporary Redirect',
        headers: headers
    };
}

function notFound(code) {
    // Logged only on the unknown path, never on the tap path. A rising rate of
    // unknown codes means either a mis-encoded batch or a table that lost a row,
    // and both are worth an alarm. Data model, section 7.6.
    if (code) {
        console.log('{"event":"unknown_tag_code","code":"' + safeCode(code) + '"}');
    }
    return {
        statusCode: 404,
        statusDescription: 'Not Found',
        headers: {
            'content-type': { value: 'text/html; charset=utf-8' },
            'cache-control': { value: 'no-store' },
            'x-trevean-table': { value: TABLE_ID }
        },
        body: { encoding: 'text', data: NOT_FOUND_BODY }
    };
}

// Never emit an untrusted path segment into a log line verbatim.
function safeCode(code) {
    if (code.length > 16) {
        return 'oversize';
    }
    for (var i = 0; i < code.length; i = i + 1) {
        var c = code.charCodeAt(i);
        var ok = (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 45;
        if (!ok) {
            return 'invalid';
        }
    }
    return code;
}
