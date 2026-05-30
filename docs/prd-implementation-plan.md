# PRD Implementation Plan — Public Third Brain

Source of truth: `docs/prd-public-third-brain.md`

## Step 1 — Scaffold CLI/package/scripts/local state docs

Success criteria:

- `scripts/cli.mjs` exists and is executable by Node.
- `package.json` exposes `permabrain` and scripts: `test`, `test:unit`, `test:hyperbeam`, `test:wikipedia`.
- `.gitignore` excludes `.permabrain/` and generated local artifacts.
- `permabrain --help` lists all PRD commands.
- Unknown commands exit non-zero with actionable help.

Status: complete

Evaluation:

- `node scripts/cli.mjs --help` passed.
- `node scripts/cli.mjs nope` exited non-zero with help.
- `npm test` passed.

## Step 2 — Config + identity/key handling

Success criteria:

- `permabrain init` creates `config.json`, `keys.json`, `cache/pages/`, and `logs/` under `.permabrain/` or `PERMABRAIN_HOME`.
- Running `init` twice is idempotent and does not overwrite existing keys.
- `keys.json` content is never printed by CLI commands.
- Tests can run against a temporary `PERMABRAIN_HOME`.

Status: complete

Evaluation:

- `PERMABRAIN_HOME=$(mktemp -d) node scripts/cli.mjs init --json` created required state.
- Re-running `init` in unit tests preserved keys.
- CLI output exposes `agentId`, not private key material.
- `npm test` passed.

## Step 3 — Tag schema + validation + helpers

Success criteria:

- Article tags include all PRD-required fields.
- Attestation tags include all PRD-required fields.
- Invalid article kind, attestation opinion, confidence, or key fails validation.
- Slug/key derivation and content hash helpers are tested.

Status: complete

Evaluation:

- `src/tags.mjs` implements PRD article/attestation tag builders and validators.
- Unit tests cover required tags, invalid values, slug/key derivation, and content hashing.
- `npm test` passed.

## Step 4 — Signed DataItem + transport abstraction

Success criteria:

- Signed DataItems include id, payload, tags, signature, owner/agent id, and timestamp.
- Signature verification passes in tests.
- Local test transport can upload/query/fetch DataItems.
- HyperBEAM probe/test skips cleanly if unavailable unless `PERMABRAIN_REQUIRE_HYPERBEAM=1`.

Status: superseded by Step 9 ANS-104 requirement

Evaluation:

- `src/dataitem.mjs` currently creates signed development JSON envelopes with id, payload, tags, owner, signature, public key, and timestamp.
- Unit tests verify signatures and local upload/query/fetch behavior.
- `npm test` passed.
- Public upload to `up.arweave.net` rejected JSON envelopes with `{unsupported_tx_format, <<"{">>}`.
- Conclusion: all bundler-compatible upload paths must use real serialized ANS-104 DataItems. Step 9 tracks the required replacement/augmentation.

## Step 5 — publish/query/get/sync commands

Success criteria:

- `publish` uploads an article through the transport and records local cache metadata.
- `query` filters by topic, kind, key, and source metadata.
- `get` resolves latest article by key, fetches content, and verifies hash.
- `sync` writes latest article and attestation cache index.

Status: complete

Evaluation:

- Unit tests publish and re-publish an article through local transport.
- Unit tests verify query/get/sync behavior and latest-version cache.
- `npm test` passed.

## Step 6 — import-wikipedia/attest/consensus commands

Success criteria:

- `import-wikipedia` fetches/generates sourced markdown and publishes through the same article pipeline.
- `attest` creates a signed attestation against latest article ID/key.
- `consensus` returns opinion counts, total count, status, and PRD score; `--json` is parseable.

Status: complete

Evaluation:

- Unit tests import a fixture Wikipedia article and publish it through the same pipeline.
- Unit tests create valid and partially-valid attestations against an article.
- Unit tests verify consensus JSON returns 2 attestations and score `0.675` from the PRD formula.
- `npm test` passed.

## Step 7 — Skill/docs alignment

Success criteria:

- README, tag schema, and skill describe the public third brain model and current CLI.
- Safety/permanence warnings are present.

Status: complete

Evaluation:

- `README.md`, `docs/tag-schema.md`, and `skills/permabrain/SKILL.md` describe public articles, attestations, consensus, and current CLI.
- Safety/permanence warnings are present.
- `npm test` passed.

## Step 8 — Full validation

Success criteria:

- `npm test` passes.
- `npm run test:hyperbeam` passes or skips cleanly when HyperBEAM is unavailable.
- `npm run test:wikipedia` passes or skips cleanly when HyperBEAM/network is unavailable, unless required env flags are set.

Status: complete

Evaluation:

- `npm test` passed.
- `npm run test:hyperbeam` passed against local HyperBEAM using ANS-104 upload path `/~bundler@1.0/tx?codec-device=ans104@1.0` and fetch-by-ID.
- `npm run test:wikipedia` passed against local HyperBEAM and Wikipedia.
- `npm run test:arweave` passed read-only against `arweave.net`.
- `npm run test:public-upload` skips safely unless explicitly enabled.
- Note: local HyperBEAM GraphQL is reachable, but recently uploaded local items may not appear immediately/at all in GraphQL results, so CLI query/get/consensus/sync use local cache fallback for freshly published items.

## Step 9 — Real ANS-104 DataItem implementation

Success criteria:

- `src/dataitem.mjs` can create real serialized ANS-104 DataItem bytes for article and attestation payloads.
- Tags are encoded as ANS-104 tags and preserved in uploaded items.
- Keys are Arweave-compatible for ANS-104 signing, or the implementation integrates a vetted library that provides compatible signing.
- Unit tests verify DataItem signature and tag roundtrip using fixture vectors or library verification.
- `test:public-upload` posts binary ANS-104 bytes, not JSON, to `https://up.arweave.net`.
- `PERMABRAIN_ENABLE_PUBLIC_UPLOAD=1 npm run test:public-upload` no longer fails with `unsupported_tx_format`.
- HyperBEAM upload path uses the same serialized ANS-104 bytes.

Status: complete

Evaluation:

- Added `arbundles`/`arweave` dependencies.
- `src/keys.mjs` now creates Arweave RSA JWK identities (`arweave:<address>`) and Ed25519 identities (`ed25519:<public-key>`).
- `src/dataitem.mjs` now signs real ANS-104 DataItems with RSA JWK or Ed25519 and stores serialized bytes as `ans104Base64`.
- `src/transport.mjs` and `test:public-upload` post `application/octet-stream` ANS-104 bytes.
- `npm test` passed and verifies ANS-104 signature validity.
- `PERMABRAIN_ENABLE_PUBLIC_UPLOAD=1 npm run test:public-upload` was accepted by `https://up.arweave.net` with status 200 for RSA item `ZBoj5fpPa9yezR4GS99HgHlKjqCEEvpdOQySkrqjmKc`.
- `PERMABRAIN_ENABLE_PUBLIC_UPLOAD=1 PERMABRAIN_KEY_TYPE=ed25519 npm run test:public-upload` was accepted by `https://up.arweave.net` with status 200 for Ed25519 item `jIhfPR79ZCvSi67yfQMNwVMfL1qezk4Ee0tWQlVCLsw`.
- Direct local HyperBEAM Ed25519 ANS-104 upload/fetch passed via `/~bundler@1.0/tx?codec-device=ans104@1.0` and `/<id>`.
