# Phase 1 Build/Test Validation Plan

Goal: build and test all PermaBrain Phase 1 code needed to satisfy the README CLI goals against a local HyperBEAM node at `http://localhost:10000`.

Target README workflow:

```sh
permabrain init
permabrain put people/alice.md
permabrain query --topic people
permabrain get people/alice
permabrain sync
```

## Global Acceptance Criteria

Phase 1 is complete when all of these pass:

- `npm test` passes locally.
- `npm run test:hyperbeam` passes with HyperBEAM running at `localhost:10000`.
- The `permabrain` CLI can initialize local state, upload a markdown page, query it by tags, fetch it, update it, and sync a latest-version cache.
- Uploaded items use the required `Brain-*` tag schema from `docs/tag-schema.md`.
- HyperBEAM-backed operations are isolated behind a transport adapter so public Arweave/Turbo/Irys fallback can be added later.
- No private key material or local cache artifacts are committed.

## Step 1 — Project Scaffold and CLI Entrypoint

### Build Work

- Create `scripts/cli.mjs` declared by `package.json#bin.permabrain`.
- Create `src/` modules matching `docs/architecture.md`:
  - `config.mjs`
  - `keys.mjs`
  - `tags.mjs`
  - `dataitem.mjs`
  - `hyperbeam.mjs`
  - `cache.mjs`
  - `commands/*.mjs`
- Add `.permabrain/` to `.gitignore`.
- Add package scripts:
  - `test`
  - `test:unit`
  - `test:hyperbeam`
  - optional `lint` if a linter is added.

### Validation Criteria

- `node scripts/cli.mjs --help` exits 0 and lists all MVP commands.
- `npm test` exits 0.
- `npm link` or `node scripts/cli.mjs` can invoke the CLI without module resolution errors.
- Missing/invalid command returns non-zero with a useful error.

## Step 2 — Config and Local State

### Build Work

- Implement `.permabrain/config.json` creation and loading.
- Store local defaults for HyperBEAM endpoints:

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

- Support env overrides for test runs:
  - `PERMABRAIN_GRAPHQL_URL`
  - `PERMABRAIN_DATA_URL`
  - `PERMABRAIN_UPLOAD_URL`
  - `PERMABRAIN_HOME`

### Validation Criteria

- `permabrain init` creates `.permabrain/config.json` and required directories.
- Running `permabrain init` twice is idempotent.
- Invalid JSON config produces a clear error.
- Tests can use a temporary `PERMABRAIN_HOME` without touching real local state.

## Step 3 — Key/Wallet Handling

### Build Work

- Generate or import a local signing wallet/key.
- Store private key material in `.permabrain/keys.json` with restrictive permissions where supported.
- Expose a stable owner/address identifier for tags.

### Validation Criteria

- `permabrain init` creates usable signing material if none exists.
- Existing keys are reused, not overwritten.
- `keys.json` is not world-readable on POSIX systems.
- Unit tests verify deterministic owner/address extraction from a fixture key.

## Step 4 — Tag Schema

### Build Work

- Implement tag creation, decoding, and validation in `src/tags.mjs`.
- Required tags must match `docs/tag-schema.md`.
- Derive:
  - `Brain-Key = <topic>/<slug>`
  - `Brain-Content-Hash = sha256:<hex>`
  - `Brain-Version`
  - `Brain-Previous-Id` when updating.

### Validation Criteria

- Unit tests cover required tags for markdown and JSON pages.
- Invalid topic/slug/title/version inputs fail validation.
- Query helpers generate expected GraphQL tag filters for:
  - `App-Name`
  - `Brain-Id`
  - `Brain-Topic`
  - `Brain-Key`
- Content hash matches the uploaded payload bytes.

## Step 5 — DataItem Creation and Signing

### Build Work

- Implement ANS-104-compatible DataItem creation/signing or integrate a suitable library.
- Return:
  - data item ID
  - raw bytes suitable for upload
  - tag list
  - owner/signature metadata.

### Validation Criteria

- Unit tests can create a signed DataItem from fixture content.
- Signature verification passes using the generated key.
- DataItem ID is stable for the signed payload.
- Tags survive encode/decode roundtrip.

## Step 6 — HyperBEAM Endpoint Discovery

### Build Work

- Add `test/hyperbeam-probe.mjs` or equivalent probe utility.
- Probe local HyperBEAM at `localhost:10000` for:
  - health/root endpoint
  - GraphQL endpoint
  - upload/DataItem endpoint
  - fetch-by-ID endpoint
- Document confirmed routes in `docs/hyperbeam-local-test.md`.

### Validation Criteria

- With HyperBEAM running, probe reports all required routes or actionable missing-route errors.
- With HyperBEAM stopped, probe fails fast with a clear message.
- Confirmed endpoint behavior is captured in docs before wiring E2E tests.

## Step 7 — HyperBEAM Transport Adapter

### Build Work

- Implement `src/hyperbeam.mjs` with:
  - `uploadDataItem(bytes, tags)`
  - `fetchData(id)`
  - `queryTransactions(filters)`
- Keep HTTP details isolated from command code.
- Handle indexing delay/retry if HyperBEAM GraphQL is eventually consistent.

### Validation Criteria

- Adapter unit tests can run against a mocked HTTP server.
- `npm run test:hyperbeam` can upload a minimal signed DataItem.
- Uploaded data can be fetched back byte-for-byte.
- Uploaded tags can be queried through the local GraphQL route.

## Step 8 — `permabrain put`

### Build Work

- Read a local file.
- Infer topic/slug from path if flags are omitted.
- Build tags and signed DataItem.
- Query for previous versions of the same `Brain-Key`.
- Upload through HyperBEAM adapter.
- Record local cache metadata.

### Validation Criteria

- `permabrain put people/alice.md` uploads a markdown page.
- Output includes the data item ID, key, topic, slug, and version.
- First upload has `Brain-Version: 1`.
- Second upload of the same key increments `Brain-Version` and sets `Brain-Previous-Id`.
- Missing file and unsupported file type errors are clear.

## Step 9 — `permabrain query`

### Build Work

- Query by topic, slug/key, or all pages for the current brain.
- Resolve latest version per `Brain-Key`.
- Support human-readable output and `--json`.

### Validation Criteria

- `permabrain query --topic people` returns `people/alice` after upload.
- `permabrain query --json` emits parseable JSON.
- Version chain is collapsed to latest by default.
- Optional verbose/history mode can show older versions if implemented.

## Step 10 — `permabrain get`

### Build Work

- Resolve `topic/slug` to the latest matching DataItem.
- Fetch content by ID.
- Print or write content.
- Handle encrypted content later without breaking plaintext MVP behavior.

### Validation Criteria

- `permabrain get people/alice` prints the uploaded markdown.
- Fetch by explicit ID works if supported.
- Unknown key exits non-zero with a useful message.
- Returned content hash matches `Brain-Content-Hash`.

## Step 11 — `permabrain sync`

### Build Work

- Query all current brain pages.
- Build `.permabrain/cache/index.json` with latest version per key.
- Optionally cache page content under `.permabrain/cache/pages/`.

### Validation Criteria

- `permabrain sync` creates a latest-version index.
- Re-running sync is idempotent.
- Updated pages replace old latest entries but preserve version metadata.
- `permabrain query` and `permabrain get` can use cache when appropriate.

## Step 12 — End-to-End HyperBEAM Test

### Build Work

- Add `test/hyperbeam-local.mjs` and `npm run test:hyperbeam`.
- Test against a temporary `PERMABRAIN_HOME`.
- Generate a fixture markdown page during the test.

### Validation Sequence

1. Check HyperBEAM is reachable at `http://localhost:10000`.
2. Run `permabrain init`.
3. Create `people/alice.md` fixture.
4. Run `permabrain put people/alice.md`.
5. Run `permabrain query --topic people --json`.
6. Assert result includes `Brain-Key: people/alice`.
7. Run `permabrain get people/alice`.
8. Assert fetched content equals fixture content.
9. Modify fixture and run `put` again.
10. Assert version increments and previous ID is linked.
11. Run `permabrain sync`.
12. Assert cache index points to latest version.

### Validation Criteria

- Full test exits 0.
- Test output includes data item IDs and endpoint URLs used.
- Failures identify whether the problem is init, upload, GraphQL query, fetch, versioning, or sync.

## Step 13 — pi Skill Wrapper

### Build Work

- Update `skills/permabrain/SKILL.md` to use the CLI workflow.
- Document required local HyperBEAM assumption.
- Add examples for put/query/get/sync.

### Validation Criteria

- Skill instructions match actual CLI flags and outputs.
- A pi agent can follow the skill to store and retrieve a memory page.
- Skill does not expose private key material.

## Step 14 — Optional Encryption MVP

This is after plaintext README goals unless required earlier.

### Build Work

- Add symmetric local encryption before upload.
- Tag encrypted pages with `Brain-Encrypted: true`.
- Keep plaintext mode as default or explicit depending on product decision.

### Validation Criteria

- Encrypted content is not readable through raw fetch.
- Authorized local key can decrypt through `permabrain get`.
- Content hash semantics are documented: plaintext hash, ciphertext hash, or both.

## Recommended Development Order

1. Scaffold CLI and tests.
2. Config/init.
3. Tags.
4. Keys/signing/DataItem.
5. HyperBEAM probe.
6. HyperBEAM adapter.
7. Put/query/get.
8. Sync.
9. E2E test automation.
10. pi skill polish.

## Definition of Done

Run these successfully from a clean checkout:

```sh
npm install
npm test
HB_PORT=10000 rebar3 shell # from ~/code/hyperbeam, separate terminal
npm run test:hyperbeam
```

Then manually verify:

```sh
permabrain init
printf '# Alice\n\nResearch notes.\n' > people/alice.md
permabrain put people/alice.md
permabrain query --topic people
permabrain get people/alice
permabrain sync
```

If every command succeeds and the fetched content matches the uploaded content, Phase 1 README goals are met.
