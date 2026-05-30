# PRD — PermaBrain Public Third Brain

## 1. Product Summary

PermaBrain is a public, permanent, signed knowledge graph: a “third brain” for agents and humans. It lets multiple agents publish Wikipedia-like articles about subjects, people, organizations, events, news, and concepts, then publish signed attestations about the validity, freshness, and source quality of those articles.

Phase 1 focuses on a local HyperBEAM-backed CLI and pi skill that can import a few Wikipedia articles, publish them as signed immutable ANS-104 DataItems, query/fetch them, add attestations, compute simple consensus, and sync a local cache. ANS-104 serialization/signing is the required upload format for bundler-compatible endpoints, including HyperBEAM upload surfaces and `up.arweave.net`.

## 2. Problem

Agents need a shared, durable knowledge substrate that is:

- Publicly queryable
- Permanently stored
- Cryptographically signed
- Versioned and auditable
- Multi-agent contributable
- Able to represent disagreement and validity attestations

Existing wikis usually centralize editorial state. PermaBrain should instead preserve immutable claims, revisions, sources, and attestations so downstream agents can evaluate who claimed what, when, and with what confidence.

## 3. Goals

### Phase 1 Goals

- Build a working `permabrain` CLI.
- Build/update a pi skill for agents to use the CLI.
- Use local HyperBEAM at `http://localhost:10000` as the first upload/query/fetch target.
- Publish public article DataItems with stable article tags using real ANS-104 serialization/signing.
- Import public Wikipedia summaries into PermaBrain articles.
- Query articles by topic, kind, key, and source metadata.
- Fetch latest article content by canonical key.
- Publish signed attestations against articles.
- Compute simple consensus from attestations.
- Sync a local latest-version article/attestation cache.
- Provide automated tests, including a full Wikipedia + HyperBEAM test.

### Non-goals for Phase 1

- No custom HyperBEAM device yet.
- No AO process indexer yet.
- No private encrypted memory as the primary workflow.
- No sophisticated reputation model.
- No full Wikipedia crawler.
- No production public gateway deployment.
- No web UI required.

## 4. Target Users

- AI agents that need shared public memory.
- Developers experimenting with HyperBEAM/Arweave-backed knowledge systems.
- Researchers who want signed, provenance-rich public notes.
- Future readers/agents who need to verify article history and attestations.

## 5. Core Concepts

### Article

A signed immutable knowledge page about a public subject.

Examples:

- `person/ada-lovelace`
- `organization/arweave`
- `subject/artificial-intelligence`
- `event/2026-example-event`
- `news/2026/example-story`

### Revision

A newer article DataItem with the same `Article-Key`, incremented `Article-Version`, and `Article-Previous-Id` pointing to the prior version.

### Attestation

A separate signed DataItem that evaluates an article/version.

Opinions:

- `valid`
- `invalid`
- `partially-valid`
- `outdated`
- `disputed`

### Consensus

A simple MVP aggregate over attestations for an article key/version.

## 6. CLI Requirements

The CLI binary must be named:

```sh
permabrain
```

### Required Commands

```sh
permabrain init
permabrain probe-hyperbeam --url http://localhost:10000
permabrain publish <file> --kind <kind> --topic <topic> --source-url <url>
permabrain import-wikipedia "<title>" --kind <kind> --topic <topic>
permabrain query [--topic <topic>] [--kind <kind>] [--key <key>] [--json]
permabrain get <canonical-key>
permabrain attest <canonical-key> --valid|--invalid|--partially-valid|--outdated|--disputed --confidence <0..1> --reason <text>
permabrain consensus <canonical-key> [--json]
permabrain sync
```

### Help Requirements

- `permabrain --help` lists all commands.
- `permabrain <command> --help` explains flags.
- Invalid commands exit non-zero with actionable help.

## 7. Data, Signing, and Tag Requirements

### ANS-104 Requirement

PermaBrain article and attestation uploads must be real ANS-104 DataItems, not project-local JSON envelopes. Bundler-compatible endpoints are expected to accept serialized ANS-104 bytes. The implementation may keep JSON envelopes for local unit tests/cache fixtures, but public/HyperBEAM upload adapters must use the ANS-104 binary representation.

Requirements:

- Generate or import an Arweave-compatible signing wallet/key.
- Create ANS-104 DataItems for article content and attestation payloads.
- Preserve all PermaBrain tags as ANS-104 tags.
- Compute the public DataItem ID from the real signed DataItem.
- Upload serialized ANS-104 bytes to bundler-compatible endpoints.
- Verify DataItem signatures in tests.

### Article Tags

Article DataItems must include:

```text
App-Name: PermaBrain
App-Version: 0.1.0
PermaBrain-Type: article
Article-Key: <kind>/<slug>
Article-Kind: person | subject | event | organization | source | news
Article-Title: <title>
Article-Slug: <slug>
Article-Topic: <topic>
Article-Language: en
Article-Version: <integer>
Article-Previous-Id: <previous data item id, when applicable>
Article-Root-Id: <first article id, when known>
Article-Source-Name: <source name>
Article-Source-Url: <source URL>
Article-Source-License: <license, when known>
Article-Content-Hash: sha256:<hex>
Article-Published-At: <ISO timestamp>
Article-Updated-At: <ISO timestamp>
Author-Agent-Id: <wallet/address/agent id>
Visibility: public
```

### Attestation Tags

Attestation DataItems must include:

```text
App-Name: PermaBrain
App-Version: 0.1.0
PermaBrain-Type: attestation
Attestation-Target-Id: <article data item id>
Attestation-Target-Key: <article key>
Attestation-Opinion: valid | invalid | partially-valid | outdated | disputed
Attestation-Confidence: <0..1>
Attestation-Reason: <short reason>
Attestation-Agent-Id: <wallet/address/agent id>
Attestation-Source-Url: <optional source URL>
Attestation-Created-At: <ISO timestamp>
```

## 8. HyperBEAM Requirements

Phase 1 must target local HyperBEAM:

```text
http://localhost:10000
```

The implementation must discover/validate:

- health/root endpoint
- upload/DataItem endpoint accepting serialized ANS-104 bytes
- fetch-by-ID endpoint
- GraphQL/tag query endpoint

If HyperBEAM is unavailable, tests should skip cleanly unless `PERMABRAIN_REQUIRE_HYPERBEAM=1` is set.

## 9. Wikipedia Import Requirements

`permabrain import-wikipedia <title>` must:

- Fetch public summary/metadata from Wikipedia.
- Generate markdown content.
- Include source attribution.
- Include source URL.
- Include source license note when known.
- Publish through the same article pipeline as `publish`.

Initial test articles:

- `Ada Lovelace` → `person/ada-lovelace`, topic `computing`
- `Arweave` → `organization/arweave`, topic `web3`
- `Artificial intelligence` → `subject/artificial-intelligence`, topic `ai`

## 10. Consensus Requirements

`permabrain consensus <key>` must:

- Resolve the latest article version.
- Query attestations for the article key and/or latest article ID.
- Return opinion counts.
- Return total attestation count.
- Return a simple weighted score.
- Return parseable JSON with `--json`.

MVP scoring:

```text
score = sum(valid * confidence + partially-valid * confidence * 0.5 - invalid * confidence - disputed * confidence * 0.75 - outdated * confidence * 0.5) / total_attestations
```

If no attestations exist, status should be `unattested`.

## 11. Local State Requirements

Use `.permabrain/` or `PERMABRAIN_HOME`:

```text
.permabrain/
├── config.json
├── keys.json
├── cache/
│   ├── index.json
│   └── pages/
└── logs/
```

Requirements:

- `keys.json` must not be printed.
- `.permabrain/` should be gitignored.
- Tests must use temporary `PERMABRAIN_HOME`.

## 12. pi Skill Requirements

The skill at `skills/permabrain/SKILL.md` must let an agent:

- initialize PermaBrain
- probe HyperBEAM
- import Wikipedia articles
- publish local articles
- query public articles
- fetch articles
- attest to validity
- check consensus
- sync local cache

The skill must include permanence/privacy warnings.

## 13. Test Requirements

### Unit Tests

`npm test` must cover:

- CLI parsing/help
- config init/load
- tag validation
- article key/slug derivation
- attestation validation
- consensus scoring
- cache indexing

### HyperBEAM Test

`npm run test:hyperbeam` must:

- probe local HyperBEAM
- upload a minimal signed ANS-104 DataItem as binary bytes
- query by tags
- fetch uploaded content

### Wikipedia E2E Test

`npm run test:wikipedia` must:

1. Use temporary `PERMABRAIN_HOME`.
2. Run `permabrain init`.
3. Import Ada Lovelace.
4. Import Arweave.
5. Import Artificial intelligence.
6. Query by topic and kind.
7. Fetch `person/ada-lovelace`.
8. Publish at least one valid attestation.
9. Run consensus.
10. Run sync.
11. Assert local cache includes all three articles.

## 14. Acceptance Criteria

Phase 1 is accepted when these commands work from a clean checkout:

```sh
npm install
npm test
# with HyperBEAM running separately at localhost:10000
npm run test:hyperbeam
npm run test:wikipedia
npm run test:arweave
```

Public upload validation through `up.arweave.net` is accepted when explicitly enabled and funded/configured as required:

```sh
PERMABRAIN_ENABLE_PUBLIC_UPLOAD=1 npm run test:public-upload
```

Manual demo:

```sh
permabrain init
permabrain import-wikipedia "Ada Lovelace" --kind person --topic computing
permabrain import-wikipedia "Arweave" --kind organization --topic web3
permabrain import-wikipedia "Artificial intelligence" --kind subject --topic ai
permabrain query --topic computing
permabrain get person/ada-lovelace
permabrain attest person/ada-lovelace --valid --confidence 0.95 --reason "Source-backed Wikipedia import"
permabrain consensus person/ada-lovelace
permabrain sync
```

The project is successful when article publishing, querying, fetching, attesting, consensus, and sync all work through local HyperBEAM and through the pi skill workflow.
