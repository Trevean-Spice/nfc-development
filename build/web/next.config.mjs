/**
 * Next.js configuration for the Trevean Spice consumer blend pages.
 *
 * Static export, and that is not a preference. Decision D2: every blend page is
 * rendered ahead of time, regenerated on CMS publish, and served from the edge
 * cache. No origin compute and no database read on the tap path. A dynamic
 * setting, an uncached fetch, or a data read in a shared layout silently opts a
 * route out of static generation, which is the stated failure mode in the
 * Architecture document, "Hypotheses to confirm in the audit", item 1.
 *
 * `output: 'export'` makes that failure loud instead of silent: Next refuses to
 * build if any route needs a server.
 */
const config = {
  output: 'export',
  reactStrictMode: true,
  trailingSlash: false,
  productionBrowserSourceMaps: false,
  // next/image is deliberately unused. The hero markup is hand written so the
  // srcset, the explicit width and height, fetchpriority and the AVIF to WebP
  // fallback are exactly what the byte budget specifies, and so no image is
  // ever optimised on the request path.
  images: { unoptimized: true },
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: false },
};

export default config;
