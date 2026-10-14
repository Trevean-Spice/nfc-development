/*
 * Platform-specific instruction copy.
 *
 * Acceptance criteria, section 6.3: on-pack and on-page instruction copy is
 * platform-specific, and copy that describes one platform's behaviour as
 * universal is a defect, not a wording preference.
 *
 * The wording below is the agreed wording from the Hardware and physical layer
 * document, "Customer instruction copy", quoted rather than paraphrased. Two
 * facts it exists to carry:
 *
 *   On iPhone a tap never opens a page directly. iOS raises a banner the user
 *   taps, and no API, setting, entitlement or tag configuration removes it.
 *
 *   Screen off is zero reads on every phone, and Android additionally fails
 *   when locked. That is OS behaviour, which is why the QR code is the sole
 *   recovery route and is not optional.
 *
 * Do not merge these two blocks into one sentence about "your phone".
 */

export function PlatformHelp() {
  return (
    <section id="tap-help" className="wrap">
      <h2>Tapping this jar</h2>
      <div className="plat">
        <div>
          <h3>iPhone</h3>
          <p>
            Wake your phone, hold the top of the phone near the NFC symbol, and tap the
            notification when it appears. iPhone always shows that notification first, so a tap
            never opens a page on its own.
          </p>
        </div>
        <div>
          <h3>Android</h3>
          <p>
            Unlock your phone and hold the NFC antenna area near the NFC symbol. The page should
            open automatically, with no notification to tap.
          </p>
        </div>
        <div>
          <h3>If nothing happens</h3>
          <p>
            Scan the QR code on the pack instead. It opens this same page. A phone with its screen
            off will not read the tag on either platform, and an Android phone also needs to be
            unlocked.
          </p>
        </div>
      </div>
    </section>
  );
}
