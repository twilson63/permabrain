# Local HyperBEAM Test Plan

This project will use a local HyperBEAM node as the first end-to-end test surface for PermaBrain Phase 1.

## Assumptions

- HyperBEAM repo exists at `~/code/hyperbeam`.
- HyperBEAM can run locally with `rebar3 shell`.
- HyperBEAM can expose gateway / GraphQL / bundler-compatible endpoints, or equivalent AO-Core message endpoints that can accept signed DataItems.

## Initial HyperBEAM Startup

From `~/code/hyperbeam`:

```sh
HB_PORT=10000 rebar3 shell
```

Optional isolated store:

```sh
HB_STORE=permabrain-local HB_PORT=10000 rebar3 shell
```

## Endpoints to Discover / Verify

We need to verify exact routes exposed by the local node:

- GraphQL endpoint
- Data fetch endpoint by transaction/data item ID
- Upload/bundler endpoint for ANS-104 DataItems
- Any required headers or AO message format

Candidate defaults for config until verified:

```json
{
  "gateway": {
    "type": "hyperbeam",
    "graphqlUrl": "http://localhost:10000/graphql",
    "dataUrl": "http://localhost:10000"
  },
  "bundler": {
    "type": "hyperbeam",
    "uploadUrl": "http://localhost:10000"
  }
}
```

## Test Sequence

1. Health check local HyperBEAM.
2. Upload a minimal signed DataItem.
3. Fetch uploaded data by ID.
4. Query uploaded tags via GraphQL.
5. Upload a PermaBrain page.
6. Query by `App-Name`, `Brain-Id`, and `Brain-Key`.
7. Fetch and render page.
8. Upload a second version and verify `Brain-Previous-Id`.

## Probe Result — 2026-05-30

Local probe against `http://localhost:10000` now returns:

```text
health: 200
/graphql: 200
fetch missing id: 404
upload OPTIONS /~bundler@1.0/tx?codec-device=ans104@1.0: 204
```

The working local upload route is:

```text
POST http://localhost:10000/~bundler@1.0/tx?codec-device=ans104@1.0
```

Uploads must be serialized ANS-104 bytes. Fetch-by-ID works at `/<id>` for uploaded content. Local GraphQL is reachable, but freshly uploaded local items may not be returned by tag queries immediately/consistently, so the CLI maintains a local cache fallback for recently published articles and attestations.

## Open Questions

- Are uploaded local items expected to become queryable by `/graphql` tag filters, or is a custom indexer/cache needed?
- Is there a local finality/indexing delay for the HyperBEAM GraphQL surface?
- Which HyperBEAM device/module owns durable tag indexing for this use case?

Current CLI functionality is validated with local test transport and local HyperBEAM upload/fetch. The CLI uses cache fallback where local GraphQL does not return freshly uploaded items.

## Public Arweave Fallback Tests

In addition to local HyperBEAM, the project includes explicitly gated public-network tests:

```sh
npm run test:arweave          # read-only arweave.net GraphQL/gateway probe
npm run test:public-upload    # skips unless public upload is explicitly enabled
```

Public upload is disabled by default. To intentionally test permanent public publishing:

```sh
PERMABRAIN_ENABLE_PUBLIC_UPLOAD=1 npm run test:public-upload
```

The default upload endpoint is `https://up.arweave.net` and can be overridden with `PERMABRAIN_PUBLIC_UPLOAD_URL`.

### Public Upload Probe Results — 2026-05-30

Initial JSON-envelope command:

```sh
PERMABRAIN_ENABLE_PUBLIC_UPLOAD=1 npm run test:public-upload
```

Result: `https://up.arweave.net` was reachable but rejected the old PermaBrain JSON DataItem envelope with HTTP 500:

```text
{badmatch,{unsupported_tx_format,<<"{">>}}
```

Interpretation: `up.arweave.net` expects an Arweave/ANS-104 serialized transaction or DataItem binary, not a JSON envelope.

After implementing ANS-104 serialization/signing, the same command posted `application/octet-stream` ANS-104 bytes and was accepted with status 200:

```text
Public upload request accepted for local item id ZBoj5fpPa9yezR4GS99HgHlKjqCEEvpdOQySkrqjmKc
```

This confirms the project should use real serialized ANS-104 DataItems for all bundler-compatible upload paths, including HyperBEAM and `up.arweave.net`.
