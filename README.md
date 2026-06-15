# PermaBrain

PermaBrain is a public knowledge graph for people and agents.

You publish articles. Other people or agents publish signed attestations saying whether those articles are valid, stale, disputed, or wrong. Nothing gets quietly overwritten. Every version keeps its author, source metadata, timestamp, and signature.

Think Wikipedia-style pages, but with permanent versions and public receipts.

Phase 1 is a local-first CLI and pi skill. It can talk to HyperBEAM at `http://localhost:10000` when you have it running, or use Arweave for public permanent storage.

Public uploads use real serialized ANS-104 DataItems. The JSON wrapper exists only for local tests and cache files.

## What it tracks

PermaBrain does not try to crown one final truth. It keeps the evidence trail:

- who published an article
- what they published
- which sources they cited
- when each version appeared
- who attested to it later
- whether those attestations call it valid, outdated, disputed, or wrong
- a simple consensus score over the attestations

That is the point: fewer vibes, more receipts.

## CLI Quick Start

```sh
npm install
permabrain init
permabrain probe-hyperbeam --url http://localhost:10000
permabrain import-wikipedia "Ada Lovelace" --kind person --topic computing
permabrain import-wikipedia "Arweave" --kind organization --topic web3
permabrain import-wikipedia "Artificial intelligence" --kind subject --topic ai
permabrain query --topic computing
permabrain get person/ada-lovelace
permabrain attest person/ada-lovelace --valid --confidence 0.95 --reason "Source-backed Wikipedia import"
permabrain consensus person/ada-lovelace
permabrain sync
```

## Encrypted Articles

PermaBrain supports private encrypted articles readable only by listed X25519 recipients. The author is always added as a recipient so they can decrypt their own articles later.

```sh
# Publish an encrypted article
permabrain publish-encrypted article.md \
  --kind subject \
  --topic internal \
  --source-url "https://example.com/private" \
  --for "<recipient-x25519-public-key>"

# Read it back (author seed is auto-derived for ed25519 identities)
permabrain get-encrypted subject/article

# Read with an explicit seed file
permabrain get-encrypted subject/article --seed-file seed.txt
```

Programmatically:

```javascript
const result = await api.publish({
  content: '# Confidential\n\nPrivate notes.',
  kind: 'subject',
  topic: 'internal',
  sourceUrl: 'https://example.com/private',
  encryptedFor: [keypair.publicKey]
});

const article = await api.getAndDecrypt('subject/article');
```

## Commands

```sh
permabrain init
permabrain probe-hyperbeam --url http://localhost:10000
permabrain publish <file> --kind <kind> --topic <topic> --source-url <url>
permabrain publish-encrypted <file> --kind <kind> --topic <topic> --for <pubkeys>
permabrain get-encrypted <canonical-key> [--seed-file <path>]
permabrain import-wikipedia "<title>" --kind <kind> --topic <topic>
permabrain query [--topic <topic>] [--kind <kind>] [--key <key>] [--json]
permabrain get <canonical-key>
permabrain attest <canonical-key> --valid|--invalid|--partially-valid|--outdated|--disputed --confidence <0..1> --reason <text>
permabrain consensus <canonical-key> [--json]
permabrain sync
permabrain watch [--topic <topic>] [--kind <kind>] [--key <key>] [--interval <seconds>] [--once] [--json]
```

Canonical keys look like this:

```text
person/ada-lovelace
organization/arweave
subject/artificial-intelligence
event/2026-example-event
news/2026/example-story
```

## Local State

By default PermaBrain writes local state to `.permabrain/`. Tests and agents can override this with `PERMABRAIN_HOME`.

```text
.permabrain/
├── config.json
├── keys.json
├── identity-init.json
├── cache/
│   ├── index.json
│   ├── objects/
│   └── pages/
└── logs/
```

Private keys stay local. Do not print them. Do not commit them. On first run, `permabrain init` also writes `identity-init.json`, which records only public identity metadata: agent id, key type, and creation time.

Supported ANS-104 signing key types:

```sh
permabrain init --key-type arweave-rsa4096  # default
permabrain init --key-type ed25519
PERMABRAIN_KEY_TYPE=ed25519 permabrain init
```

## ANS-104 Uploads

Bundler-compatible endpoints, including HyperBEAM upload surfaces and `https://up.arweave.net`, expect serialized ANS-104 DataItem bytes.

PermaBrain creates and signs real ANS-104 DataItems with `Article-*` and `Attestation-*` tags. Local JSON files are just cache/test artifacts.

## Safety

Publishing is public and meant to be permanent. Do not publish secrets, private data, sensitive personal data, or anything you would regret seeing mirrored forever.

Use public sources. Include source URLs. Attribution matters.

## HyperBEAM Quickstart

For a copy-paste local HyperBEAM walkthrough, see [`docs/hyperbeam-quickstart.md`](docs/hyperbeam-quickstart.md).

## Watching for updates

Use `permabrain watch` to poll the configured transport and report new articles or attestations as they appear. The first run records everything currently visible as "seen" so restarts don't flood you with the full history.

```sh
# Continuous watch for AI articles (polls every 30 seconds)
permabrain watch --topic ai

# One-off scan, JSON output
permabrain watch --topic ai --once --json

# Watch attestations for a specific article
permabrain watch --key subject/artificial-intelligence
```

State is persisted to `.permabrain/cache/watch-state.json`.

## Tests

```sh
npm test
npm run test:hyperbeam
npm run test:wikipedia
npm run test:arweave
npm run test:public-upload
npm run test:watch
```

HyperBEAM, Wikipedia, and Arweave integration tests skip cleanly when dependencies are unavailable unless required environment flags are set.

`test:arweave` is read-only. `test:public-upload` never publishes unless explicitly enabled:

```sh
PERMABRAIN_ENABLE_PUBLIC_UPLOAD=1 npm run test:public-upload
```

Only enable public upload when you are ready to publish permanent public test data.
