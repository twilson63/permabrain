# PermaBrain Device Integration Plan

PermaBrain is evolving from a client-side CLI to a first-class HyperBEAM device ecosystem. This plan covers three integration tracks based on feedback from Sam Williams (@samcamwilliams).

## 1. Reference@1.0 for PermaBrain Node Resolution

### Problem
PermaBrain articles are addressed by immutable DataItem IDs. There's no indirection layer — when a new version is published, consumers must discover it through GraphQL queries or local index sync. Canonical keys (e.g., `person/ada-lovelace`) are only tracked locally.

### Solution: `~reference@1.0`

The `reference@1.0` device gives an immutable ID a mutable value. This is exactly what PermaBrain needs:

- **Article → Reference:** Each canonical key becomes a reference. The reference ID never changes, but its value updates to point to the latest article version.
- **Attestation Sets:** A reference can point to a directory of attestation references, enabling chain resolution.
- **Consensus Caching:** A reference can store the latest computed consensus score.

### Reference Chain Structure

```
permabrain-root (reference@1.0)
├── person → reference@1.0 (directory)
│   ├── ada-lovelace → reference@1.0 → {latest_article_id, latest_version}
│   └── alan-turing → reference@1.0 → {latest_article_id, latest_version}
├── subject → reference@1.0 (directory)
│   ├── ai → reference@1.0 → {latest_article_id, latest_version}
│   └── arweave → reference@1.0 → {latest_article_id, latest_version}
└── consensus → reference@1.0 (directory)
    ├── person/ada-lovelace → reference@1.0 → {score, count, updatedAt}
    └── subject/ai → reference@1.0 → {score, count, updatedAt}
```

Resolution example:
```
GET /<permabrain-root>~reference@1.0/person/ada-lovelace
→ resolves: root → person → ada-lovelace → {article_id: "FcRn..."}
```

### @permaweb/references SDK Integration

The TypeScript SDK (`@permaweb/references`) provides:

```typescript
import { ReferenceClient, fromJwk } from '@permaweb/references';

const client = new ReferenceClient({
  signer: fromJwk(jwk),
  bundler: 'https://up.arweave.net',
  // For HyperBEAM, point to local node:
  // gateway: 'http://localhost:10000',
});

// Create a reference for a PermaBrain article
const { referenceId } = await client.createReference({
  value: { articleId: 'FcRnhm9a_jMbzn2x1L9Q2KKlgDe4dCOh7IrHDVTSYHw', version: 1 },
});

// Update when new version published
await client.updateReference(referenceId, {
  value: { articleId: 'new_version_id', version: 2 },
});

// Resolve current value
const value = await client.resolveReference(referenceId);

// Resolve by name (if registered in namespace)
const article = await client.resolveName('person/ada-lovelace');
```

### Implementation Steps

1. **Add `@permaweb/references` dependency** to permabrain-project
2. **Create `src/reference.mjs`** — wrapper around ReferenceClient for PermaBrain patterns
3. **Update `src/transport.mjs`** — add reference-based resolution to HyperbeamTransport
4. **Update publish flow** — after uploading article, create/update reference to point to new version
5. **Update get flow** — resolve canonical key via reference chain first, fall back to GraphQL
6. **Update consensus flow** — cache consensus scores in references, invalidate on new attestations

### HyperBEAM Compatibility

The `@permaweb/references` SDK currently targets Arweave gateways. For HyperBEAM:

- `reference@1.0` is a native device — `GET /<ref-id>~reference@1.0/key` works directly
- Reference creation/updates use `~bundler@1.0` with appropriate tags
- The SDK may need adapter work for HyperBEAM's HTTP-SIG format vs Arweave's ANS-104
- Short-term: use SDK for Arweave, direct HTTP for HyperBEAM
- Long-term: contribute HyperBEAM transport adapter to the SDK

---

## 2. Forge Device Packaging for PermaBrain Consensus

### Problem
PermaBrain's consensus logic currently runs as a Lua script string embedded in JavaScript (`PERMABRAIN_CONSENSUS_LUA` in `hb-devices.mjs`). It's uploaded as a raw DataItem. This is fragile, not composable, and doesn't benefit from HyperBEAM's device packaging pipeline.

### Solution: Forge Device Package

Package the consensus logic as a proper HyperBEAM device using the Forge (`rebar3 device`) toolchain. This makes PermaBrain a loadable, discoverable, composable device.

### Device Package Structure

```
hyperbeam-permabrain/
├── rebar.config          # HyperBEAM dependency + Forge plugin
├── src/
│   ├── dev_permabrain_consensus.erl  # Root device module
│   ├── dev_permabrain_query.erl      # Query helper device
│   └── permabrain.app.src            # OTP app metadata
├── priv/
│   └── permabrain-consensus.lua       # Lua consensus script (loaded by Erlang device)
├── test/
│   └── dev_permabrain_consensus_test.erl
└── README.md
```

### Erlang Device Module

The Erlang device wraps the Lua consensus logic and provides the AO-Core device interface:

```erlang
%% dev_permabrain_consensus.erl
-module(dev_permabrain_consensus).
-export([compute/3, keys/3]).

%% AO-Core device interface
keys(_, _, _) ->
    {ok, [<<"consensus">>, <<"score">>, <<"count">>, <<"valid-count">>, 
          <<"invalid-count">>]}.

compute(_, Msg, _) ->
    %% Resolve attestation target from message
    Target = hb_ao:get(<<"Attestation-Target">>, Msg),
    %% Resolve all attestations via match device
    {ok, Atts} = hb_ao:resolve(Msg, <<"~match@1.0/Attestation-Target=", Target/binary>>),
    %% Compute consensus score
    {Score, Count, ValidCount, InvalidCount} = compute_score(Atts),
    {ok, Msg#{
        <<"Consensus-Score">> => float_to_binary(Score),
        <<"Consensus-Count">> => integer_to_binary(Count),
        <<"Consensus-Valid-Count">> => integer_to_binary(ValidCount),
        <<"Consensus-Invalid-Count">> => integer_to_binary(InvalidCount)
    }}.
```

### Lua Script as Device Resource

The Lua consensus script is loaded as a priv resource by the Erlang device:

```erlang
%% In dev_permabrain_consensus.erl
lua_script(_) ->
    {ok, Dir} = hb_device_archive:implementation_dir(?MODULE),
    {ok, Script} = file:read_file(filename:join(Dir, "permabrain-consensus.lua")),
    Script.
```

The Lua script remains the same logic but is now managed as a device resource, not a JS string constant.

### Forge Workflow

```bash
# 1. Scaffold the device project
rebar3 new device name=permabrain_consensus

# 2. Implement the device
#    - Edit src/dev_permabrain_consensus.erl
#    - Add priv/permabrain-consensus.lua

# 3. Test locally
rebar3 device test

# 4. Package
rebar3 device package
# Output: _build/device-packages/_hb_device_permabrain_consensus_1_0_<hash>.beam-archive.zip

# 5. Verify the archive
rebar3 device verify

# 6. Publish to Arweave
rebar3 device publish --key wallet.json
```

### Implementation Steps

1. **Install Forge template:** `./install-template --branch edge` from HyperBEAM checkout
2. **Scaffold device:** `rebar3 new device name=permabrain_consensus`
3. **Port consensus logic** from Lua string constant to `priv/permabrain-consensus.lua`
4. **Implement Erlang wrapper** (`dev_permabrain_consensus.erl`) with AO-Core device interface
5. **Implement query device** (`dev_permabrain_query.erl`) for article/attestation lookups
6. **Write EUnit tests** covering: single attestation, multiple attestations, no attestations, conflicting opinions
7. **Package and verify** with `rebar3 device package && rebar3 device verify`
8. **Test on local HyperBEAM** with `rebar3 device local` → run PermaBrain integration tests
9. **Publish** to Arweave with `rebar3 device publish`

---

## 3. HyperBEAM-PermaBrain Distro

### Vision

A composable HyperBEAM distro that bundles:

1. **permabrain-consensus@1.0** — Consensus scoring device (Erlang + Lua)
2. **permabrain-query@1.0** — Article/attestation query device
3. **Reference-based resolution** — Using `~reference@1.0` for canonical key → article mapping
4. **PermaBrain bundler integration** — Auto-index published articles via `~match@1.0`

### Distro Architecture

```
hyperbeam-permabrain/
├── rebar.config
├── src/
│   ├── dev_permabrain_consensus.erl
│   ├── dev_permabrain_query.erl
│   └── permabrain.app.src
├── priv/
│   ├── permabrain-consensus.lua
│   └── permabrain-query.lua
├── test/
│   ├── dev_permabrain_consensus_test.erl
│   └── dev_permabrain_query_test.erl
├── docs/
│   ├── SPEC.md
│   └── device-integration-plan.md
└── README.md
```

A node operator adds PermaBrain support by:
1. Including the device package in their build
2. Running `rebar3 device preload` to add to the preloaded store
3. Starting the node — PermaBrain devices are discoverable and usable

### TypeScript Client Updates

On the JS/TS side, update PermaBrain's `HyperbeamTransport`:

```javascript
// src/reference.mjs — NEW
export class PermaBrainReferenceClient {
  constructor(hbUrl, rootRefId) {
    this.hbUrl = hbUrl;
    this.rootRefId = rootRefId;
  }

  async resolveArticle(key) {
    // GET /<rootRef>~reference@1.0/{kind}/{slug}
    const url = `${this.hbUrl}/${this.rootRefId}~reference@1.0/${key}`;
    const res = await fetch(url);
    return res.json();
  }

  async updateArticle(key, articleId) {
    // Find the reference for this key, then update it
    // POST with set message via bundler
  }
}
```

```javascript
// Updated HyperbeamTransport — reference resolution
async get(key) {
  // Try reference resolution first
  if (this.referenceClient) {
    try {
      const ref = await this.referenceClient.resolveArticle(key);
      if (ref?.articleId) {
        return await this.fetchById(ref.articleId);
      }
    } catch (e) { /* fall through to query */ }
  }
  // Fallback to existing query-based resolution
  return this.queryGet(key);
}
```

---

## 4. Migration Path

### Phase 1: Reference Integration (Non-Breaking)
- Add `@permaweb/references` dependency
- Create `src/reference.mjs` client
- Update `HyperbeamTransport.get()` to try reference resolution first
- Update publish flow to create/update references
- All existing query-based paths remain as fallback
- **No changes to Arweave transport**

### Phase 2: Forge Device Package
- Scaffold `hyperbeam-permabrain` device project
- Port consensus Lua to `priv/` resource
- Implement Erlang device wrappers
- Write EUnit tests
- Package, verify, test on local HyperBEAM
- **JS client gains `consensusMethod: 'device'` option**

### Phase 3: Distro & Publish
- Merge consensus + query devices into single distro
- Add `rebar3 device publish` to CI
- Update PermaBrain docs with device installation instructions
- Add reference-based namespace resolution
- **Node operators can load PermaBrain as a single device package**

### Phase 4: SDK Contribution (Optional)
- Contribute HyperBEAM transport adapter to `@permaweb/references`
- Add reference discovery to PermaBrain CLI (`permabrain refs list`, `permabrain refs resolve`)
- Build admin tools for reference management

---

## Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Reference hierarchy | Flat directory under root | Simpler than nested references, matches PermaBrain key format |
| Consensus compute | Erlang device wrapping Lua | Best of both: Erlang AO-Core interface + Lua flexibility |
| Reference updates | Authority = publisher key | Only the original publisher can update article references |
| Query fallback | Keep existing query-based paths | Reference@1.0 may not be available on all nodes |
| SDK scope | PermaBrain-specific wrapper | Don't generalize until we have real usage patterns |

## Dependencies

- `@permaweb/references` npm package (Phase 1)
- HyperBEAM edge branch with `reference@1.0` device (Phase 1-2)
- Erlang/OTP 27+, rebar3 3.24+ (Phase 2)
- Forge device template from HyperBEAM (Phase 2)