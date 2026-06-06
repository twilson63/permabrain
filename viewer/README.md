# PermaBrain Viewer

Single-file SPA for browsing PermaBrain articles and attestations on Arweave.

**Live:** https://zenbin.org/p/permabrain-viewer

## Features

- Dynamic GraphQL fetch from Arweave (no hardcoded data)
- Home page card grid of recent articles
- Article detail view with markdown rendering (marked.js)
- Attestations tab with opinion/confidence/reason
- Consensus tab with weighted scoring
- IndexedDB caching for instant repeat visits
- Incremental sync with edge-cursor pagination
- Light mode theme
- Mobile-responsive sidebar

## Deploy

### ZenBin

```sh
node scripts/publish-viewer.mjs
```

### Arweave

```sh
node scripts/upload-viewer.mjs
```

## Architecture

Single self-contained HTML file — no build step, no dependencies beyond CDN-loaded `marked.js`. All state is managed in vanilla JS with IndexedDB for persistence.

### GraphQL Pagination

Arweave GraphQL does NOT support `order` on `transactions` or `endCursor` in `pageInfo`. The viewer uses edge cursors:

```graphql
query($tags: [TagFilter!], $first: Int!, $after: String) {
  transactions(first: $first, after: $after, tags: $tags) {
    edges { cursor node { id tags { name value } } }
    pageInfo { hasNextPage }
  }
}
```

Next page cursor = `edges[last].cursor`.

### Known Limitation

`permabrain get <key>` fails on Arweave transport because gateways serve decoded content, not raw ANS-104 binary. The viewer works around this by fetching content directly from `arweave.net/{txid}`.