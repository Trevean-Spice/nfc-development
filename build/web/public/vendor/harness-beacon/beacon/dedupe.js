/*
 * Deduplication for the field beacon.
 *
 * A browser side token, first party, random, carrying no personal data. This is
 * the SAME mechanism the QR path uses, because the 1,000 tags were encoded per
 * SKU and there is no per-tag counter to lean on. Decision D6.
 *
 * It is measurably weaker than a per-tag counter and the dashboard has to say
 * so: NFC and QR counts are labelled as measured by the same method rather than
 * implying an NFC precision that does not exist. Do not add a per-tag
 * identifier here. There is not one, the chip UID is not in the NDEF payload,
 * and it is not available to the page.
 *
 * Enabling Augmented NDEF or TruST25 is a decision made at encoding time, when
 * the next tag order is placed. If that ever happens, this file is where the
 * stronger identifier would land.
 */
const TOKEN_KEY = 'tsp.beacon.token';
const SEEN_KEY = 'tsp.beacon.seen';
/** Two taps of the same blend in the same browser inside this window are one visit. */
export const DEDUPE_WINDOW_MS = 30 * 60 * 1000;
let memoryToken = null;
const memorySeen = {};
function storage() {
    try {
        const probe = '__tsp_probe__';
        window.localStorage.setItem(probe, '1');
        window.localStorage.removeItem(probe);
        return window.localStorage;
    }
    catch {
        /* private mode, disabled storage, or a sandboxed context */
    }
    try {
        const probe = '__tsp_probe__';
        window.sessionStorage.setItem(probe, '1');
        window.sessionStorage.removeItem(probe);
        return window.sessionStorage;
    }
    catch {
        return null;
    }
}
/*
 * 128 random bits as 32 lowercase hex characters, which is the shape the frozen
 * API contract requires of dedupToken and the shape it describes in prose: "a
 * random 128 bit value generated in the browser and kept in localStorage".
 *
 * It used to return a hyphenated UUID from randomUUID, which is the same 128
 * bits in a different notation, and the notation is what the contract pattern
 * rejects. Producing the accepted form here means the record and the request
 * body carry the identical value, so a stored event and a recorded beacon can be
 * talked about as the same visit. The projection in scanEvent.ts still
 * normalises, for tokens already in a browser from an earlier build.
 */
function randomToken() {
    const cryptoApi = window.crypto;
    if (cryptoApi && typeof cryptoApi.getRandomValues === 'function') {
        const bytes = new Uint8Array(16);
        cryptoApi.getRandomValues(bytes);
        let out = '';
        for (let i = 0; i < bytes.length; i += 1) {
            const byte = bytes[i];
            out += byte.toString(16).padStart(2, '0');
        }
        return out;
    }
    if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
        return cryptoApi.randomUUID().replace(/-/g, '').toLowerCase();
    }
    // Last resort, on a browser exposing no crypto object at all. Weaker, and no
    // longer distinguishable by its length, which is the price of every token
    // being the one shape the contract accepts.
    let out = '';
    while (out.length < 32) {
        out += Math.floor(Math.random() * 0x100000000).toString(16).padStart(8, '0');
    }
    return (Date.now().toString(16).slice(-8) + out).slice(0, 32);
}
function readJson(store, key) {
    if (!store)
        return null;
    try {
        const raw = store.getItem(key);
        if (!raw)
            return null;
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
function writeJson(store, key, value) {
    if (!store)
        return false;
    try {
        store.setItem(key, JSON.stringify(value));
        return true;
    }
    catch {
        return false;
    }
}
/**
 * Resolve the dedupe token and decide whether this blend has already been
 * reported by this browser inside the window.
 */
export function resolveDedupe(blend, now = Date.now()) {
    const store = storage();
    let stored = readJson(store, TOKEN_KEY) || memoryToken;
    let isNew = false;
    if (!stored || typeof stored.token !== 'string' || typeof stored.createdAt !== 'number') {
        stored = { token: randomToken(), createdAt: now };
        isNew = true;
    }
    const persisted = writeJson(store, TOKEN_KEY, stored);
    memoryToken = stored;
    const seen = readJson(store, SEEN_KEY) || memorySeen;
    const key = blend || '(unknown)';
    const last = typeof seen[key] === 'number' ? seen[key] : null;
    const repeatWithinWindow = last !== null && now - last < DEDUPE_WINDOW_MS;
    seen[key] = now;
    // Keep the map small. A browser that has seen more than 20 blends is a
    // testing device, not a customer.
    const keys = Object.keys(seen);
    if (keys.length > 20) {
        keys
            .sort((a, b) => seen[a] - seen[b])
            .slice(0, keys.length - 20)
            .forEach((old) => {
            delete seen[old];
        });
    }
    writeJson(store, SEEN_KEY, seen);
    memorySeen[key] = now;
    const ageMs = now - stored.createdAt;
    const ageDays = ageMs >= 0 ? Math.floor(ageMs / 86400000) : null;
    return { token: stored.token, isNew, ageDays, repeatWithinWindow, persisted };
}
