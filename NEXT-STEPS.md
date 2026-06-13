# PermaBrain Forge Device Package — Local Build Instructions

## What's Done

✅ Steps 1-4 complete (tested in Daytona sandbox):
- Device project scaffolded with `rebar3 new device`
- Erlang code compiled (`rebar3 compile` exit 0)
- Device packages generated (2 `.beam-archive.zip` files)
- Verification passed (`rebar3 device verify` exit 0)

✅ GitHub Actions workflow: `.github/workflows/build-dev-image.yml`
✅ Dockerfile: `hb-forge/Dockerfile`
✅ Operator guide: `docs/hyperbeam-operator-guide.md`

## Remaining Steps (Steps 5-12)

### Step 5: Run Device Tests

```bash
# Option A: Using the Docker dev image (after building, see Step 6)
docker run --rm -v $(pwd):/work ghcr.io/twilson63/hyperbeam-dev:latest \
  sh -c "cd /work && rebar3 device test"

# Option B: Locally (requires Erlang/OTP 27+, rebar3 3.24+, Rust)
cd permabrain_consensus  # the scaffolded project in the sandbox
rebar3 device test
```

**Verify:** EUnit tests pass for both `dev_permabrain_consensus` and `dev_permabrain_query`.

### Step 6: Build Docker Dev Image

```bash
cd permabrain  # repo root
docker buildx build --platform linux/amd64 \
  -t ghcr.io/twilson63/hyperbeam-dev:latest \
  -t ghcr.io/twilson63/hyperbeam-dev:0.1.0 \
  --push \
  -f hb-forge/Dockerfile .
```

**Verify:** `docker run --rm ghcr.io/twilson63/hyperbeam-dev:latest erl -version` shows OTP 27.

**Note:** If `docker buildx` isn't set up:
```bash
docker buildx create --use
```

**Or build locally without push:**
```bash
docker build -t hyperbeam-dev:latest -f hb-forge/Dockerfile .
```

### Step 7: Deploy to Sandbox with Devices Loaded

```bash
# Create a new HyperBEAM sandbox with devices preloaded
# Option A: Build a new Docker image that includes the device packages
# Option B: Use rebar3 device local to start a node with devices

# Using rebar3 device local (in the dev container):
docker run --rm -it -p 8734:8734 \
  -v $(pwd):/work \
  ghcr.io/twilson63/hyperbeam-dev:latest \
  sh -c "cd /work/permabrain_consensus && \
    HB_PORT=8734 HB_MODE=debug rebar3 device local"
```

**Verify:**
```bash
curl http://localhost:8734/~meta@1.0/info | head -5
# Should show permabrain-consensus and permabrain-query in loaded devices
```

### Step 8: Test Reference@1.0 on Live Node

```bash
# Create a reference (init message)
# POST to ~bundler@1.0/tx with device: ~reference@1.0
# The init message establishes a permanent ID with a mutable value

# Using PermaBrain JS SDK:
node -e "
import { HyperbeamReference } from './src/hb-reference.mjs';
const ref = new HyperbeamReference('http://localhost:8734');
const result = await ref.create(
  { 'article-key': 'subject/test-article', 'current-version': 'test123' },
  identity  // from keys.mjs
);
console.log('Reference created:', result);
"

# Or manually via HTTP:
curl -X POST http://localhost:8734/~bundler@1.0/tx?codec-device=ans104@1.0 \
  -H "Content-Type: application/octet-stream" \
  --data-binary @reference-init-dataitem.bin

# Resolve:
curl http://localhost:8734/{refId}~reference@1.0/current-version
```

**Verify:** `GET /{refId}~reference@1.0/current-version` returns the article DataItem ID.

### Step 9: Test Consensus & Query Devices on Live Node

```bash
# Upload article + attestations, then compute consensus
curl "http://localhost:8734/{processId}~process@1.0/consensus" \
  -H "Attestation-Target: {articleId}"

# Query articles
curl "http://localhost:8734/{processId}~process@1.0/query?Article-Key=subject/test&return=messages"
```

**Verify:** Consensus returns score/count, query returns matching articles.

### Step 10: Publish to Arweave

```bash
# Requires an Arweave wallet key file
rebar3 device publish --key wallet.json

# This outputs:
# permabrain-consensus@1.0:
#   spec: <SPEC_ID>
#   impl: <IMPL_ID>
# permabrain-query@1.0:
#   spec: <SPEC_ID>
#   impl: <IMPL_ID>
```

Record these IDs — operators need them to trust your devices.

### Step 11: Update Operator Guide

After publishing, add the real device IDs to `docs/hyperbeam-operator-guide.md`:

```markdown
### Published Device IDs

- permabrain-consensus@1.0:
  - Spec: `<SPEC_ID from Step 10>`
  - Impl: `<IMPL_ID from Step 10>`
- permabrain-query@1.0:
  - Spec: `<SPEC_ID from Step 10>`
  - Impl: `<IMPL_ID from Step 10>`
```

### Step 12: End-to-End Integration Test

On a fresh HyperBEAM node with only the published device package:

```bash
# 1. Publish article via bundler
# 2. Create reference pointing to article
# 3. Upload attestation
# 4. Compute consensus via device
# 5. Query articles via device
# 6. Resolve reference to latest version
# 7. Verify all steps succeed
```

**Verify:** Full PermaBrain workflow works end-to-end on a fresh node.

## Key Files

| File | Purpose |
|------|---------|
| `hb-forge/Dockerfile` | Dev environment with Erlang/Rust/rebar3/Forge |
| `hb-forge/README.md` | Quick start guide |
| `hb-forge/scripts/build-dev-image.sh` | Build/push script for GHCR |
| `hb-forge/rebar.config` | Forge build config |
| `hb-forge/src/dev_permabrain_consensus.erl` | Consensus device (Erlang) |
| `hb-forge/src/dev_permabrain_query.erl` | Query + reference device (Erlang) |
| `.github/workflows/build-dev-image.yml` | CI workflow for Docker image |
| `src/hb-reference.mjs` | Reference@1.0 JS SDK |
| `src/hb-devices.mjs` | Device constants + URL builders |
| `docs/hyperbeam-operator-guide.md` | Full operator setup guide |

## Device Archive Names (from Step 3)

```
_hb_device_permabrain_consensus_1_0_pjs5d5oupawuavzy3qzxvofzbeoyrmzexytqmozeu3rg6lw5ee5q.beam-archive.zip
_hb_device_permabrain_query_1_0_uqkjdvy7dl3yfjqzlyiqu2na7bwoiqc7jhgfttkkdx7bjqipj5ba.beam-archive.zip
```

These are in the Daytona sandbox build — you'll need to rebuild locally or extract from the sandbox before it's deleted.

## Daytona Sandbox Cleanup

There's a crashed dev sandbox (`1ccbbdf6`) and the HB sandbox (`4a9344e5`). Delete them if no longer needed:

```bash
# In Daytona dashboard, or via API:
daytona.delete('1ccbbdf6-79fa-416e-b372-de540dd33731')  # dev sandbox (crashed)
daytona.delete('4a9344e5-ce2a-412a-8642-87382014da62')   # HB sandbox (stopped)
```