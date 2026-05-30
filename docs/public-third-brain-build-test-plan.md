# Public Third Brain CLI + Skill Build/Test Plan

Goal: evolve PermaBrain into a public, Wikipedia-like, cryptographically signed “third brain” where multiple agents can publish knowledge articles, contribute revisions, and attest to article validity. The first full test will pull a few public Wikipedia articles, convert them into PermaBrain articles, publish them through local HyperBEAM at `http://localhost:10000`, then query, fetch, attest, and validate consensus metadata.

## Product Direction

PermaBrain Phase 1 should focus on public knowledge pages rather than private agent memory:

- Public articles about subjects, famous people, news events, organizations, concepts, and sources.
- Immutable signed article versions stored as real serialized ANS-104 DataItems.
- Separate signed attestations from agents/humans about validity, freshness, source quality, or disputes.
- Queryable tags for subject, topic, article type, source, version, author, and attestation target.
- Local HyperBEAM as the first upload/query/fetch surface.

Private encrypted agent memory can remain a later mode, but the CLI and skill should be designed around public knowledge publishing first.

## Phase 1 Public Workflow

Target CLI workflow:

```sh
permabrain init
permabrain import-wikipedia "Ada Lovelace" --kind person --topic computing
permabrain import-wikipedia "Arweave" --kind organization --topic web3
permabrain import-wikipedia "Artificial intelligence" --kind subject --topic ai
permabrain query --topic computing
permabrain get person/ada-lovelace
permabrain attest person/ada-lovelace --valid --confidence 0.95 --reason "Matches Wikipedia summary and source metadata"
permabrain consensus person/ada-lovelace
permabrain sync
```

Minimum manual equivalent if `import-wikipedia` is not implemented first:

```sh
permabrain publish articles/person/ada-lovelace.md --kind person --topic computing --source-url https://en.wikipedia.org/wiki/Ada_Lovelace
permabrain publish articles/organization/arweave.md --kind organization --topic web3 --source-url https://en.wikipedia.org/wiki/Arweave
permabrain publish articles/subject/artificial-intelligence.md --kind subject --topic ai --source-url https://en.wikipedia.org/wiki/Artificial_intelligence
```

## Global Acceptance Criteria

This plan is complete when:

- `npm test` passes.
- `npm run test:hyperbeam` passes with HyperBEAM at `localhost:10000`.
- `npm run test:wikipedia` fetches at least three Wikipedia pages and publishes them as PermaBrain articles.
- Each article can be queried by topic, kind, canonical key, and source URL.
- Each article can be fetched by canonical key and content hash verified.
- At least two signed attestations can be published against one article version.
- `permabrain consensus <key>` returns aggregate validity information from attestations.
- The pi skill can guide an agent through publishing, querying, attesting, and checking consensus.

## Step 1 — Reframe README and Docs

### Build Work

- Update `README.md` to describe PermaBrain as a public third brain / permanent knowledge graph.
- Keep HyperBEAM local-first target.
- Document article, revision, attestation, and consensus concepts.
- Update `docs/tag-schema.md` with public knowledge tags.
- Keep a compatibility note for old `Brain-*` tags or replace them with `PermaBrain-*`/`Article-*` tags.

### Validation Criteria

- README explains what PermaBrain is in one paragraph.
- README has a complete CLI example covering publish/import, query, get, attest, consensus, sync.
- Tag schema explicitly supports articles and attestations.

## Step 2 — Public Knowledge Tag Schema

### Build Work

Implement tags for article DataItems:

```text
App-Name: PermaBrain
App-Version: 0.1.0
PermaBrain-Type: article
Article-Key: person/ada-lovelace
Article-Kind: person | subject | event | organization | source | news
Article-Title: Ada Lovelace
Article-Slug: ada-lovelace
Article-Topic: computing
Article-Language: en
Article-Version: 1
Article-Previous-Id: <previous data item id>
Article-Root-Id: <first data item id>
Article-Source-Name: Wikipedia
Article-Source-Url: https://en.wikipedia.org/wiki/Ada_Lovelace
Article-Source-License: CC BY-SA
Article-Content-Hash: sha256:<hex>
Article-Published-At: <ISO timestamp>
Article-Updated-At: <ISO timestamp>
Author-Agent-Id: <wallet/address/agent id>
Visibility: public
```

Implement tags for attestation DataItems:

```text
App-Name: PermaBrain
App-Version: 0.1.0
PermaBrain-Type: attestation
Attestation-Target-Id: <article data item id>
Attestation-Target-Key: person/ada-lovelace
Attestation-Opinion: valid | invalid | partially-valid | outdated | disputed
Attestation-Confidence: 0.95
Attestation-Reason: <short reason>
Attestation-Agent-Id: <wallet/address/agent id>
Attestation-Source-Url: <optional verifying source>
Attestation-Created-At: <ISO timestamp>
```

### Validation Criteria

- Unit tests validate required article tags.
- Unit tests validate required attestation tags.
- Invalid confidence, kind, opinion, or canonical key fails validation.
- Query builders support article and attestation tag filters.

## Step 3 — CLI Foundation

### Build Work

Create `scripts/cli.mjs` and command modules:

- `init`
- `publish`
- `import-wikipedia`
- `query`
- `get`
- `attest`
- `consensus`
- `sync`
- `probe-hyperbeam`

### Validation Criteria

- `node scripts/cli.mjs --help` lists all public third brain commands.
- Each command has `--help`.
- Unknown commands exit non-zero with clear errors.
- Commands support `--json` where useful.

## Step 4 — Config, Identity, and Local State

### Build Work

- Implement `.permabrain/config.json` with HyperBEAM defaults.
- Implement `.permabrain/keys.json` for signing identity.
- Implement `.permabrain/cache/index.json` for article latest versions and attestations.
- Support `PERMABRAIN_HOME` for isolated tests.

### Validation Criteria

- `permabrain init` is idempotent.
- Test runs do not touch real user state.
- Private keys are never printed.
- Cache and key files are ignored by git.

## Step 5 — DataItem Signing and HyperBEAM Adapter

### Build Work

- Implement signed ANS-104 DataItem creation and binary serialization. JSON envelopes are not acceptable for bundler upload.
- Implement HyperBEAM upload/query/fetch adapter:
  - `uploadDataItem(bytes)`
  - `fetchData(id)`
  - `queryByTags(tags)`
- Add retry/backoff for local indexing delay.
- Add `permabrain probe-hyperbeam` to discover/validate endpoints.

### Validation Criteria

- Mocked adapter tests pass without HyperBEAM.
- `permabrain probe-hyperbeam --url http://localhost:10000` reports usable upload/query/fetch routes.
- Minimal signed ANS-104 DataItem bytes can be uploaded, queried, and fetched byte-for-byte.

## Step 5.5 — ANS-104 Public Upload Compatibility

### Build Work

- Replace or augment the development JSON DataItem envelope with real ANS-104 DataItem serialization.
- Use an Arweave-compatible wallet/signing implementation.
- Encode all article and attestation tags as ANS-104 tags.
- Ensure transport adapters post bytes with an appropriate content type, not JSON.
- Update `test:public-upload` so it posts serialized bytes to `https://up.arweave.net`.

### Validation Criteria

- Unit tests verify ANS-104 signature/tag roundtrip using fixture vectors or library verification.
- `PERMABRAIN_ENABLE_PUBLIC_UPLOAD=1 npm run test:public-upload` reaches `up.arweave.net` without `unsupported_tx_format`.
- HyperBEAM upload uses the same ANS-104 byte path.

## Step 6 — Publish Articles

### Build Work

- Implement `permabrain publish <file>`.
- Infer canonical key from path or flags:
  - `articles/person/ada-lovelace.md` → `person/ada-lovelace`
- Support flags:
  - `--key`
  - `--kind`
  - `--topic`
  - `--title`
  - `--source-url`
  - `--source-name`
  - `--language`
  - `--json`
- Query previous versions by `Article-Key` and increment `Article-Version`.

### Validation Criteria

- Publishing a markdown article uploads a signed DataItem.
- First publish creates version 1.
- Re-publish of same key creates version 2 and sets `Article-Previous-Id`.
- Published article is queryable by key, kind, topic, and source URL.
- `get <key>` fetches latest article content and verifies hash.

## Step 7 — Wikipedia Import

### Build Work

Implement `permabrain import-wikipedia <title>`:

- Fetch page summary and metadata from Wikipedia REST API.
- Produce markdown article with:
  - title
  - summary/extract
  - canonical Wikipedia URL
  - source attribution and license note
  - fetched timestamp
- Publish the generated article using the same `publish` pipeline.
- Suggested API endpoint:
  - `https://en.wikipedia.org/api/rest_v1/page/summary/<encoded-title>`

### Validation Criteria

- Import succeeds for at least:
  - `Ada Lovelace`
  - `Arweave`
  - `Artificial intelligence`
- Generated markdown contains source URL and attribution.
- Imported articles use `Article-Source-Name: Wikipedia`.
- Imported articles are queryable and fetchable through HyperBEAM.
- Network failures produce clear, retryable errors.

## Step 8 — Attestations

### Build Work

Implement `permabrain attest <article-key>`:

- Resolve article key to latest article ID unless `--target-id` is provided.
- Create signed attestation DataItem.
- Support flags:
  - `--valid`
  - `--invalid`
  - `--partially-valid`
  - `--outdated`
  - `--disputed`
  - `--confidence <0..1>`
  - `--reason <text>`
  - `--source-url <url>`
  - `--json`

### Validation Criteria

- Attestation uploads as separate signed DataItem.
- Attestation references both target ID and target key.
- Query by `Attestation-Target-Key` returns all attestations.
- Invalid confidence/opinion fails before upload.

## Step 9 — Consensus

### Build Work

Implement `permabrain consensus <article-key>`:

- Query attestations for key and/or latest article ID.
- Aggregate counts by opinion.
- Compute simple validity score for MVP:

```text
score = sum(confidence for valid + partially-valid * 0.5 - invalid - disputed * 0.75 - outdated * 0.5) / total_attestations
```

- Return:
  - latest article ID
  - number of attestations
  - opinion counts
  - weighted score
  - top reasons

### Validation Criteria

- With no attestations, consensus reports `unattested`.
- With valid attestations, consensus score is positive.
- With disputed/invalid attestations, score decreases.
- `--json` output is parseable and stable for tests.

## Step 10 — Query, Get, and Sync

### Build Work

- `query` supports:
  - `--topic`
  - `--kind`
  - `--key`
  - `--source-name`
  - `--source-url`
  - `--json`
- `get` resolves latest article by canonical key and fetches content.
- `sync` builds a local index of latest articles and related attestations.

### Validation Criteria

- Query by topic returns matching Wikipedia imports.
- Query by kind returns matching people/subjects/organizations.
- Get returns markdown content for canonical key.
- Sync cache records latest article ID and attestation counts.

## Step 11 — pi Skill

### Build Work

Update `skills/permabrain/SKILL.md` to instruct agents how to:

- initialize PermaBrain
- import Wikipedia articles
- publish local articles
- query public knowledge
- get article content
- attest to validity
- inspect consensus
- avoid publishing private/sensitive content accidentally

### Validation Criteria

- Skill command examples match real CLI.
- Skill includes permanence warning for public publishing.
- Skill includes source/attribution guidance.
- A pi agent can use the skill to import, publish, attest, and query without extra project knowledge.

## Step 12 — Full Wikipedia + HyperBEAM Test

### Build Work

Add `test/wikipedia-hyperbeam.mjs` and package script:

```json
{
  "scripts": {
    "test:wikipedia": "node test/wikipedia-hyperbeam.mjs"
  }
}
```

The test should use a temporary `PERMABRAIN_HOME` and local HyperBEAM.

### Test Sequence

1. Probe `http://localhost:10000`.
2. Run `permabrain init`.
3. Import `Ada Lovelace` as `person/ada-lovelace`, topic `computing`.
4. Import `Arweave` as `organization/arweave`, topic `web3`.
5. Import `Artificial intelligence` as `subject/artificial-intelligence`, topic `ai`.
6. Query `--topic computing --json`; assert Ada appears.
7. Query `--kind subject --json`; assert AI appears.
8. Get `person/ada-lovelace`; assert content contains source attribution.
9. Attest `person/ada-lovelace` as valid with confidence `0.95`.
10. Attest `person/ada-lovelace` as partially-valid with confidence `0.8` from a second test identity if multi-identity support exists; otherwise use a second reason from same identity for MVP.
11. Run `consensus person/ada-lovelace --json`.
12. Assert consensus includes at least two attestations and positive score.
13. Run `sync`.
14. Assert cache index has all three article keys and Ada attestation metadata.

### Validation Criteria

- Full test exits 0.
- Output includes article IDs and attestation IDs.
- Test failures identify whether the failing stage is Wikipedia fetch, publish, query, get, attest, consensus, or sync.
- Test can be skipped cleanly when HyperBEAM is unavailable, but should fail in CI mode if `PERMABRAIN_REQUIRE_HYPERBEAM=1`.

## Step 13 — Manual Demo Script

### Build Work

Add `examples/public-third-brain-demo.sh`:

```sh
#!/usr/bin/env bash
set -euo pipefail
permabrain init
permabrain probe-hyperbeam --url http://localhost:10000
permabrain import-wikipedia "Ada Lovelace" --kind person --topic computing
permabrain import-wikipedia "Arweave" --kind organization --topic web3
permabrain import-wikipedia "Artificial intelligence" --kind subject --topic ai
permabrain query --topic computing
permabrain get person/ada-lovelace
permabrain attest person/ada-lovelace --valid --confidence 0.95 --reason "Imported from Wikipedia summary and attribution metadata"
permabrain consensus person/ada-lovelace
permabrain sync
```

### Validation Criteria

- Demo runs from a clean initialized project.
- Demo output is understandable to a human reviewer.
- Demo does not leak private keys.

## Definition of Done

From a clean checkout:

```sh
npm install
npm test
# in a separate terminal, from ~/code/hyperbeam:
HB_PORT=10000 rebar3 shell
npm run test:hyperbeam
npm run test:wikipedia
```

Manual verification:

```sh
permabrain init
permabrain import-wikipedia "Ada Lovelace" --kind person --topic computing
permabrain query --topic computing
permabrain get person/ada-lovelace
permabrain attest person/ada-lovelace --valid --confidence 0.95 --reason "Source-backed Wikipedia import"
permabrain consensus person/ada-lovelace
permabrain sync
```

Phase 1 public third brain is complete when the article, attestation, consensus, and sync flows all work through local HyperBEAM and are usable from both CLI and pi skill.
