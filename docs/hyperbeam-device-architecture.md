# PermaBrain HyperBEAM Device Architecture

PermaBrain implements the AO-Core device model on HyperBEAM, using native
devices for publishing, querying, attestation linking, and consensus compute.

## Protocol Mapping: PermaBrain → HyperBEAM Devices

| PermaBrain Operation | HyperBEAM Device | HTTP Pattern | Description |
|---------------------|------------------|--------------|-------------|
| Publish article | `~bundler@1.0` | `POST /~bundler@1.0/tx` | Persist DataItem, auto-index via match device |
| Fetch article | `message@1.0` | `GET /{id}` | HTTP-SIG formatter returns tags as headers |
| Query by tags | `~query@1.0` | `GET /~query@1.0?Article-Key=...&App-Name=PermaBrain` | Native tag-based search via match index |
| Attest | `~bundler@1.0` | `POST /~bundler@1.0/tx` | Same as publish (attestations are DataItems) |
| Find attestations | `~match@1.0` | `GET /~match@1.0/Attestation-Target={id}` | Reverse index lookup |
| Consensus | `lua@5.3a` | `GET /{process}~process@1.0/consensus` | Lua compute on node |
| Push message | `~push@1.0` | `POST /{scheduler}~push@1.0` | Route messages to processes |
| Node info | `~meta@1.0` | `GET /~meta@1.0/info` | Node metadata |

## Device Details

### 1. Bundler (`~bundler@1.0`)
Already working. Persists DataItems and makes them fetchable via `GET /{id}`.
Auto-indexes tags into the match index for query-by-tag support.

### 2. Match/Query (`~match@1.0`, `~query@1.0`)
HyperBEAM's `dev_match` maintains a reverse index: for every key-value pair
in a message, it stores the message ID under `~match@1.0&Key=Value`.

The `dev_query` device provides higher-level search:
- `all` — match all keys in request
- `only` — match specific keys
- `base` — match keys from base message
- Return types: `paths`, `messages`, `count`, `first`, `boolean`

For PermaBrain:
```
GET /~query@1.0?Article-Key=subject/karpathy-llm-wiki-pattern&return=messages
GET /~match@1.0/Attestation-Target=GPHDnqQOdwCX51fkdry8oeeOLkCso27_pIR5WsuEsic
```

### 3. Lua Device (`lua@5.3a`)
Runs Lua scripts on the HyperBEAM node. Scripts are loaded as modules
(content-type: `application/lua`). Each function in a Lua module becomes
a resolvable key.

The `dev_lua_lib` provides AO-Core primitives to Lua:
- `ao.get(key)` — read from the message
- `ao.resolve(path)` — resolve a path on the node
- `ao.set(key, value)` — set a value in the result
- `ao.event(msg)` — log an event

For PermaBrain, a Lua module implements consensus scoring:
```lua
-- permabrain-consensus.lua
function consensus()
  local target = ao.get("Attestation-Target")
  if not target then
    return { status = "error", body = "Missing Attestation-Target" }
  end
  
  -- Resolve all attestations for this target via match device
  local atts = ao.resolve("~match@1.0/Attestation-Target=" .. target)
  if not atts then
    return { status = "ok", body = "0", count = 0, score = 0 }
  end
  
  local score = 0
  local count = 0
  for _, att in ipairs(atts) do
    local valid = ao.get(att, "Attestation-Valid")
    local confidence = ao.get(att, "Attestation-Confidence")
    if valid == "valid" then
      score = score + (tonumber(confidence) or 0)
      count = count + 1
    end
  end
  
  ao.set("Consensus-Score", tostring(score / count))
  ao.set("Consensus-Count", tostring(count))
  return { status = "ok", score = score / count, count = count }
end
```

### 4. Push (`~push@1.0`)
Submits messages to AO processes. For PermaBrain, used for:
- Routing attestation notifications to subscribed processes
- Triggering consensus computation on publish events

### 5. References (implicit via match index)
HyperBEAM doesn't have a standalone "references device". Instead, references
are implicit through the match index:
- An attestation has `Attestation-Target: {article-id}` → matchable
- An article has `Article-Source-Url: ...` → matchable
- Any key-value pair in any message is indexed automatically

This is actually MORE powerful than explicit references because every tag
becomes a queryable link without additional indexing infrastructure.

## Architecture: HyperBEAM-First

```
Agent → PermaBrain API
         ↓
    HyperbeamTransport (devices)
    ├── publish  → POST /~bundler@1.0/tx
    ├── get      → GET /{id} (HTTP-SIG)
    ├── query    → GET /~query@1.0?tags (match index)
    ├── attest   → POST /~bundler@1.0/tx (Attestation-* tags)
    ├── consensus → GET /{process}~process@1.0/consensus (Lua)
    ├── match    → GET /~match@1.0/{key}={value}
    └── push     → POST /{scheduler}~push@1.0
         ↓
    ArweaveTransport (fallback/persistence)
    ├── upload → POST https://up.arweave.net/tx
    ├── fetch  → GET https://arweave.net/{id}
    └── query  → POST https://arweave.net/graphql
```

## Implementation Plan

1. **New `src/hb-devices.mjs`** — Device constants, URL builders, HTTP-SIG helpers
2. **Refactor `HyperbeamTransport`** — Use device model for all operations
3. **New `src/hb-lua/`** — PermaBrain Lua device scripts
4. **New `src/hb-query.mjs`** — Query builder using ~query@1.0 and ~match@1.0
5. **New `src/hb-consensus.mjs`** — Consensus via Lua device
6. **Update `src/transport.mjs`** — HyperBEAM as primary, Arweave as persistence layer
7. **Tests** — Verify all device interactions