/*
 * /blend.html with no blend the edge could resolve.
 *
 * This file is what gets served if the edge rewrite from
 * /blend.html?blend={slug} to /blends/{slug}.html did not happen, or happened
 * with a slug that has no page. It is deliberately a branded, honest dead end
 * rather than a redirect to the home page or to a generic landing page:
 *
 *   Acceptance criteria, section 6.1, "Correct destination": a generic landing
 *   page, a 404 or the wrong blend fails regardless of speed.
 *   Acceptance criteria, section 6.3: a graceful branded error, never a blank
 *   screen.
 *
 * It is also the visible symptom of a misconfigured rewrite. If this page ever
 * appears on a real tap, every tap is broken and it will be obvious within
 * seconds, which is better than a fast page showing the wrong blend.
 */

import Head from 'next/head';

export default function UnresolvedBlend() {
  return (
    <>
      <Head>
        <title data-keep="1">Jar not recognised · Trevean Spice</title>
        <meta data-keep="1" name="description" content="We could not tell which blend this is." />
      </Head>
      <div className="mid">
        <p className="brand">Trevean Spice</p>
        <h1>We could not tell which jar this is</h1>
        <p>
          The link opened, but it did not carry a blend we recognise. Nothing is wrong with your
          phone or with the jar.
        </p>
        <p>
          Scan the QR code on the pack, which opens the same page a tap does. If that does not work
          either, the blend name is printed on the label and our team can send you the story
          directly.
        </p>
        <p className="note">
          If you are testing: this page means the edge did not rewrite
          /blend.html?blend=&#123;slug&#125; onto /blends/&#123;slug&#125;.html. See
          out/route-manifest.json.
        </p>
      </div>
    </>
  );
}
