/*
 * @trevean/shopify-integration
 *
 * The three jobs and three tools in the Architecture document, "Shopify Plus":
 *
 *   one tap reorder   cart permalink       permalink.ts, reorder.ts        buildable now
 *   anything richer   Storefront API       storefront/                     awaits store access
 *   catalog sync      Admin API            admin/, mirror/                 awaits store access
 *   order webhook     signature verified   webhooks/                       buildable now
 *
 * What is proven and what awaits Shopify Plus store access is set out in the README, and
 * the boundary is a real one in the code rather than a caveat in prose: everything that
 * touches the network is behind a transport interface, and the test suite exercises the
 * layers above it against recorded and simulated responses.
 */

export * from './types.js';
export * from './ids.js';
export * from './money.js';
export * from './permalink.js';
export * from './reorder.js';
export * from './config.js';

export * from './mirror/product.js';
export * from './mirror/map.js';
export * from './mirror/degrade.js';

export * from './webhooks/verify.js';
export * from './webhooks/topics.js';
export * from './webhooks/productsUpdate.js';
export * from './webhooks/ordersCreate.js';

export * from './admin/transport.js';
export * from './admin/queries.js';
export * from './admin/catalogSync.js';

export * from './storefront/cart.js';
export * from './storefront/transport.js';
