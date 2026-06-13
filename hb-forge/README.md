# hyperbeam-permabrain

PermaBrain consensus and query devices as a HyperBEAM Forge package.

## Quick Start

### Build with Docker (recommended)

```bash
# Build the dev image
cd permabrain/hb-forge
docker build -t ghcr.io/twilson63/hyperbeam-dev:latest .

# Package devices
docker run --rm -v $(pwd):/work ghcr.io/twilson63/hyperbeam-dev:latest \
  sh -c "cd /work && rebar3 device package"

# Verify packages
docker run --rm -v $(pwd):/work ghcr.io/twilson63/hyperbeam-dev:latest \
  sh -c "cd /work && rebar3 device verify"

# Run tests
docker run --rm -v $(pwd):/work ghcr.io/twilson63/hyperbeam-dev:latest \
  sh -c "cd /work && rebar3 device test"

# Start local node with devices loaded
docker run --rm -it -p 8734:8734 -v $(pwd):/work ghcr.io/twilson63/hyperbeam-dev:latest \
  sh -c "cd /work && rebar3 device local"
```

### Build natively (requires Erlang/OTP 27+, rebar3, Rust)

```bash
# Install Forge template
git clone --depth 1 --branch edge https://github.com/permaweb/HyperBEAM.git
cd HyperBEAM && ./install-template --branch edge && cd ..

# Create project (if starting fresh)
rebar3 new device name=permabrain_consensus

# Package
rebar3 device package

# Verify
rebar3 device verify

# Test
rebar3 device test

# Local node
rebar3 device local
```

### Publish to Arweave

```bash
rebar3 device publish --key wallet.json
```

## Devices

### permabrain-consensus@1.0

Computes weighted consensus scores for articles by resolving attestations via `~match@1.0`.

**Functions:**
- `consensus/3` — Compute consensus for an article (Attestation-Target header)
- `info/0` — Return device metadata

**Usage:**
```
GET /{ProcessId}~process@1.0/consensus
Header: Attestation-Target: {articleId}
```

### permabrain-query@1.0

Structured PermaBrain queries with `~reference@1.0` resolution support.

**Functions:**
- `query/3` — Search articles by key, kind, or topic
- `attestations/3` — Find attestations for a target article
- `resolve/3` — Resolve a PermaBrain reference to its current value
- `info/0` — Return device metadata

**Usage:**
```
GET /{ProcessId}~process@1.0/query?Article-Key=subject/foo&return=messages
GET /{ProcessId}~process@1.0/attestations?Attestation-Target={id}
GET /{ProcessId}~process@1.0/resolve?reference-id={refId}&path=current-version
```

## Operator Setup

See [docs/hyperbeam-operator-guide.md](../docs/hyperbeam-operator-guide.md) for full deployment instructions.