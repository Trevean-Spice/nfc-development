/*
 * The branded offline page.
 *
 * Acceptance criteria, section 6.3: a graceful branded error if the network is
 * unavailable, never a blank screen. The browser's own network error page is a
 * blank screen with a dinosaur on it, so this is precached by the service
 * worker at install and served for any navigation the network cannot answer.
 *
 * The service worker registers after the load event, so none of this is on the
 * tap path. public/sw.js.
 */

import Head from 'next/head';

export default function Offline() {
  return (
    <>
      <Head>
        <title data-keep="1">No connection · Trevean Spice</title>
        <meta data-keep="1" name="description" content="This page needs a connection." />
      </Head>
      <div className="mid">
        <p className="brand">Trevean Spice</p>
        <h1>Your phone is offline</h1>
        <p>
          The jar is fine and the tag is fine. Your phone could not reach us, which happens in
          kitchens with thick walls and in shops with no signal.
        </p>
        {/* Deliberately does not send the customer to the QR code. The QR opens
            the same page over the same network, so with no signal it fails in
            exactly the same way. */}
        <p>
          Move somewhere with a bar or two and tap the jar again. The QR code on the pack needs a
          connection as well, so it will not help until then.
        </p>
      </div>
    </>
  );
}
