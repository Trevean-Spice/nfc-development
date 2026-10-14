import type { BlendItem } from '../repositories/blends.js';
import { getGrower } from '../repositories/growers.js';
import { getMedia } from '../repositories/media.js';
import type { ErrorDetail } from '../http/errors.js';

/**
 * Publish preconditions.
 *
 * The response lists every blocking reason at once rather than one at a time, because an
 * editor fixing five problems in five round trips will stop using the tool.
 *
 * A missing hero image does not block: the seeded blends are published with no hero and
 * that is a deliberate launch state. A hero image that is still processing does block,
 * because publishing it puts a broken image on a page a customer reaches by tapping a jar.
 */
export async function publishBlockers(blend: BlendItem): Promise<ErrorDetail[]> {
  const details: ErrorDetail[] = [];

  if (!blend.name || blend.name.trim() === '') {
    details.push({ field: 'name', issue: 'required_for_publish' });
  }

  if (!blend.growerId) {
    details.push({ field: 'growerId', issue: 'required_for_publish' });
  } else {
    const grower = await getGrower(blend.growerId);
    if (!grower) details.push({ field: 'growerId', issue: 'grower_not_found' });
  }

  if (blend.heroImageId) {
    const media = await getMedia(blend.heroImageId);
    if (!media) {
      details.push({ field: 'heroImageId', issue: 'media_not_found' });
    } else if (media.mediaStatus === 'processing' || media.mediaStatus === 'pending') {
      details.push({ field: 'heroImageId', issue: 'media_still_processing' });
    } else if (media.mediaStatus === 'failed') {
      details.push({ field: 'heroImageId', issue: 'media_failed' });
    } else if (!media.alt) {
      // Alternative text is required before a media item can be used on a published page.
      details.push({ field: 'heroImageId', issue: 'alt_text_required' });
    }
  }

  return details;
}
