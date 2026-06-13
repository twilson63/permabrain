# PermaBrain HyperBEAM Device Package — Build & Operator Guide

## Overview

PermaBrain publishes two HyperBEAM devices as a Forge package (`hyperbeam-permabrain`):

1. **`permabrain-consensus@1.0`** — Computes weighted consensus scores for articles by resolving attestations via `~match@1.0`
2. **`permabrain-query@1.0`** — Structured PermaBrain queries + `~reference@1.0` resolution for article versioning

PermaBrain also uses **`~reference@1.0`** (a core HyperBEAM device) for mutable article pointers — no packaging needed, just initialization.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                 HyperBEAM Node                       │
│                                                      │
│  ┌──────────────┐  ┌──────────────┐                │
│  │ ~bundler@1.0 │  │ ~reference@1.0│ ← core device │
│  │  (persist)   │  │  (mutable ptr) │               │
│  └──────┬───────┘  └──────┬───────┘                │
│         │                  │                         │
│  ┌──────┴──────────────────┴──────┐                 │
│  │   hyperbeam-permabrain distro  │                 │
│  │  ┌─────────────────────────┐   │                 │
│  │  │ permabrain-consensus@1.0 │   │ ← Forge pkg   │
│  │  └─────────────────────────┘   │                 │
│  │  ┌─────────────────────────┐   │                 │
│  │  │ permabrain-query@1.0     │   │ ← Forge pkg   │
│  │  └─────────────────────────┘   │                 │
│  └────────────────────────────────┘                 │
│         │                  │                         │
│  ┌──────┴──────────────────┴──────┐                │
│  │    ~match@1.0  ~query@1.0      │ ← core devices │
│  └────────────────────────────────┘                │
│         │                                            │
│    ┌────┴────┐                                      │
│    │ Arweave │ ← persistence layer                  │
│    └─────────┘                                      │
└─────────────────────────────────────────────────────┘
```

## Step 1: Build the Forge Package

### Prerequisites

- Erlang/OTP 27+
- rebar3 3.24.0+
- Arweave wallet key file (`wallet.json`)
- HyperBEAM source (edge branch) for the Forge plugin

### Install the Forge Template

```bash
git clone https://github.com/permaweb/HyperBEAM.git
cd HyperBEAM
git checkout edge
./install-template --branch edge
```

### Create the Device Project

```bash
rebar3 new device name=permabrain_consensus
cd permabrain_consensus
```

This generates:
```
rebar.config          # Forge plugin + hb dependency
src/
  dev_permabrain_consensus.erl   # Device root module
  permabrain_consensus.app.src  # OTP app metadata
README.md
```

### Add the Query Device

Create `src/dev_permabrain_query.erl` alongside the consensus device. The project supports multiple `dev_*` roots — the Forge will package each one.

### Project Structure

```
hyperbeam-permabrain/
├── rebar.config
├── src/
│   ├── dev_permabrain_consensus.erl   # Consensus scoring device
│   ├── dev_permabrain_query.erl       # Query + reference resolution
│   └── permabrain.app.src             # OTP app metadata
├── test/
│   └── dev_permabrain_consensus_test.erl
│   └── dev_permabrain_query_test.erl
└── README.md
```

### Build & Test

```bash
# Package all dev_* roots into BEAM archives
rebar3 device package

# Verify archives load cleanly and exports match
rebar3 device verify

# Run EUnit tests against a preloaded store
rebar3 device test

# Start a local node with your devices loaded
rebar3 device local
```

### Publish to Arweave

```bash
# Sign and upload spec + implementation messages
rebar3 device publish --key wallet.json
```

> **Note:** on the HyperBEAM `edge` build used here, `rebar3 device publish`
> crashes on its upload path (see `docs/forge-publish-bug-report.md`). These
> devices were instead published by serializing the signed spec/impl messages to
> ANS-104 and uploading them directly to the Arweave bundler (`up.arweave.net`).
> The IDs below are the resulting data-item IDs.

### Published Device IDs

Published 2026-06-13 (signed by `tfFwf_9YX7EdPyWzWCjmANxhLivWENWmmr8tnJJEJpE`,
built on Erlang/OTP 28, `variant: ao.N.1`):

```
permabrain-consensus@1.0:
  spec: XIsiSYSLaKq99Cnp0vmbsrdZZZyZuNrd1VGU5E7oxQQ
  impl: ffk_7QOgGEk022l8j0aVyIKxDlg1P5mschBKzmaaUPg
permabrain-query@1.0:
  spec: u9tFjQvxJTlF5jLabE1ye9rA5kzbSli-zhycnxBHutM
  impl: kf1DH2m1a0u08XJefNPFMAtPbMqd8GrlCETChhbokrg
```

Each `impl` message references its `spec` via the `implements-device` tag.
Operators need these IDs to trust the devices.

## Step 2: Operator Setup — Running PermaBrain on a HyperBEAM Node

This section is for any HyperBEAM operator who wants to run PermaBrain on their node.

### Option A: Preloaded at Build Time (Recommended for Distributions)

Include `hyperbeam-permabrain` in the node's preloaded store:

```bash
# Clone both repos
git clone https://github.com/permaweb/HyperBEAM.git
git clone https://github.com/twilson63/permabrain.git

# Build with PermaBrain devices included
cd HyperBEAM
HB_DEVICE_SRC=../permabrain/hb-forge/src rebar3 device preload

# Start the node with PermaBrain devices baked in
HB_PORT=8734 HB_MODE=debug rebar3 device local
```

### Option B: Runtime Loading from Arweave

Enable remote device loading in the node config:

```erlang
%% sys.config or HB_CONFIG
[
  {hb, [
    {<<"load-remote-devices">>, true},
    {<<"trusted-device-signers">>, [<<"YOUR_WALLET_ADDRESS">>]},
    {<<"admissible-devices">>, all}
  ]}
].
```

When a request hits `permabrain-consensus@1.0` or `permabrain-query@1.0`, the node fetches the spec + implementation from Arweave automatically.

### Option C: Manual Device Pinning (Most Secure)

Pin specific device implementations directly:

```erlang
%% sys.config or HB_CONFIG
[
  {hb, [
    {<<"trusted-devices">>, #{
      <<"permabrain-consensus@1.0">> => <<"IMPL_ID_FROM_PUBLISH">>,
      <<"permabrain-query@1.0">> => <<"IMPL_ID_FROM_PUBLISH">>
    }}
  ]}
].
```

This is the most secure option — no remote fetching, no trust beyond the pinned IDs.

## Step 3: Initialize PermaBrain References

Once the devices are loaded, initialize the PermaBrain reference structure on the node.

### 3.1 Create a Topic Directory (Reference Set)

A reference set maps topic names to individual article references:

```
POST /~bundler@1.0/tx?codec-device=ans104@1.0

DataItem with tags:
  device: ~reference@1.0
  reference-value: {
    "ai": { "device": "~reference@1.0", "reference-id": "<ai-topic-ref>" },
    "crypto": { "device": "~reference@1.0", "reference-id": "<crypto-topic-ref>" }
  }
```

Response ID becomes the permanent topic directory reference ID.

### 3.2 Create an Article Reference

Each article key gets its own reference pointing to the latest version:

```
POST /~bundler@1.0/tx?codec-device=ans104@1.0

DataItem with tags:
  device: ~reference@1.0
  reference-value: { "current-version": "<article-dataitem-id>" }
```

### 3.3 Update an Article Reference (New Version)

When an article is updated, publish the new version and update the reference:

```
POST /~bundler@1.0/tx?codec-device=ans104@1.0

DataItem with tags:
  device: ~reference@1.0
  reference-id: "<article-reference-id>"
  timestamp: 1718280000000
  reference-value: { "current-version": "<new-article-dataitem-id>" }
```

### 3.4 Resolve an Article by Key

```
GET /<topic-set-ref-id>~reference@1.0/ai/current-version
```

Resolution chains through: topic set → ai reference → current version ID.

## Step 4: Use PermaBrain Consensus & Query Devices

### Compute Consensus

```
GET /<process-id>~process@1.0/consensus
Header: Attestation-Target: <article-id>
```

Response:
```json
{
  "status": "ok",
  "Consensus-Score": "0.85",
  "Consensus-Count": "5",
  "Consensus-Valid-Count": "4",
  "Consensus-Invalid-Count": "1"
}
```

### Query Articles

```
GET /<process-id>~process@1.0/query?Article-Key=subject/karpathy-llm-wiki&return=messages
```

### Resolve References

```
GET /<process-id>~process@1.0/resolve?reference-id=<ref-id>&path=current-version
```

## Step 5: Complete Operator Checklist

- [ ] **1. Build HyperBEAM with PermaBrain devices** (or enable remote loading)
- [ ] **2. Start the node**: `HB_PORT=8734 HB_MODE=debug hb daemon`
- [ ] **3. Verify node health**: `GET http://localhost:8734/~meta@1.0/info`
- [ ] **4. Verify PermaBrain devices loaded**: `GET http://localhost:8734/~meta@1.0/info` should list `permabrain-consensus` and `permabrain-query` in loaded devices
- [ ] **5. Create topic directory reference** (one-time setup)
- [ ] **6. Create article references** (one per article key)
- [ ] **7. Publish articles** via `~bundler@1.0`
- [ ] **8. Update references** when articles are revised
- [ ] **9. Compute consensus** via `permabrain-consensus@1.0`
- [ ] **10. Verify reference resolution** via `~reference@1.0`

## Docker / Daytona Deployment

### Build the Docker Image

```bash
docker buildx build --platform linux/amd64 \
  -t ghcr.io/twilson63/hyperbeam-sandbox:0.10.0 \
  --push .
```

### Daytona Snapshot

1. Create snapshot from `ghcr.io/twilson63/hyperbeam-sandbox:0.10.0`
2. Set entrypoint: none (default `sleep infinity`)
3. Resources: 2 vCPU, 4 GiB RAM, 3 GiB storage

### Start HyperBEAM in Sandbox

```bash
# In the sandbox:
HB_PORT=8734 HB_MODE=debug HB_GATEWAY=https://arweave.net /opt/hyperbeam/hb/bin/hb daemon
```

### Expose via Daytona Preview

The sandbox exposes port 8734. Use `sandbox.getPreviewLink(8734)` for external access (requires auth token).

## TypeScript SDK Integration

For operators who want to use PermaBrain from JavaScript/TypeScript:

```javascript
import { HyperbeamTransport, HyperbeamReference } from 'permabrain';

const transport = new HyperbeamTransport({
  gateway: { dataUrl: 'http://localhost:8734' },
  bundler: { uploadUrl: 'http://localhost:8734/~bundler@1.0/tx?codec-device=ans104@1.0' }
});

// Upload an article
const { id } = await transport.uploadDataItem(articleItem);

// Create a reference (article key → latest version)
const ref = await transport.reference.createArticleReference(
  'subject/karpathy-llm-wiki',
  id,
  identity
);

// Resolve the latest version
const latest = await transport.reference.resolve(ref.referenceId, 'current-version');

// Compute consensus
const consensus = await transport.consensus.compute(articleId);
```

## Troubleshooting

### `~reference@1.0` returns 400
- Make sure you're sending a properly signed init message with `device: ~reference@1.0`
- The `reference-value` field must be a valid message (map/object)

### Device not found on node
- Check `~meta@1.0/info` for loaded devices
- Ensure `load-remote-devices` is `true` or the device is pinned in `trusted-devices`
- For preloaded devices, rebuild with `rebar3 device preload`

### Consensus returns 0 / no attestations
- Attestations must be uploaded via `~bundler@1.0` before consensus can find them
- The match index auto-builds on upload; allow a few seconds for indexing

### `hb start` deprecated
- Use `hb daemon` instead of `hb start`
- For foreground: `hb foreground`
- Kill stale nodes before restarting: `hb stop` or `pkill -f beam`