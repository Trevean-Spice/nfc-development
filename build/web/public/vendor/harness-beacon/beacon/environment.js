/*
 * Connection, device and platform hints for the field beacon.
 *
 * Two rules hold here and they are not negotiable:
 *
 *   1. This module never touches navigator.geolocation. Geography comes from
 *      CDN viewer headers server side, country, region and city only, with no
 *      IP storage. A location permission prompt two seconds after a customer
 *      touched a jar is hostile, and the privacy posture and the performance
 *      decision point the same way. npm run verify:privacy fails the build if a
 *      geolocation call ever appears in this directory.
 *
 *   2. Nothing here blocks. The high entropy client hints call is asynchronous
 *      and is raced against a short timeout, and this all runs after paint
 *      anyway.
 */
const HIGH_ENTROPY_TIMEOUT_MS = 200;
function connection() {
    const nav = navigator;
    return nav.connection || nav.mozConnection || nav.webkitConnection || null;
}
function withTimeout(promise, ms) {
    return new Promise((resolve) => {
        let settled = false;
        const timer = setTimeout(() => {
            if (!settled) {
                settled = true;
                resolve(null);
            }
        }, ms);
        promise.then((value) => {
            if (!settled) {
                settled = true;
                clearTimeout(timer);
                resolve(value);
            }
        }, () => {
            if (!settled) {
                settled = true;
                clearTimeout(timer);
                resolve(null);
            }
        });
    });
}
/**
 * Device and platform hints. Chromium exposes a model string through client
 * hints, which is how an Android handset is identified. Safari on iOS exposes
 * neither, so an iPhone is classified server side from the user agent string.
 * Classification lives on the server so this module stays small and so the
 * rules can be corrected without redeploying the blend page.
 */
export async function collectEnvironment() {
    const conn = connection();
    const uaData = navigator.userAgentData;
    let model = null;
    let osVersion = null;
    if (uaData && typeof uaData.getHighEntropyValues === 'function') {
        const high = await withTimeout(uaData.getHighEntropyValues(['model', 'platformVersion']), HIGH_ENTROPY_TIMEOUT_MS);
        if (high) {
            model = high.model || null;
            osVersion = high.platformVersion || null;
        }
    }
    return {
        connectionType: conn && conn.type ? conn.type : null,
        effectiveConnectionType: conn && conn.effectiveType ? conn.effectiveType : null,
        downlinkMbps: conn && typeof conn.downlink === 'number' ? conn.downlink : null,
        rttMs: conn && typeof conn.rtt === 'number' ? conn.rtt : null,
        saveData: conn && typeof conn.saveData === 'boolean' ? conn.saveData : null,
        platformHint: uaData && uaData.platform ? uaData.platform : null,
        deviceModelHint: model,
        osVersionHint: osVersion,
        mobileHint: uaData && typeof uaData.mobile === 'boolean' ? uaData.mobile : null,
        userAgent: navigator.userAgent,
        viewportWidth: window.innerWidth || 0,
        viewportHeight: window.innerHeight || 0,
        devicePixelRatio: window.devicePixelRatio || 1,
    };
}
