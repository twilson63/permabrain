# hyperbeam-permabrain

PermaBrain consensus and query devices as a HyperBEAM Forge package.

## Quick Start

### Build with Docker (recommended)

```bash
# Build the dev image from the repo root
docker build -t ghcr.io/twilson63/hyperbeam-dev:latest -f hb-forge/Dockerfile .

# Package devices
docker run --rm -v $(pwd)/hb-forge:/work ghcr.io/twilson63/hyperbeam-dev:latest \
  sh -c "cd /work && rebar3 device package"

# Verify packages
docker run --rm -v $(pwd)/hb-forge:/work ghcr.io/twilson63/hyperbeam-dev:latest \
  sh -c "cd /work && rebar3 device verify"

# Run tests
docker run --rm -v $(pwd)/hb-forge:/work ghcr.io/twilson63/hyperbeam-dev:latest \
  sh -c "cd /work && rebar3 device test"

# Start local node with devices loaded
docker run --rm -it -p 8734:8734 -v $(pwd)/hb-forge:/work ghcr.io/twilson63/hyperbeam-dev:latest \
  sh -c "cd /work && rebar3 device local"
```

### Build natively (requires Erlang/OTP 27+, rebar3, Rust)

```bash
# Install Forge template
git clone --depth 1 --branch edge https://github.com/permaweb/HyperBEAM.git
cd HyperBEAM && ./install-template --branch edge && cd ..

# Package the hb-forge project
cd hb-forge
rebar3 device package
rebar3 device verify
rebar3 device test
rebar3 device local
```

### Publish to Arweave

```bash
cd hb-forge
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
- `query/2` — Search articles by key, kind, or topic
- `attestations/2` — Find attestations for a target article
- `resolve/2` — Resolve a PermaBrain reference to its current value
- `info/1` — Return device metadata

**Usage:**
```
GET /{ProcessId}~process@1.0/query?Article-Key=subject/foo&return=messages
GET /{ProcessId}~process@1.0/attestations?Attestation-Target={id}
GET /{ProcessId}~process@1.0/resolve?reference-id={refId}&path=current-version
```

## Operator Setup

See [docs/hyperbeam-operator-guide.md](../docs/hyperbeam-operator-guide.md) for full deployment instructions.