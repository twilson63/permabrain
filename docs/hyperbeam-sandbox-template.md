# HyperBEAM Sandbox Template

Quick-start for spinning up a HyperBEAM node in a Daytona sandbox and testing PermaBrain's device stack.

## Prerequisites

- Daytona API key in gateway env (`DAYTONA_API_KEY`)
- PermaBrain repo at `/home/node/.openclaw/workspace/permabrain/`
- Node.js 20+ available

## 1. Create Sandbox

```typescript
import { Daytona } from '@daytona/sdk'

const daytona = new Daytona()
const sandbox = await daytona.create({
  language: 'typescript',
  // 2 vCPU, 4GB RAM minimum for Erlang build
})
const sandboxId = sandbox.id
const previewUrl = sandbox.getPreviewUrl(10000)
```

## 2. Install Build Dependencies

```bash
# Erlang/OTP 27 (from Erlang Solutions or source)
wget https://github.com/erlang/otp/releases/download/OTP-27.3.4/otp_src_27.3.4.tar.gz
tar xzf otp_src_27.3.4.tar.gz
cd otp_src_27.3.4
./configure --without-javac --without-wx --without-odbc
make -j$(nproc)
make install

# rebar3
wget https://github.com/erlang/rebar3/releases/download/3.24.0/rebar3
chmod +x rebar3
mv rebar3 /usr/local/bin/

# Node.js 20+ (if not present)
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs
```

## 3. Build HyperBEAM

```bash
git clone https://github.com/permaweb/HyperBEAM.git
cd HyperBEAM

# Create fake WAMR stub (WASM compute disabled without it)
mkdir -p _build/wamr/lib
touch _build/wamr/lib/libvmlib.a

# Build with C NIF fix
CFLAGS="-Wno-error=incompatible-pointer-types" rebar3 compile
```

## 4. Start HyperBEAM

```bash
# Start in debug mode with isolated store
HB_PORT=10000 HB_STORE=permabrain-test rebar3 shell
```

Wait for the node to start (watch for `HyperBEAM started on port 10000`).

## 5. Verify Node is Running

```bash
curl http://localhost:10000/~meta@1.0/info
```

Should return JSON with node info.

## 6. Test PermaBrain Device Stack

From the PermaBrain repo:

```bash
cd /home/node/.openclaw/workspace/permabrain/

export PERMABRAIN_TRANSPORT=hyperbeam
export PERMABRAIN_HYPERBEAM_URL=http://localhost:10000

# Probe all devices
node scripts/cli.mjs probe-devices --url http://localhost:10000

# Publish a test article
echo '# Test Article\nThis is a test.' > /tmp/test.md
node scripts/cli.mjs publish /tmp/test.md \
  --kind subject --topic test --key subject/hyperbeam-test \
  --title "HyperBEAM Device Test" \
  --source-url "https://example.com/test"

# Query by tags
node scripts/cli.mjs query --topic test

# Get article by key
node scripts/cli.mjs get subject/hyperbeam-test

# Attest
node scripts/cli.mjs attest subject/hyperbeam-test --valid --confidence 0.9

# Match (reverse index lookup)
node scripts/cli.mjs match --key App-Name --value PermaBrain

# Node metadata
node scripts/cli.mjs meta-info --url http://localhost:10000
```

## 7. Test Individual Devices (curl)

```bash
# Bundler: upload a raw DataItem
curl -X POST http://localhost:10000/~bundler@1.0/tx \
  -H "content-type: application/octet-stream" \
  --data-binary @test-item.bin

# Fetch by ID (HTTP-SIG formatter)
curl -v http://localhost:10000/{id}

# Query device
curl "http://localhost:10000/~query@1.0?App-Name=PermaBrain&return=messages"

# Match device
curl "http://localhost:10000/~match@1.0/App-Name=PermaBrain"

# Meta info
curl http://localhost:10000/~meta@1.0/info

# Whois
curl "http://localhost:10000/~whois@1.0/{address}"
```

## 8. Cleanup

```typescript
await sandbox.delete()
```

## Key Findings from Previous Builds

- **ARM64**: HyperBEAM builds on ARM64 Linux (aarch64) with the CFLAGS fix
- **WAMR**: WASM compute requires a real WAMR runtime; the stub disables it but bundler/query/match all work
- **Process computation**: `~process@1.0/now` returns 500 without WASM runtime — Lua device may also need WASM for full compute
- **HTTP-SIG**: HyperBEAM returns data items via `httpsig@1.0` formatter (tags as response headers, not ANS-104 binary)
- **GraphQL**: Available at `/graphql` but may lag behind the match index for recent items
- **Match index**: Auto-built on upload; no separate indexing step needed
- **Erlang OTP 27+ required**: OTP 26 won't work
- **rebar3 3.24.0+ required**: Older versions may fail

## Device Status (as of 2026-06-09)

| Device | Status | Notes |
|--------|--------|-------|
| `~bundler@1.0` | ✅ Working | Upload + auto-index |
| `GET /{id}` | ✅ Working | HTTP-SIG formatter returns tags as headers |
| `~query@1.0` | ⏳ Needs testing | Tag-based search via match index |
| `~match@1.0` | ⏳ Needs testing | Reverse-index lookups |
| `lua@5.3a` | ⏳ Needs testing | On-node Lua compute |
| `~push@1.0` | ✅ Working | Message routing |
| `~meta@1.0` | ✅ Working | Node metadata |
| `~process@1.0` | ❌ Returns 500 | Needs WASM runtime |
| `~whois@1.0` | ⏳ Needs testing | Agent identity |