/*
 * Which side of the seam this process is on. One decision, in one place, made from
 * configuration rather than from whether an SDK happens to be importable.
 *
 * A fallback that quietly used the stand in when AWS was unreachable would be the worst
 * possible behaviour here: it would report a successful publish to an editor while writing
 * to a directory nobody serves. PUBLISH_TARGET says which one, and getting it wrong is a
 * startup failure.
 */

import { CloudFrontCdn, S3ObjectStore } from './store/aws.mjs';
import { LocalCdn, LocalObjectStore } from './store/local.mjs';

export function createStores(config, { credential = 'local-development', edge, invalidateUrl } = {}) {
  if (config.target === 'local') {
    return {
      store: new LocalObjectStore({ root: config.site.localDir, credential }),
      cdn: new LocalCdn({
        credential,
        edge,
        invalidateUrl: invalidateUrl ?? (config.cdn.publicBaseUrl ? `${config.cdn.publicBaseUrl.replace(/\/$/, '')}/_stand-in/invalidate` : null),
      }),
    };
  }
  return {
    store: new S3ObjectStore({ bucket: config.site.bucket, region: config.site.region }),
    cdn: new CloudFrontCdn({ distributionId: config.cdn.distributionId, region: config.site.region }),
  };
}
