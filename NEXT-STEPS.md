# PermaBrain Forge Device Package — Build & Verification Status

_Last updated: 2026-06-13 — local toolchain: Erlang/OTP 28 (erts 16.4), rebar3 3.27,
Docker 29, the dev image ships OTP 27._

## Summary

| Step | Status | Notes |
|------|--------|-------|
| 1–4 Scaffold / compile / package | ✅ done | 2 device archives generated |
| 5 Device EUnit tests | ✅ done | 13 tests pass (`rebar3 device test`) |
| 6 Build Docker dev image | ✅ done | `hyperbeam-dev:latest` builds; OTP 27 verified |
| 7 Deploy node with devices loaded | ✅ done | devices resolve over HTTP on a live node |
| 8 Reference@1.0 on live node | ✅ done | bundled `samcamwilliams/reference-1.0` into the build; resolves live |
| 9 Consensus & query devices on live node | ✅ done | consensus computes correct weighted score |
| 10 Publish to Arweave | ✅ done (workaround) | `rebar3 device publish` is broken; published via direct ANS-104 upload to `up.arweave.net` |
| 11 Update operator guide with IDs | ✅ done | published IDs recorded in `docs/hyperbeam-operator-guide.md` |
| 12 End-to-end integration | ✅ done | live E2E: article → reference → attestation → consensus → query (`test/step12-e2e.mjs`) |

## ⚠️ Important: the device implementations were fixed

The original `dev_permabrain_consensus.erl` and `dev_permabrain_query.erl` **did
not work against this HyperBEAM build** — they compiled and packaged (remote
calls aren't checked at compile time) and `info` worked because it's pure, but
every data path crashed with `undef`. They used an API that does not exist here:

- `hb_message:get/3` / `hb_message:set/2` → **do not exist**. Field access is
  `hb_ao:get(Key, Msg, Default, Opts)`; results are returned as `{ok, Map}`.
- `hb_cache:get/3` for cross-device lookups → wrong. Matching the reverse index
  is `hb_cache:match(Spec, Opts)` → `{ok, Matches} | {error, not_found}`.
- Device key functions are **arity 3** `Fun(Base, Req, Opts)` (the resolver
  truncates `[Base, Req, Opts]` to the function's arity — an arity-2 function
  silently receives `(Base, Req)`, *not* `(Base, Opts)`).
- Request/header keys arrive **lowercased** (`<<"attestation-target">>`).

Both devices were rewritten accordingly. They still mirror the
`PERMABRAIN_CONSENSUS_LUA` contract (binary `Attestation-Valid` weighted by
`Attestation-Confidence`, matched on `Attestation-Target`). All cross-device
calls are wrapped in `try/catch` because the upstream `~match@1.0` device
**raises** `{badmatch,error}` when a key is absent from the index instead of
returning an error tuple.

### Verified consensus result (step 9)

Uploaded 1 article + 3 attestations (`valid`/0.9, `valid`/0.7, `invalid`/0.4)
and called `GET /~permabrain-consensus@1.0/consensus`:

```
Consensus-Count: 3  Valid: 2  Invalid: 1  Score: 0.400000  Status: computed
```

Math: (0.9 + 0.7) − 0.4 = 1.2 net ÷ 3 = **0.4**. ✅

Reproduce with the saved test (requires a node with the devices preloaded):

```bash
HB_URL=http://localhost:18734 PERMABRAIN_REQUIRE_HYPERBEAM=1 node test/step9-devices.mjs
```

## How to build & run locally

### Device EUnit tests (step 5)

```bash
cd hb-forge
rebar3 device test          # add HB_PORT=18734 if 8734 is already in use
```

> The test harness boots a HyperBEAM node on `HB_PORT` (default 8734). If that
> port is taken you'll get `eaddrinuse`; set `HB_PORT` to a free port.

### Docker dev image (step 6)

```bash
# Local build (no registry auth needed):
docker build -t hyperbeam-dev:latest -f hb-forge/Dockerfile hb-forge
docker run --rm hyperbeam-dev:latest erl -version   # -> erts 15.x == OTP 27

# Push to GHCR (needs `docker login ghcr.io`) — handled by CI:
#   .github/workflows/build-dev-image.yml
```

### Run a node with the devices preloaded (step 7)

```bash
cd hb-forge
# `device local` launches an interactive Erlang shell; keep stdin open when
# running detached so the shell doesn't get EOF and exit:
tail -f /dev/null | HB_PORT=18734 HB_MODE=debug rebar3 device local
```

Verify the devices resolve:

```bash
curl -s -H 'Accept: application/json' http://localhost:18734/~permabrain-consensus@1.0/info
curl -s -H 'Accept: application/json' http://localhost:18734/~permabrain-query@1.0/info
# Each returns {"device": "...", "version": "1.0.0", "status": "ok", ...}
```

## Current device package archives (after the fix)

```
_hb_device_permabrain_consensus_1_0_euthqivq7voskvrum2g6lnllgt5nsyy7yn5jhnp24wakfwouckya.beam-archive.zip
_hb_device_permabrain_query_1_0_jeprcaddxgictfqov5jajyk5fqvjq2d6soommple2cirjh4bnq4q.beam-archive.zip
```

Regenerate with `cd hb-forge && rebar3 device package` (the hash changes with the
source, so these names will move if the devices change again).

## Remaining work

### Step 8 / 12 — `reference@1.0` bundled; live E2E ✅

`reference@1.0` (`github.com/samcamwilliams/reference-1.0`) is not in HyperBEAM
`edge`, so it was **bundled into this Forge build**: its `dev_reference.erl`
sits in `hb-forge/src/` (gitignored — external code, not ours to commit) and is
packaged + preloaded alongside the PermaBrain devices. `rebar3 device test` runs
its full suite — **20 reference tests pass**, including two HTTP E2E tests and an
N=1000 reference-set test — for 33 passing tests total across all three devices.

Live E2E (`test/step12-e2e.mjs`, against the 3-device node): article → reference
→ 3 attestations → consensus (`count=3`, `computed`) → query, all pass. Step 8 is
`GET /{refId}~reference@1.0/compute` returning the reference's `current-version`.

Two integration gotchas on this dev node (not device defects):
- **Store the reference init as a plain message** (no `device: reference@1.0`
  tag) and let the path apply the device at resolve time. A reference-tagged
  message fails bundler ingestion here and never lands in the store.
- **Resolve via the `/compute` sub-path**, not the bare key path. The bare-key
  default resolver does a freshness check that reaches for the gateway and times
  out; `/compute` resolves from local cache. (`only-if-cached` is too strict —
  it 504s with "Computed result not available in cache" instead of computing.)
- Per the reference SPEC, a node serving mutable references must set
  `cache-control: no-store/no-cache` (or a finite `reference-max-age`) so reads
  aren't pinned to the first value.

Also note: this dev node (`mode: debug`) forwards bundler uploads to Arweave L1
chain nodes, which reject ANS-104 data items (`400 verification failed`) and
retry — so an upload's HTTP response can reset *after* the item is already in the
local store. Uploads are treated as soft-success on a socket reset.

### Step 10 / 11 — published via workaround ✅

`rebar3 device publish` is broken on this build (cascade below), so the devices
were published by a **route #2 workaround**: serialize the signed spec/impl
messages to ANS-104 and upload the bytes directly to the Arweave bundler.

**Published 2026-06-13** (Turbo `up.arweave.net` returned signed `status: 200`
receipts for all four; gateway/GraphQL indexing lags by minutes–hours):

```
permabrain-consensus@1.0:  spec XIsiSYSLaKq99Cnp0vmbsrdZZZyZuNrd1VGU5E7oxQQ
                           impl ffk_7QOgGEk022l8j0aVyIKxDlg1P5mschBKzmaaUPg
permabrain-query@1.0:      spec u9tFjQvxJTlF5jLabE1ye9rA5kzbSli-zhycnxBHutM
                           impl kf1DH2m1a0u08XJefNPFMAtPbMqd8GrlCETChhbokrg
```

How it was done (reproducible):
1. Patched `hb_forge_publish:do_run/1` (local, under `_build/`) to set
   `linkify_mode => false` and, instead of `hb_client_remote:upload/3`,
   `ar_bundles:serialize(hb_message:convert(Signed, <<"ans104@1.0">>, Opts))`
   each signed spec/impl to `_build/device-publish-out/*.ans104`.
2. Validated each file parses as ANS-104, the data-item ID equals
   `hb_message:id/3`, and each impl's `implements-device` tag points at its spec.
3. `POST`ed the raw bytes to `https://up.arweave.net/tx`
   (`Content-Type: application/octet-stream`). The local dev node's
   `~bundler@1.0` does **not** work for this — in `mode: debug` it stores items
   locally and does not forward to `up.arweave.net` (verified: the IDs resolve
   on the node but 404 on the gateway). Upload must go to Turbo directly.

The full forge-publish bug is written up in `docs/forge-publish-bug-report.md`.
The original cascade we hit, for reference:

`rebar3 device publish --key hyperbeam-key.json` was authorized and run, but it
**crashes before any upload** (verified: zero transactions exist for the wallet
`tfFwf_9YX7EdPyWzWCjmANxhLivWENWmmr8tnJJEJpE` on the gateway — nothing was sent):

```
{error,{device_not_loadable,<<"arweave@2.9">>,
        {forge_bootstrap_device_not_found,<<"arweave@2.9">>}}}
```

**Root cause (multiple upstream defects in the vendored Forge/HyperBEAM build).**
The publish upload path needs devices the bootstrap never seeds, and then hits a
codec defect. Reproduced by progressively seeding the missing devices in
`hb_forge_seed:seed_names/1` (a local patch under `_build/`, see below):

1. `hb_client_remote:upload/3` routes every non-`httpsig@1.0` codec through
   `hb_ao:raw(<<"arweave@2.9">>, <<"tx">>, ...)` → needs **`arweave@2.9`**, not
   seeded. (`dev_arweave` has no `commit/3`, so it can't be the publish codec
   either.)
2. After seeding `arweave@2.9`: `hb_http:prepare_request/6` calls the cookie
   device → needs **`cookie@1.0`**, not seeded.
3. After seeding both: the ANS-104 encoder crashes with **`function_clause` in
   `dev_structured:decode_ao_types`**, which is handed a raw `{tx, ans104, ...}`
   record it has no clause for. This is a code defect, not a missing device —
   the point at which local seed-patching stops being safe.

**Status of the local patch:** `_build/.../hb/src/forge/hb_forge_seed.erl` was
edited to add `arweave@2.9` and `cookie@1.0` to the seed (and recompiled). This
lives under the gitignored `_build/` tree and will vanish on a clean rebuild.
It is **not sufficient** — the `decode_ao_types` defect remains.

**To actually unblock, one of:**
1. Use a Forge/HyperBEAM version where `rebar3 device publish` is fixed (the
   upstream fix must seed `arweave@2.9`/`cookie@1.0` *and* fix the
   `dev_structured:decode_ao_types` clause for `{tx, ans104, ...}` records).
2. Publish the signed spec/impl messages through a running HyperBEAM node's
   `~bundler@1.0` instead of the in-process Forge upload path.
3. Set up an `httpsig@1.0` bundler (`bundler-httpsig` opt) and publish with
   `--publish-codec httpsig@1.0` — but `up.arweave.net` expects ANS-104, so this
   needs a HyperBEAM-native httpsig bundler endpoint.

**Verified:** no transactions exist for the wallet on the gateway — every
attempt crashed during request *preparation/encoding*, before any network POST.
After a real publish, paste the returned spec/impl IDs into
`docs/hyperbeam-operator-guide.md` under a "Published Device IDs" heading (step 11).

## Known issues / notes

- **Attestation tag mismatch (design):** the Lua/Erlang consensus device matches
  on `Attestation-Target` / `Attestation-Valid` (binary valid|invalid), but the
  JS SDK's `buildAttestationTags` (`src/tags.mjs`) emits `Attestation-Target-Id`
  / `Attestation-Opinion` with a 5-value weighted model (see `src/consensus.mjs`:
  `valid=1, partially-valid=0.5, invalid=-1, disputed=-0.75, outdated=-0.5`).
  Attestations produced by the SDK will **not** be scored by the device as-is.
  Decide on one canonical tag schema and align the Lua script, the Erlang
  device, and the SDK before production use.
- **`~match@1.0/Key=Value` path 500s:** the raw match path form raises upstream
  when the key isn't already on the message. Use `hb_cache:match(Spec, Opts)`
  from inside a device instead (the devices now do).
- **`rebar3 device verify` does not exist** in this plugin version; valid
  subcommands are `package`, `test`, `local`, `publish`.

## Key files

| File | Purpose |
|------|---------|
| `hb-forge/src/dev_permabrain_consensus.erl` | Consensus device (fixed + EUnit tests) |
| `hb-forge/src/dev_permabrain_query.erl` | Query + reference device (fixed + EUnit tests) |
| `hb-forge/Dockerfile` | Dev environment (Erlang OTP 27 / Rust / rebar3 / Forge) |
| `hb-forge/rebar.config` | Forge build config |
| `test/step9-devices.mjs` | Live-node integration test for the devices |
| `.github/workflows/build-dev-image.yml` | CI workflow for the Docker image |
| `docs/hyperbeam-operator-guide.md` | Operator setup guide |
