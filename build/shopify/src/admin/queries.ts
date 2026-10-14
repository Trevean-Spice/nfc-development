/*
 * The Admin GraphQL documents. One query, kept in one place, so what the sync asks for is
 * reviewable next to what the mapper expects.
 *
 * The field list is the minimum the catalog mirror needs and nothing more. That is a cost
 * decision as well as a discipline: the Admin GraphQL API is billed in query cost points
 * against a leaky bucket, so every field on every node in every page is paid for on every
 * scheduled run, forever.
 */

export const PRODUCTS_PAGE_QUERY = `
query CatalogMirrorProducts($first: Int!, $after: String, $query: String) {
  products(first: $first, after: $after, query: $query) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      handle
      title
      status
      tags
      variants(first: 20) {
        nodes {
          id
          sku
          position
          price
          compareAtPrice
          inventoryQuantity
          inventoryPolicy
          availableForSale
          inventoryItem { tracked }
        }
      }
    }
  }
}
`.trim();

export interface ProductsPageData {
  products: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: Array<{
      id: string;
      handle: string | null;
      title: string | null;
      status: string | null;
      tags: string[] | null;
      variants: {
        nodes: Array<{
          id: string;
          sku: string | null;
          position: number | null;
          price: string | null;
          compareAtPrice: string | null;
          inventoryQuantity: number | null;
          inventoryPolicy: string | null;
          availableForSale: boolean | null;
          inventoryItem: { tracked: boolean | null } | null;
        }>;
      };
    }>;
  };
}
