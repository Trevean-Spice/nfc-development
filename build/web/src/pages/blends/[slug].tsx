/*
 * The pre-rendered blend page, one static file per blend.
 *
 * Route shape and why it looks like this:
 *
 *   The customer never sees this path. The 1,000 encoded tags carry
 *   treveanspice.com/t/{code}, which the edge answers with a 307 to
 *   /blend.html?blend={slug}&via=nfc. That destination is a fact, not a design
 *   choice ("M1 Deliverable 3: Redirect-Serving Decision and Apex Domain
 *   Routing", section 5).
 *
 *   A query parameter cannot select a static file on its own, so the edge maps
 *   /blend.html?blend={slug} onto this file, /blends/{slug}.html, with a URI
 *   rewrite in the same viewer-request function that already serves the 307.
 *   The customer's address bar still reads /blend.html?blend={slug}&via=nfc.
 *   The mapping is emitted as out/route-manifest.json so the edge configuration
 *   is generated from the build rather than typed twice.
 *
 * getStaticProps only. No getServerSideProps, no revalidate-on-request, no
 * fetch in a shared layout: any of those silently opts the route out of static
 * generation, which is the failure mode named in the Architecture document,
 * "Hypotheses to confirm in the audit", item 1. output: 'export' turns that
 * silent failure into a build error.
 */

import Head from 'next/head';
import type { GetStaticPaths, GetStaticProps } from 'next';
import { BlendPage } from '@/components/BlendPage';
import { getBlend, listPublishedBlends } from '@/content/load';
import type { Blend } from '@/content/types';

export default function BlendRoute({ blend }: { blend: Blend }) {
  const description = blend.placeholder
    ? `Placeholder page for ${blend.name}. Content not supplied.`
    : `${blend.name}, ${blend.originRegion}. ${blend.tagline}`;

  return (
    <>
      <Head>
        <title data-keep="1">{`${blend.name} · Trevean Spice`}</title>
        <meta data-keep="1" name="description" content={description} />
        <link data-keep="1" rel="canonical" href={`/blend.html?blend=${blend.slug}`} />
        <meta data-keep="1" property="og:title" content={`${blend.name} · Trevean Spice`} />
        <meta data-keep="1" property="og:image" content={blend.hero.src} />
      </Head>
      <BlendPage blend={blend} />
    </>
  );
}

export const getStaticPaths: GetStaticPaths = async () => ({
  paths: listPublishedBlends().map((blend) => ({ params: { slug: blend.slug } })),
  // Every blend that exists is rendered. There is no on-demand fallback,
  // because on-demand rendering is what decision D2 removed from the tap path.
  fallback: false,
});

export const getStaticProps: GetStaticProps = async (context) => {
  const slug = String(context.params?.slug ?? '');
  const blend = getBlend(slug);
  if (!blend) return { notFound: true };
  return { props: { blend } };
};
