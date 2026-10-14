import type { FastifyInstance } from 'fastify';
import { config } from '../config/env.js';
import { CACHE_NO_STORE } from '../http/cache.js';
import { validateBody } from '../http/validation.js';
import { logger } from '../observability/logger.js';
import { putScanEvent, ttlFor } from '../repositories/scanEvents.js';
import { geoFromHeaders } from '../services/geo.js';
import { now } from '../util/clock.js';
import { newScanEventId } from '../util/ids.js';
import { deriveScanBuckets, nowIso } from '../util/time.js';

/**
 * POST /v1/scan-events. THE ONLY OPERATION ON THE TAP CRITICAL PATH.
 *
 * It fires after the page is readable, as a browser beacon, and it is one conditional
 * write with nothing in front of it.
 *
 * Rules this handler is built to keep, all of them from the API contract and the Data
 * model document:
 *
 *   1. NO READ BEFORE THE WRITE. Not to check for a duplicate, not to look up the blend,
 *      not to resolve geography. Deduplication is the condition on the write itself, and
 *      geography is already on the request as CDN viewer headers.
 *   2. A duplicate returns 202, exactly like a new event. The client cannot tell the
 *      difference and must not try. A beacon that inspects a response and retries is a
 *      beacon that can interfere with navigation.
 *   3. It must be callable by navigator.sendBeacon, which cannot set arbitrary headers.
 *      So: no Authorization header, no custom header, no preflight requirement, and any
 *      content type the browser chooses to send.
 *   4. No IP address is read or stored. No precise location. No customer identifier. The
 *      request schema sets additionalProperties false, so a field that should not be here
 *      is a 400 rather than a silently stored value.
 */

interface ScanEventInput {
  blendSlug: string;
  tagCode?: string | null;
  channel: 'nfc' | 'qr' | 'direct';
  dedupToken: string;
  occurredAt: string;
  platform?: 'ios' | 'android' | 'other';
  deviceFamily?: string | null;
  connectionType?: string;
  cacheStatus?: string;
  ttfbMs?: number | null;
  timeToReadableMs?: number | null;
  pageVersion?: number | null;
  redirected?: boolean | null;
}

/**
 * Contract section 5.2: the beacon "accepts no free text and no identifiers of value. Every
 * field is an enum, a bounded string matching a documented pattern, or a number in a
 * documented range." Every field satisfies that in the frozen schema except this one:
 * deviceFamily is maxLength 40 with no pattern, so 40 arbitrary characters were accepted
 * and stored verbatim from an unauthenticated caller. Observed stored values included a
 * newline, a DynamoDB expression fragment and an emoji.
 *
 * No injection resulted from any of them. The value is a parameterised attribute, it is not
 * part of any key, and aggregate() does not read it. What it was, was an attacker controlled
 * string in a table on the one endpoint where "no free text" is the entire security
 * argument.
 *
 * The frozen contract is not edited here. Section 8.3 already names the remedy: a free text
 * field is "rejected or dropped server side if sent". So a value outside the documented
 * pattern is DROPPED, not rejected, and the beacon still answers 202. Rejecting would be a
 * wire change to a frozen document, and a 400 on the tap path for a field nobody reads
 * would be the wrong trade even if it were free.
 *
 * The pattern belongs in the schema as well, under section 11 change control, alongside the
 * pageVersion bound. That is a contract change and is reported rather than taken.
 */
export const DEVICE_FAMILY_PATTERN = /^[A-Za-z0-9 ._-]{1,40}$/;

export function boundedDeviceFamily(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  return DEVICE_FAMILY_PATTERN.test(value) ? value : null;
}

export async function registerScanRoutes(app: FastifyInstance): Promise<void> {
  app.post('/v1/scan-events', async (request, reply) => {
    reply.header('cache-control', CACHE_NO_STORE);

    const body = validateBody<ScanEventInput>('#/components/schemas/ScanEventInput', request.body);

    const receivedAtMs = now();
    const buckets = deriveScanBuckets(body.occurredAt, body.dedupToken, receivedAtMs);
    const geo = geoFromHeaders(request.headers as Record<string, string | string[] | undefined>);

    // Origin is checked against the allowed hosts and a mismatch is RECORDED rather than
    // trusted. A browser beacon cannot hold a secret, so this is a signal on the row, not
    // a gate on the request. Rejecting on Origin would also throw away every legitimate
    // scan from a browser that does not send one.
    const origin = request.headers.origin;
    const originAllowed = typeof origin === 'string' ? config.scan.allowedOrigins.includes(origin) : true;

    const result = await putScanEvent(
      {
        eventId: newScanEventId(),
        blendSlug: body.blendSlug,
        tagCode: body.tagCode ?? null,
        channel: body.channel,
        dedupToken: body.dedupToken,
        occurredAt: body.occurredAt,
        receivedAt: nowIso(receivedAtMs),
        effectiveAt: buckets.effectiveAt,
        windowId: buckets.windowId,
        platform: body.platform ?? 'other',
        deviceFamily: boundedDeviceFamily(body.deviceFamily),
        connectionType: body.connectionType ?? 'unknown',
        cacheStatus: body.cacheStatus ?? 'unknown',
        ttfbMs: body.ttfbMs ?? null,
        timeToReadableMs: body.timeToReadableMs ?? null,
        pageVersion: body.pageVersion ?? null,
        redirected: body.redirected ?? null,
        geoCountry: geo.country,
        geoRegion: geo.region,
        geoCity: geo.city,
        originAllowed,
        expiresAt: ttlFor(buckets.effectiveAt),
      },
      buckets,
    );

    // Deliberately terse, and deliberately carrying no identifier of value. There is no
    // per-tag identifier and no chip UID to log even if we wanted one: the 1,000 shipped
    // tags are encoded per SKU.
    logger.debug('scan event', {
      requestId: request.requestId,
      blendSlug: body.blendSlug,
      channel: body.channel,
      stored: result.stored,
      originAllowed,
      clientClockTrusted: buckets.clientClockTrusted,
    });

    // 202 for a new event and for a duplicate alike, with an EMPTY body. Not null, not a
    // JSON document: there is nothing for the client to read and nothing for it to branch
    // on, which is the property that stops a beacon growing a retry.
    return reply.status(202).send();
  });
}
