/**
 * Shopify cart permalinks.
 *
 * A cart permalink is `https://{store}/cart/{variantId}:{quantity}`. Shopify
 * pre-fills a cart from it and drops the customer straight into checkout. No API
 * call, no client credential, nothing to fail at request time, and it bakes into
 * a pre-rendered page. That is why the design chose it over the Storefront API.
 * See "Architecture", section "Shopify Plus".
 *
 * WHY THIS FILE EXISTS, AND IT IS A SCHEDULE FACT RATHER THAN A DESIGN ONE.
 *
 * `cartPermalinkUrl` is null on every seeded row and null in the webhook path,
 * because nothing has ever derived one. Store access has been outstanding since
 * August (R7) and that made the whole reorder feature look blocked. It is not:
 * the only per blend input a permalink needs is a variant ID, and a variant ID
 * survives a theme change and a domain change alike. So the client can send four
 * numbers today, before the store settles, and the feature works.
 *
 * THE RULE THIS FILE OBEYS: RETURN NULL RATHER THAN A PLAUSIBLE URL.
 *
 * `BlendPage.tsx` renders a disabled, labelled button when `cartPermalink` is
 * null, and a working one when it is not. That is the placeholder render
 * contract: nothing invented is presented as real. A permalink guessed from a
 * half configured store would render as a live button that takes a customer to a
 * 404 in a checkout, which is worse than a button that says it is not ready.
 * **Every failure here returns null. Nothing throws and nothing guesses.**
 */

/** The maximum Shopify accepts in a single permalink line. Above this it errors rather than clamping. */
const MAX_QUANTITY = 999;

/**
 * Shopify variant identifiers arrive in two shapes and only one goes in a URL.
 *
 * The REST admin API and CSV exports give a bare numeric id, `43215678901234`.
 * GraphQL gives a global id, `gid://shopify/ProductVariant/43215678901234`. The
 * permalink takes the number. Accepting both means the client can paste whatever
 * their admin screen shows them without being told which flavour we wanted,
 * which is the difference between one message and three.
 */
const GID_PREFIX = 'gid://shopify/ProductVariant/';

/** Digits only, and at least one. Shopify ids are 64 bit integers rendered as decimal. */
const NUMERIC_ID = /^[0-9]+$/;

/**
 * A bare hostname: labels of alphanumerics and hyphens, separated by dots, with a
 * TLD. Deliberately strict. It rejects a scheme, a path, a port, a query, credentials
 * and whitespace, because every one of those has a way of turning a permalink into a
 * link that goes somewhere other than the store.
 */
const HOSTNAME = /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;

export function normaliseVariantId(raw: unknown): string | null {
  if (typeof raw === 'number') {
    // A Shopify variant id exceeds Number.MAX_SAFE_INTEGER's digit count in practice, so a
    // number that arrived as a number may already have lost precision. Refuse rather than
    // emit a permalink for a variant that does not exist.
    return Number.isSafeInteger(raw) && raw > 0 ? String(raw) : null;
  }
  if (typeof raw !== 'string') return null;

  const trimmed = raw.trim();
  if (!trimmed) return null;

  const bare = trimmed.startsWith(GID_PREFIX) ? trimmed.slice(GID_PREFIX.length) : trimmed;
  return NUMERIC_ID.test(bare) ? bare : null;
}

/**
 * Accepts what a person would actually paste: `shop.example.com`,
 * `https://shop.example.com`, or either with a trailing slash. Rejects anything
 * carrying a path, a port or credentials rather than silently discarding the part
 * it does not understand.
 */
export function normaliseStoreDomain(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;

  let value = raw.trim().toLowerCase();
  if (!value) return null;

  if (value.startsWith('https://')) value = value.slice(8);
  else if (value.startsWith('http://')) value = value.slice(7);

  while (value.endsWith('/')) value = value.slice(0, -1);

  return HOSTNAME.test(value) ? value : null;
}

export interface CartPermalinkInput {
  storeDomain: unknown;
  variantId: unknown;
  /** Defaults to 1. A reorder is one jar unless something says otherwise. */
  quantity?: unknown;
}

/**
 * Returns a cart permalink, or null if it cannot build one it is certain about.
 *
 * Null is a normal answer, not an error: it is what the store domain being
 * unconfigured looks like, and it renders as a disabled button rather than a
 * broken one.
 */
export function buildCartPermalink({ storeDomain, variantId, quantity }: CartPermalinkInput): string | null {
  const domain = normaliseStoreDomain(storeDomain);
  if (!domain) return null;

  const variant = normaliseVariantId(variantId);
  if (!variant) return null;

  const qty = quantity === undefined || quantity === null ? 1 : Number(quantity);
  if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QUANTITY) return null;

  return `https://${domain}/cart/${variant}:${qty}`;
}
