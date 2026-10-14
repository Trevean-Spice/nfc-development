/*
 * The consumer blend page.
 *
 * Rendered once, at build and revalidate time, from content the build process
 * fetched. Nothing in this tree runs on the request path and nothing in it
 * fetches anything. Decision D2, and the frozen API contract, section 2.
 *
 * Three constraints are load bearing and are not free to move:
 *
 *   Acceptance criteria, section 6.3: the origin story is visible without
 *   scrolling. The worst case on the acceptance range is a 375 px viewport with
 *   roughly 640 px usable on first paint, so the banner, the masthead, the hero
 *   and the jump row are all sized to leave the story its share.
 *
 *   Recipes are reachable within 2 taps and all content within 3. Everything is
 *   on one document and the jump row is above the fold, so the recipe carousel
 *   and the reorder button are each one tap.
 *
 *   Nothing invented is presented as real. Strings carrying the content
 *   package's sentinel are outlined, null values render as pending slots at the
 *   size the real value will occupy, and a reorder button with no cart
 *   permalink is disabled and labelled rather than hidden or pointed somewhere
 *   plausible. That is the placeholder render contract, and this page is the
 *   half of it that shows on screen.
 *
 * There is no client-side rendering, no hydration and no framework runtime
 * here. The only script is loaded after the load event. See
 * scripts/postbuild.mjs and public/js/enhance.js.
 */

import type { Blend } from '@/content/types';
import { Picture } from './Picture';
import { PlatformHelp } from './PlatformHelp';

function formatMoney(amount: number, currency: string): string {
  const major = (amount / 100).toFixed(2);
  return currency === 'USD' ? `$${major}` : `${major} ${currency}`;
}

/** Outline exactly the strings that came from a placeholder field. */
function mark(text: string | null, sentinel: string | null): string | undefined {
  return sentinel && text && text.includes(sentinel) ? 'is-placeholder' : undefined;
}

export function BlendPage({ blend }: { blend: Blend }) {
  const { grower, freshness, recipes, commerce, sentinel } = blend;
  const farm = grower.farm;

  return (
    <>
      {blend.placeholder ? (
        <div className="placeholder-banner" role="note">
          <b>Placeholder content, not for release</b>
          No name, story, location, date or price on this page is real
        </div>
      ) : null}

      <header className="masthead">
        <p className="brand">Trevean Spice</p>
        <h1>{blend.name}</h1>
        {/* An absent origin renders no separator and no empty bold. A blend
            whose provenance may not be stated shows its notes alone rather
            than a stray middle dot where a place used to be. */}
        <p className="origin">
          {blend.originRegion ? <b>{blend.originRegion}</b> : null}
          {blend.keyNotes.length > 0
            ? `${blend.originRegion ? ' · ' : ''}${blend.keyNotes.join(', ')}`
            : ''}
        </p>
      </header>

      <figure className="hero">
        <Picture image={blend.hero} priority pendingLabel="hero photograph" />
      </figure>

      <nav className="jump" aria-label="On this page">
        <a href="#story">Story</a>
        <a href="#grower">Grower</a>
        <a href="#freshness">Freshness</a>
        <a href="#recipes">Recipes</a>
        <a className="go" href="#reorder">
          Reorder
        </a>
      </nav>

      <main>
        <section id="story" className="wrap">
          <h2 className={mark(blend.originStory.heading, sentinel)}>{blend.originStory.heading}</h2>
          <p className={`lede ${mark(blend.originStory.lede, sentinel) ?? ''}`.trim()}>
            {blend.originStory.lede}
          </p>
          <div className="body">
            {blend.originStory.paragraphs.map((text, i) => (
              <p key={i} className={mark(text, sentinel)}>
                {text}
              </p>
            ))}
          </div>
        </section>

        <section id="grower" className="wrap">
          <h2>The grower</h2>
          <div className="grower">
            <Picture image={grower.photo} className="portrait" pendingLabel="portrait" />
            <div>
              <h3 className={mark(grower.name, sentinel)}>{grower.name}</h3>
              {grower.role ? (
                <p className={`role ${mark(grower.role, sentinel) ?? ''}`.trim()}>{grower.role}</p>
              ) : (
                <p className="role placeholder-pending">farm name</p>
              )}
              {grower.location ? (
                <p className="role">{grower.location}</p>
              ) : (
                <p className="role placeholder-pending">farm location</p>
              )}
            </div>
            <p className={`bio ${mark(grower.bio, sentinel) ?? ''}`.trim()}>{grower.bio}</p>
          </div>

          {/* A static raster with a link out, never a map SDK. A mapping library
              is 200 KB to 800 KB of JavaScript, larger than this whole page. */}
          <figure className="map">
            <Picture image={farm.staticMap} pendingLabel="farm map" />
            <figcaption>
              <span className={mark(farm.label, sentinel)}>
                {farm.label ?? 'Farm name not supplied'}
                {farm.latitude !== null && farm.longitude !== null
                  ? ` · ${farm.latitude.toFixed(3)}, ${farm.longitude.toFixed(3)}`
                  : ''}
              </span>
              {farm.mapLinkUrl ? (
                <a href={farm.mapLinkUrl} rel="noopener noreferrer" target="_blank">
                  View on a map
                </a>
              ) : (
                <span className="note">Coordinates not supplied, so there is no map link</span>
              )}
            </figcaption>
          </figure>
        </section>

        <section id="freshness" className="wrap">
          <h2>Freshness</h2>
          <ul className="time">
            {freshness.steps.map((step) => (
              <li key={step.label} className={step.state}>
                <h3>{step.label}</h3>
                {step.date ? (
                  <p className="when">{step.date}</p>
                ) : (
                  <p className="when placeholder-pending">date</p>
                )}
                <p className="det">{step.detail}</p>
              </li>
            ))}
          </ul>
          <p className="lot">
            Lot <span className={mark(freshness.lotCode, sentinel)}>{freshness.lotCode ?? 'not supplied'}</span>
          </p>
          {freshness.note ? <p className="lot">{freshness.note}</p> : null}
        </section>

        <section id="recipes" className="wrap">
          <h2>Recipes with this blend</h2>
          <p className="hint">Swipe for more</p>
        </section>
        <div className="wrap">
          <ul className="rail">
            {recipes.map((recipe, i) => (
              <li className="card" key={recipe.recipeId}>
                <Picture image={recipe.image} className="shot" pendingLabel="photograph" />
                <p className="num">
                  {i + 1} of {recipes.length}
                </p>
                <h3 className={mark(recipe.title, sentinel)}>
                  {recipe.url ? <a href={recipe.url}>{recipe.title}</a> : recipe.title}
                </h3>
                <p className={mark(recipe.summary, sentinel)}>{recipe.summary}</p>
                <p className="meta">
                  {recipe.timeMinutes !== null ? `${recipe.timeMinutes} min` : 'Time not supplied'}
                  {recipe.servings !== null ? ` · serves ${recipe.servings}` : ''}
                  {recipe.difficulty ? ` · ${recipe.difficulty}` : ''}
                </p>
              </li>
            ))}
          </ul>
        </div>

        <section id="reorder" className="wrap">
          <h2>Running low</h2>
          <div className="buy">
            {commerce.price ? (
              <p className="price" data-catalog="price">
                {formatMoney(commerce.price.amount, commerce.price.currency)}
              </p>
            ) : (
              <p className="price placeholder-pending" data-catalog="price">
                price
              </p>
            )}
            <p className="note" data-catalog="availability">
              {blend.name}
              {commerce.available === false ? ' · not available to order yet' : ''}
            </p>
            {commerce.cartPermalink ? (
              <a className="btn" href={commerce.cartPermalink} data-reorder="1">
                Reorder in one tap
              </a>
            ) : (
              <span className="btn placeholder-disabled" aria-disabled="true" role="link">
                Reorder in one tap
              </span>
            )}
            <p className="note foot">
              {/*
                DOES NOT NAME A BRAND, AND THAT IS CORRECT AGAIN AS OF 7 OCTOBER 2026.

                Q33 was answered on 17 September with "I will retire treveanliving
                and publish the Trevean Spice theme in its place". **That has not
                happened.** The live store's primary domain is
                shop.treveanliving.com, verified today, so a customer pressing
                reorder reaches a Trevean Living checkout.

                Naming Trevean Spice here would therefore be a false statement to a
                customer, which is the same reason this line was neutral between 17
                and 18 September. Restore the brand name when the storefront
                actually carries it, and not before. See "Decision log", D64.
              */}
              Goes straight to secure checkout. No account needed.
            </p>
          </div>
        </section>

        <PlatformHelp />
      </main>

      <footer>
        <p>Trevean Spice</p>
        <p>
          This page opens the same way from the NFC tag and from the QR code on the pack. Nothing
          about it changes between the two.
        </p>
      </footer>
    </>
  );
}
