/*
 * The webhook topics this integration subscribes to, and nothing else.
 *
 * Two topics, because the Architecture document, "Shopify Plus", names two jobs that need
 * a push from Shopify: keeping the catalog mirror fresh between scheduled syncs, and
 * feeding reorder attribution. Every additional subscription is another unauthenticated
 * endpoint to defend and another payload shape to keep working, so the list is short on
 * purpose and adding to it is a decision rather than a convenience.
 */

export const TOPIC_PRODUCTS_UPDATE = 'products/update';
export const TOPIC_ORDERS_CREATE = 'orders/create';

export const SUBSCRIBED_TOPICS = [TOPIC_PRODUCTS_UPDATE, TOPIC_ORDERS_CREATE] as const;

export type SubscribedTopic = (typeof SUBSCRIBED_TOPICS)[number];

/**
 * Where each topic is handled. The catalog mirror path and the attribution path are
 * separate endpoints with separate handlers, so a change to one cannot break the other and
 * a failure on one does not stop the other being delivered.
 */
export const TOPIC_ROUTES: Record<SubscribedTopic, string> = {
  [TOPIC_PRODUCTS_UPDATE]: '/internal/webhooks/shopify/products-update',
  [TOPIC_ORDERS_CREATE]: '/internal/webhooks/shopify/orders-create',
};

export function isSubscribedTopic(topic: unknown): topic is SubscribedTopic {
  return typeof topic === 'string' && (SUBSCRIBED_TOPICS as readonly string[]).includes(topic);
}
