/*
 * One image element, written by hand rather than through next/image.
 *
 * Fixed by the per-page byte and speed budget, section 4.3: AVIF primary with a
 * WebP fallback through <picture>, srcset at 640 / 900 / 1280, explicit width
 * and height attributes so nothing shifts, fetchpriority high on the hero,
 * decoding async, and never loading lazy on the hero.
 *
 * Everything below the fold is lazy. That is a budget line, not a preference:
 * 0 KB of below-fold imagery before readable.
 *
 * An image with no master renders as a pending slot at the size the real image
 * will occupy, per the placeholder render contract. It never collapses, because
 * a collapsed slot makes the page shorter than the delivered page.
 */

import type { ResponsiveImage } from '@/content/types';

export function Picture({
  image,
  priority = false,
  className,
  pendingLabel,
  pendingStyle,
}: {
  image: ResponsiveImage;
  /** True only for the hero. Exactly one image per page may set it. */
  priority?: boolean;
  className?: string;
  /** What the pending slot says when there is no master. */
  pendingLabel?: string;
  /** Reserves the same box the real image would occupy. */
  pendingStyle?: React.CSSProperties;
}) {
  if (!image.src) {
    return (
      <div className={`placeholder-pending ${className ?? ''}`.trim()} style={pendingStyle}>
        {pendingLabel ?? 'image'}
      </div>
    );
  }

  return (
    <picture className={className}>
      {image.sources.map((source) => (
        <source key={source.type} type={source.type} srcSet={source.srcset} sizes={image.sizes} />
      ))}
      <img
        src={image.src}
        alt={image.alt}
        width={image.width}
        height={image.height}
        sizes={image.sizes}
        decoding="async"
        {...(priority
          ? { fetchPriority: 'high' as const }
          : { loading: 'lazy' as const, fetchPriority: 'low' as const })}
      />
    </picture>
  );
}
