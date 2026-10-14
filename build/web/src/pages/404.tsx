/*
 * The branded not-found page.
 *
 * Reached two ways: an unknown or malformed /t/{code}, which the edge rewrites
 * here with a 404 status rather than sending to the home page ("M1 Deliverable
 * 3: Redirect-Serving Decision and Apex Domain Routing", section 5,
 * "Normalisation and the unknown code"), and any other missing path.
 */

import Head from 'next/head';

export default function NotFound() {
  return (
    <>
      <Head>
        <title data-keep="1">Not found · Trevean Spice</title>
        <meta data-keep="1" name="description" content="That page does not exist." />
      </Head>
      <div className="mid">
        <p className="brand">Trevean Spice</p>
        <h1>That link did not lead anywhere</h1>
        <p>
          The code on this jar is not one we recognise. It may be from a batch that is not live
          yet.
        </p>
        {/* Deliberately does not send the customer to the QR code. The QR on the
            pack carries the same code as the tag, so if the code is the problem
            the QR fails in exactly the same way, and sending someone to a second
            route that cannot work is worse than admitting the first one did not.
            The QR is the recovery route for a sleeping handset, a locked Android
            and a device outside the matrix, which are different failures. */}
        <p>
          The blend name is printed on the label, and every blend has a page on treveanspice.com.
          If you would like the story for this jar, our team can send it to you directly.
        </p>
      </div>
    </>
  );
}
