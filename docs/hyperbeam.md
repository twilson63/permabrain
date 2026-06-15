# PermaBrain HyperBEAM User Guide

PermaBrain can store and query knowledge on [HyperBEAM](https://github.com/permaweb/HyperBEAM) using native AO-Core devices. This guide covers the `--use-hyperbeam` global CLI mode and the underlying device requirements.

## Quick Start

Set the transport to HyperBEAM and point at a node:

```bash
export PERMABRAIN_TRANSPORT=hyperbeam
export PERMABRAIN_HYPERBEAM_URL=http://localhost:10000

permabrain init --key-type ed25519
permabrain probe-hyperbeam
```

A healthy local node exposes:

- Gateway: `http://localhost:10000`
- GraphQL: `http://localhost:10000/graphql`
- Bundler upload: `http://localhost:10000/~bundler@1.0/tx?codec-device=ans104@1.0`

## `--use-hyperbeam` CLI Mode

Add `--use-hyperbeam` to any of the normal publish/attest/get/find commands. PermaBrain will use `HyperbeamTransport` for the operation and fall back to Arweave GraphQL or the local cache if the HyperBEAM node is unavailable.

### Publish

```bash
permabrain publish article.md \
  --use-hyperbeam \
  --kind subject \
  --topic ai \
  --source-url https://example.com/article
```

Behavior:

- Uploads a signed ANS-104 DataItem to `~bundler@1.0`.
- Tags are auto-indexed by the `~match@1.0` device.
- If HyperBEAM references are enabled, the article key is mapped to a mutable `~reference@1.0` pointer.

### Attest

```bash
permabrain attest subject/my-article \
  --use-hyperbeam \
  --valid \
  --confidence 0.95 \
  --reason "Well-sourced and accurate"
```

Attestations are also DataItems; the target article is resolved via the latest reference or tag query, and the attestation is uploaded to `~bundler@1.0`.

### Get

```bash
permabrain get subject/my-article --use-hyperbeam
```

Resolution order:

1. Local `article-references.json` cache → `~reference@1.0/current-version`.
2. Tag query on `~query@1.0` (falls back to Arweave GraphQL).
3. Direct DataItem fetch via `GET /{id}`.

If the fetched content hash does not match the article metadata, PermaBrain raises an error (except when the article came from a reference, where the metadata is the reference itself).

### Query / Find

```bash
permabrain query --use-hyperbeam --topic ai
```

Uses `~query@1.0` first, then Arweave GraphQL, then merges local cache results.

## Global Flag vs Configuration

You can make HyperBEAM the default in `config.json`:

```json
{
  "transport": "hyperbeam",
  "gateway": {
    "type": "hyperbeam",
    "dataUrl": "http://localhost:10000",
    "graphqlUrl": "http://localhost:10000/graphql"
  },
  "bundler": {
    "type": "hyperbeam",
    "uploadUrl": "http://localhost:10000/~bundler@1.0/tx?codec-device=ans104@1.0"
  },
  "hyperbeam": {
    "references": true
  }
}
```

When `config.transport` is `hyperbeam`, `--use-hyperbeam` is effectively always on. The flag is useful when you normally publish to Arweave but occasionally want to route a single command through HyperBEAM.

## Device Requirements

| PermaBrain Operation | HyperBEAM Device | Purpose |
|----------------------|------------------|---------|
| Publish / Attest     | `~bundler@1.0`   | Persist signed DataItems |
| Fetch by ID          | `message@1.0` / `httpsig@1.0` | Return tags as headers, body as payload |
| Query by tags        | `~query@1.0`      | Native tag search over match index |
| Reverse lookup       | `~match@1.0`      | Direct key-value → message IDs |
| Article versioning   | `~reference@1.0` | Mutable key → latest version pointer |
| Consensus compute    | `lua@5.3a`        | On-node weighted scoring |
| Node metadata        | `~meta@1.0`       | Health and device discovery |

Only `~bundler@1.0` and fetch-by-id are strictly required for basic publish/get. Query, match, reference, and Lua devices unlock the full feature set.

## Fallback Behavior

`HyperbeamTransport` is designed to degrade gracefully:

1. `~query@1.0` unavailable → fall back to Arweave GraphQL.
2. GraphQL unavailable → merge local cache results.
3. `~reference@1.0` unavailable → fall back to tag-based latest lookup.
4. `lua@5.3a` unavailable → compute consensus locally from attestations found via `~match@1.0` or GraphQL.

The `--use-hyperbeam` mode is therefore safe to use even on partially configured nodes or intermittent connections.

## Reference-Enabled Articles

When `hyperbeam.references` is true, every article key gets a stable `~reference@1.0` pointer. This guarantees that `get subject/my-article` always resolves to the latest published version, even if the tag index lags.

First publish creates the reference:

```bash
permabrain publish article.md --use-hyperbeam --kind subject --topic ai --source-url ...
# Reference: ref-ABC (create)
```

Subsequent publishes update it:

```bash
permabrain publish article.md --use-hyperbeam --kind subject --topic ai --source-url ...
# Reference: ref-ABC (update)
```

The reference ID is cached in `$PERMABRAIN_HOME/cache/article-references.json`.

## Programmatic API

```javascript
import { api } from 'permabrain';

await api.init({ transport: 'hyperbeam' });

// Equivalent to --use-hyperbeam publish
await api.publish({
  content: '# Hello HyperBEAM',
  kind: 'subject',
  topic: 'ai',
  sourceUrl: 'https://example.com/hello',
  useHyperbeamReference: true
});

const article = await api.get('subject/hello');
await api.attest('subject/hello', {
  opinion: 'valid',
  confidence: 0.95,
  reason: 'Looks good'
});
```

The `useHyperbeamReference` option (and the `PERMABRAIN_HYPERBEAM_REFERENCES=1` environment variable) controls reference creation without changing the default transport.

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `PERMABRAIN_TRANSPORT=hyperbeam` | Make HyperBEAM the default transport |
| `PERMABRAIN_HYPERBEAM_URL` | Base HyperBEAM URL |
| `PERMABRAIN_GRAPHQL_URL` | Override GraphQL endpoint |
| `PERMABRAIN_UPLOAD_URL` | Override bundler upload URL |
| `PERMABRAIN_HYPERBEAM_REFERENCES=1` | Enable reference creation/updates by default |
| `PERMABRAIN_REQUIRE_HYPERBEAM=1` | Make `probe-hyperbeam` failures fatal |

| Variable | Purpose |
|----------|---------|
| `PERMABRAIN_TRANSPORT=hyperbeam` | Make HyperBEAM the default transport |
| `PERMABRAIN_HYPERBEAM_URL` | Base HyperBEAM URL |
| `PERMABRAIN_GRAPHQL_URL` | Override GraphQL endpoint |
| `PERMABRAIN_UPLOAD_URL` | Override bundler upload URL |
| `PERMABRAIN_HYPERBEAM_REFERENCES=1` | Enable reference creation/updates by default |
| `PERMABRAIN_REQUIRE_HYPERBEAM=1` | Make `probe-hyperbeam` failures fatal |

## Transport Architecture

PermaBrain keeps transport selection in one place:

- `src/config.mjs` produces the default configuration and validates HyperBEAM-specific URLs.
- `src/transport.mjs` resolves which transport class to use (`local`, `arweave`, or `hyperbeam`) based on `config.transport` or the `--use-hyperbeam` flag.
- `src/hyperbeam-transport.mjs` is the clean facade that wraps the HyperBEAM device modules:
  - `hb-query.mjs` for `~query@1.0` / `~match@1.0`
  - `hb-consensus.mjs` for `lua@5.3a` consensus
  - `hb-reference.mjs` for `~reference@1.0` versioning

When `PERMABRAIN_TRANSPORT=hyperbeam` (or `config.transport === 'hyperbeam'`), `getTransport()` returns `HyperbeamTransport`. The same happens on a per-command basis when `--use-hyperbeam` is passed; otherwise Arweave stays the default.

### Configuration validation

`src/config.mjs` exposes `validateHyperbeamConfig(config)`. It is called automatically by `new HyperbeamTransport(config)` and will throw clear errors if any of these are missing or invalid:

- `config.gateway.dataUrl`
- `config.gateway.graphqlUrl`
- `config.bundler.uploadUrl`

This prevents silent misconfiguration such as an unset `PERMABRAIN_HYPERBEAM_URL` or a malformed upload URL.

## Troubleshooting

### Probe cannot reach HyperBEAM

```bash
curl -i http://localhost:10000
```

Check the port and that HyperBEAM is running (`rebar3 shell`, `hb daemon`, or a Daytona sandbox).

### Query device returns 500

PermaBrain falls back to GraphQL. If GraphQL also fails, only local cache results are returned. Run `permabrain sync` to populate the cache.

### Content hash mismatch on get

The fetched DataItem tags claim a different content hash than the body. This usually means a stale cache or a corrupted gateway response. Run `sync` and try again, or bypass the cache by using `--use-hyperbeam` to force a fresh lookup.

### Reference update fails

Only the reference authority (the agent that created it) can update a reference. If you switch identities, create a new reference for that key.
