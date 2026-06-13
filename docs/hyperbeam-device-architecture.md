# PermaBrain HyperBEAM Device Architecture

PermaBrain implements the AO-Core device model on HyperBEAM, using native
devices for publishing, querying, attestation linking, consensus compute,
and mutable references.

## Protocol Mapping: PermaBrain → HyperBEAM Devices

| PermaBrain Operation | HyperBEAM Device | HTTP Pattern | Description |
|---------------------|------------------|--------------|-------------|
| Publish article | `~bundler@1.0` | `POST /~bundler@1.0/tx` | Persist DataItem, auto-index via match device |
| Fetch article | `message@1.0` | `GET /{id}` | HTTP-SIG formatter returns tags as headers |
| Query by tags | `~query@1.0` | `GET /~query@1.0?Article-Key=...&App-Name=PermaBrain` | Native tag-based search via match index |
| Attest | `~bundler@1.0` | `POST /~bundler@1.0/tx` | Same as publish (attestations are DataItems) |
| Find attestations | `~match@1.0` | `GET /~match@1.0/Attestation-Target={id}` | Reverse index lookup |
| **Article versioning** | `~reference@1.0` | `GET /{refId}~reference@1.0/{path}` | **Mutable pointers for article keys → latest version** |
| **Topic index** | `~reference@1.0` | `GET /{setId}~reference@1.0/ai` | **Reference sets: directory of named references** |
| Consensus | `lua@5.3a` | `GET /{process}~process@1.0/consensus` | Lua compute on node |
| Push message | `~push@1.0` | `POST /{scheduler}~push@1.0` | Route messages to processes |
| Node info | `~meta@1.0` | `GET /~meta@1.0/info` | Node metadata |

## Reference@1.0 — First-Class Mutable Pointers

**Feedback from Sam Williams (@samcamwilliams):** PermaBrain should use
`~reference@1.0` for article versioning, not just the match index.

A reference gives an **immutable ID a mutable value** — perfect for PermaBrain:
- Article key (e.g., `subject/karpathy-llm-wiki`) → reference → latest version DataItem ID
- Topic directory → reference set → `{ "ai": ref_id, "crypto": ref_id, ... }`
- Author identity → reference → latest attestation

### Reference Lifecycle

1. **init** — Create a reference with an initial value (signed by authority)
   ```
   init = { device: "reference@1.0", reference-value: { current-version: "<articleId>" } }
   → ID becomes the reference's permanent name (e.g., `b6X...Q4`)
   ```

2. **set** — Update the value (signed by authority, newer timestamp)
   ```
   set = { device: "reference@1.0", reference-id: "b6X...Q4",
           timestamp: 2, reference-value: { current-version: "<newArticleId>" } }
   ```

3. **read** — Resolve current value
   ```
   GET /b6X...Q4~reference@1.0/current-version → "<newArticleId>"
   ```

### Resolution Chains

References compose through nested resolution:
```
GET /<set>~reference@1.0/alice/balance
→ set resolves alice → her ref → balance
```

Each downstream reference is owned and updated independently.

### Why References > Match-Only

| Match Index | References |
|-------------|------------|
| Every tag is queryable | Mutable pointers with stable IDs |
| Point-in-time lookups | Always resolves to latest version |
| Requires scanning all results | Direct resolution, no scanning |
| No ownership model | Authority-based updates |
| No versioning | Timestamps for ordering |

References are the **recommended approach** for PermaBrain article keys.
The match index still works for ad-hoc queries, but article versioning
should use references for guaranteed latest-version resolution.

### `@permaweb/references` SDK

For Arweave-layer reference operations (outside HyperBEAM):
```javascript
import { ReferenceClient } from '@permaweb/references';
const names = new ReferenceClient();
// Resolve a Permaweb Name or custom reference
const value = await names.resolveName('ao');
const ref = await names.getReference(referenceId);
// Create/update references
await names.createReference({ value: targetTxId });
await names.updateReference(referenceId, { value: newValue });
```

## Device Details

### 1. Bundler (`~bundler@1.0`)
Already working. Persists DataItems and makes them fetchable via `GET /{id}`.
Auto-indexes tags into the match index for query-by-tag support.

### 2. Match/Query (`~match@1.0`, `~query@1.0`)
HyperBEAM's `dev_match` maintains a reverse index: for every key-value pair
in a message, it stores the message ID under `~match@1.0&Key=Value`.

For ad-hoc queries (not versioned references):
```
GET /~query@1.0?Article-Key=subject/karpathy-llm-wiki-pattern&return=messages
GET /~match@1.0/Attestation-Target=GPHDnqQOdwCX51fkdry8oeeOLkCso27_pIR5WsuEsic
```

### 3. Reference (`~reference@1.0`)
First-class mutable pointers. Preferred for article versioning.
- Immutable ID, mutable value
- Authority-based updates (only owner can set)
- Resolution chains compose naturally
- Node handles caching and freshness (max-age)

### 4. Lua Device (`lua@5.3a`)
Runs Lua scripts on the HyperBEAM node. Scripts are loaded as modules.

### 5. Forge Device Package (`hyperbeam-permabrain`)

PermaBrain's consensus and query Lua scripts should be packaged as a proper
HyperBEAM Forge device package — making `hyperbeam-permabrain` a composable
addition to any HyperBEAM node.

**Device packaging** is the standard way to distribute HyperBEAM devices:
- `rebar3 device package` — Build signed device archive
- `rebar3 device test` — Run EUnit tests against preloaded store
- `rebar3 device publish` — Upload to Arweave

The `hb-forge/` directory contains:
- `src/dev_permabrain_consensus.erl` — Erlang consensus device
- `src/dev_permabrain_query.erl` — Erlang query device with reference resolution
- `rebar.config` — Forge build configuration

These will eventually replace the inline Lua scripts in `hb-consensus.mjs`
with proper Forge-packaged BEAM modules.

### 6. Push (`~push@1.0`)
Submits messages to AO processes.

### 7. Node Info (`~meta@1.0`)
Node metadata and configuration.

## Architecture: HyperBEAM-First

```
Agent → PermaBrain API
         ↓
    HyperbeamTransport (devices)
    ├── publish     → POST /~bundler@1.0/tx
    ├── get         → GET /{id} (HTTP-SIG)
    ├── query       → GET /~query@1.0?tags (match index)
    ├── attest      → POST /~bundler@1.0/tx (Attestation-* tags)
    ├── consensus   → GET /{process}~process@1.0/consensus (Lua/Erlang)
    ├── match       → GET /~match@1.0/{key}={value}
    ├── reference   → GET /{refId}~reference@1.0/{path}
    ├── ref-create   → POST (init message with reference@1.0 device)
    ├── ref-update   → POST (set message with reference-id + timestamp)
    └── push        → POST /{scheduler}~push@1.0
         ↓
    ArweaveTransport (fallback/persistence)
    ├── upload → POST https://up.arweave.net/tx
    ├── fetch  → GET https://arweave.net/{id}
    └── query  → POST https://arweave.net/graphql
```

## Implementation Plan

1. ~~New `src/hb-devices.mjs`~~ — Device constants, URL builders, HTTP-SIG helpers ✅
2. ~~Refactor `HyperbeamTransport`~~ — Use device model for all operations ✅
3. ~~New `src/hb-consensus.mjs`~~ — Consensus via Lua device ✅
4. ~~New `src/hb-query.mjs`~~ — Query builder using ~query@1.0 and ~match@1.0 ✅
5. **New `src/hb-reference.mjs`** — Reference@1.0 for mutable article pointers ✅
6. **New `hb-forge/`** — Forge device package for Erlang implementations ✅
7. **Update `src/transport.mjs`** — Wire reference into HyperbeamTransport ✅
8. **Tests** — Test reference operations against live HyperBEAM node
9. **Device packaging** — Build and publish `hyperbeam-permabrain` Forge package
10. **`@permaweb/references` integration** — Arweave-layer reference reads