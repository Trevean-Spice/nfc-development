/**
 * The judgements the live verification makes, separated from the requests it
 * makes them about.
 *
 * These functions are pure so that the thing deciding pass or fail on cutover
 * day is itself tested, rather than being a pile of if statements inside a
 * script that only ever runs against a host nobody can reproduce.
 *
 * Every verdict is one of three, and the distinction matters more here than the
 * usual pass or fail. A NOTE is something Vercel does that CloudFront did not,
 * where the difference is real and worth reading but does not send anybody to
 * the wrong blend. Reporting those as failures would train whoever runs this to
 * ignore the output, and reporting them as passes would hide the honest answer
 * to "is this the same redirect we specified".
 */

export const PASS = 'PASS';
export const NOTE = 'NOTE';
export const FAIL = 'FAIL';

/** The worst of a set of verdicts, since a row is only as good as its weakest check. */
export function worst(verdicts) {
  if (verdicts.includes(FAIL)) return FAIL;
  if (verdicts.includes(NOTE)) return NOTE;
  return PASS;
}

/**
 * The status code, which is the check that a 301 or a 308 can never quietly
 * pass. A permanent redirect is cached by browsers and by intermediaries, and
 * the destination becomes un-editable across every device that ever tapped a
 * jar, with no server side fix.
 */
export function checkStatus(actual, expected = 307) {
  if (actual === expected) return { verdict: PASS, note: null };
  if (actual === 301 || actual === 308) {
    return {
      verdict: FAIL,
      note:
        `status is ${actual}, must be exactly ${expected}. A permanent redirect is cached by browsers and ` +
        'would make the destination un-editable across the installed base, which destroys the one property ' +
        'the design is built on: destinations change by editing the table, tags are never re-encoded.'
    };
  }
  if (actual === 404) {
    return {
      verdict: FAIL,
      note: `status is 404, so this host is not serving the redirect at all. The redirect configuration has not been adopted, or it was adopted and the deployment did not take.`
    };
  }
  return { verdict: FAIL, note: `status is ${actual}, must be exactly ${expected}.` };
}

/**
 * The Location header, byte for byte against the canonical table.
 *
 * Vercel appends the incoming query string to a declarative redirect's
 * destination. The verification requests carry no query string, so an exact
 * comparison is the right one here, and the passthrough is probed separately by
 * checkQueryPassthrough.
 */
export function checkLocation(actual, expected) {
  if (actual === undefined || actual === null) {
    return { verdict: FAIL, note: 'no Location header, so nothing was redirected anywhere.' };
  }
  if (actual !== expected) {
    return {
      verdict: FAIL,
      note:
        `Location is ${JSON.stringify(actual)}, the canonical table says ${JSON.stringify(expected)}. ` +
        'A customer holding this jar would read about another blend. That is a SOW section 6.1 correct ' +
        'destination failure and no speed measurement can see it.'
    };
  }
  if (!actual.startsWith('/') || actual.startsWith('//') || actual.includes('://')) {
    return {
      verdict: FAIL,
      note: 'Location is not a relative same origin path, which costs a second DNS lookup plus a second TCP and TLS handshake.'
    };
  }
  return { verdict: PASS, note: null };
}

/**
 * The cache directive on the redirect.
 *
 * `no-store` is what the specification asks for. Vercel's own default on a
 * declarative redirect is `public, max-age=0, must-revalidate`, which is
 * functionally safe, since the browser has to revalidate before every reuse, but
 * it is not the specified header and whoever reads this output should be told
 * which one arrived rather than have the difference smoothed over.
 */
export function checkCacheControl(value) {
  const header = (value || '').toLowerCase();
  if (header.includes('no-store')) return { verdict: PASS, note: null };
  if (header.includes('must-revalidate') && /(^|[\s,])max-age=0([\s,]|$)/.test(header)) {
    return {
      verdict: NOTE,
      note:
        `Cache-Control is ${JSON.stringify(value)} rather than no-store. This is Vercel's default on a ` +
        'declarative redirect. The redirect still cannot be reused without revalidating, so the destination ' +
        'stays editable, but the header rule in vercel.json did not take effect and that is worth knowing.'
    };
  }
  if (header.length === 0) {
    return { verdict: FAIL, note: 'no Cache-Control on the redirect. A cached redirect is an uneditable redirect.' };
  }
  return {
    verdict: FAIL,
    note: `Cache-Control is ${JSON.stringify(value)}, which permits the redirect to be cached. A cached redirect is an uneditable redirect.`
  };
}

/**
 * What the destination page does with the request, and whether that answer means
 * anything.
 *
 * The trap this exists for was found on 25 August 2026 against the client's live
 * marketing site: `/blend.html` is a single client rendered document whose HTML
 * carries the names of all five blends, and the correct one is chosen in the
 * browser from the `blend` query parameter after the HTML has arrived. So a
 * server side check for "does this page name Persian Sunrise" answers yes for
 * every code, including a transposed one. Reporting that as a pass would be
 * reporting a check that cannot fail.
 */
export function checkDestinationBody(body, blendName, otherBlendNames) {
  const haystack = (body || '').toLowerCase();
  if (!haystack.includes(blendName.toLowerCase())) {
    return {
      verdict: FAIL,
      note: `the destination returned 200 but never names ${JSON.stringify(blendName)}.`
    };
  }
  const alsoNamed = otherBlendNames.filter((name) => haystack.includes(name.toLowerCase()));
  if (alsoNamed.length > 0) {
    return {
      verdict: NOTE,
      note:
        `the destination names ${JSON.stringify(blendName)} and also names ${alsoNamed.join(', ')}, because ` +
        'the page is rendered in the browser from the blend parameter. A server side content check cannot tell ' +
        'a correct destination from a transposed one here. Confirm the blend on a handset, per ' +
        '"M1 Deliverable 4: Tap test protocol".'
    };
  }
  return { verdict: PASS, note: null };
}

/**
 * Whether Vercel appended the incoming query string to the destination.
 *
 * This is the one guarantee from "M1 Deliverable 3", section 5, that does not
 * carry over. The CloudFront Function never read the query string, and a build
 * time check refused to emit a function containing the word. Vercel's routing
 * layer merges the incoming query into the redirect destination and there is no
 * setting that turns it off.
 *
 * It is reported rather than failed because the consequence is bounded: `blend`
 * and `via` are literals in the destination, so the page still opens the right
 * blend with the right attribution, and the extra parameters are read by nothing.
 */
export function checkQueryPassthrough(location, expected, probeKeys) {
  if (location === expected) {
    return { verdict: PASS, note: 'the incoming query string was dropped, exactly as the CloudFront Function dropped it.' };
  }
  const appended = probeKeys.filter((key) => (location || '').includes(`${key}=`));
  if (appended.length > 0) {
    const blendIsRight = (location || '').includes(expected.slice(expected.indexOf('?') + 1).split('&')[0]);
    return {
      verdict: blendIsRight ? NOTE : FAIL,
      note:
        `Location is ${JSON.stringify(location)}. Vercel appended ${appended.join(', ')} from the request. ` +
        'The blend and the via value are literals in the configuration so the destination and the attribution ' +
        'are still correct, but this is a real difference from the CloudFront implementation and it is ' +
        'recorded in the package README.'
    };
  }
  return { verdict: FAIL, note: `Location is ${JSON.stringify(location)}, which is neither the canonical destination nor a recognisable passthrough of it.` };
}

/** An unknown code must land on a branded 404, never a redirect and never the home page. */
export function checkUnknown(status, location, body) {
  const verdicts = [];
  const notes = [];
  if (location) {
    verdicts.push(FAIL);
    notes.push(`an unknown code returned a redirect to ${JSON.stringify(location)}, which it must never do.`);
  }
  if (status !== 404) {
    verdicts.push(FAIL);
    notes.push(
      `status is ${status}, must be 404. Per SOW section 6.1 a generic landing page is a failure in the same ` +
        'way a wrong blend is, and a 200 on an unknown code is a generic landing page with a misleading status.'
    );
  }
  if (!(body || '').includes('Trevean Spice')) {
    verdicts.push(FAIL);
    notes.push(
      'the response body is not the branded not found page. SOW section 6.3 requires a graceful branded ' +
        'response, never a blank screen. Vercel serves "The page could not be found" as plain text until a ' +
        '404 page is added to the project.'
    );
  }
  return { verdict: worst(verdicts.length ? verdicts : [PASS]), notes };
}
