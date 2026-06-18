# PermaBrain

PermaBrain is a public knowledge graph for people and agents.

## Installation

```sh
npm install -g permabrain
# or locally in a project
npm install permabrain
```

Install from source:

```sh
git clone https://github.com/twilson63/permabrain.git
cd permabrain
npm install
npm link
```

Then initialize a home directory:

```sh
permabrain init
```

By default state lives in `./.permabrain/`. Override with `PERMABRAIN_HOME`:

```sh
PERMABRAIN_HOME=/path/to/home permabrain init
```

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
permabrain probe --use-hyperbeam --url http://localhost:10000
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

The web viewer (`viewer/index.html`) also detects encrypted articles. Paste an X25519 seed into the decrypt panel to render the plaintext locally; the seed is never stored persistently or sent anywhere.

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

## Command Catalog

### Identity and Local State

```sh
permabrain init [--key-type arweave-rsa4096|ed25519]
permabrain config get [path]
permabrain config set <path> <value>
permabrain config validate
permabrain config env
permabrain config reset
permabrain doctor [--fix] [--json]
```

### Publishing and Reading

```sh
permabrain publish <file> --kind <kind> --topic <topic> --source-url <url>
permabrain publish-encrypted <file> --kind <kind> --topic <topic> --for <pubkeys>
permabrain get-encrypted <canonical-key> [--seed-file <path>]
permabrain import-wikipedia "<title>" --kind <kind> --topic <topic>
permabrain template <file> [--variables '{"name":"Ada"}'] [--encrypt] [--recipient <key>]
permabrain get <canonical-key>
permabrain history <canonical-key>
permabrain verify <id-or-key> [--attestations]
```

### Discovery and Feeds

```sh
permabrain query [--topic <topic>] [--kind <kind>] [--key <key>] [--json]
permabrain search <query> [--kind <kind>] [--topic <topic>] [--author <id>] [--limit 20]
permabrain topic <topic> [--sort date|consensus|title|attestations] [--limit 50]
permabrain list [--kind <kind>] [--topic <topic>] [--author <id>] [--sort date|title|consensus|attestations|key]
permabrain activity [--topic <topic>] [--kind <kind>] [--key <key>] [--event-kind publish|attest|fork|merge]
```

### Attestation and Consensus

```sh
permabrain attest <canonical-key> --valid|--invalid|--partially-valid|--outdated|--disputed --confidence <0..1> --reason <text>
permabrain consensus <canonical-key> [--json]
permabrain batch-attest --file attestations.json [--use-hyperbeam]
permabrain metrics [--topic <topic>] [--kind <kind>] [--top 10]
permabrain stats [--topic <topic>] [--kind <kind>] [--top 10]
```

### Version Control: Forks, Merges, and Diffs

```sh
permabrain fork <source-key> --slug "critique"
permabrain list-forks <source-key>
permabrain diff <base> <head>
permabrain diff <canonical-key> --local
permabrain merge <target-key> <source-key>
permabrain sync [--no-auto-merge] [--dry-run]
```

### Transport and Remotes

```sh
permabrain probe [--use-hyperbeam] [--url <url>]
permabrain probe-hyperbeam --url http://localhost:10000
permabrain probe-devices --url http://localhost:10000
permabrian remote list
permabrain remote add local-hb http://localhost:10000 --transport hyperbeam
permabrain remote default local-hb
permabrain remote probe
permabrain transport-status
permabrain watch [--topic <topic>] [--kind <kind>] [--key <key>] [--interval 30] [--once]
```

### HyperBEAM Device Commands

```sh
permabrain match --key Article-Topic --value ai --url http://localhost:10000
permabrain whois <address>
permabrain meta-info
permabrain deploy-consensus
permabrain reference create article-key=subject/foo current-version=<id>
permabrain reference update <ref-id> current-version=<id>
permabrain reference resolve <ref-id>
```

### Bundles, Export, and Import

```sh
permabrain export-bundle <canonical-key> [--output bundle.json]
permabrain export-all [--output all.json]
permabrain export-history <canonical-key> [--output history.json]
permabrain export-articles [--topic <topic>] [--format json|markdown] [--output articles.md]
permabrain import-bundle <file>
permabrain import-history <file>
```

### Snapshots, Backups, and Archives

```sh
permabrain backup create --passphrase "correct horse battery staple"
permabrain backup list
permabrain backup restore 1 --passphrase "correct horse battery staple"
permabrain backup prune --keep 5 --max-age-days 30
permabrain archive --passphrase "correct horse battery staple" --output snapshot.json
permabrain restore snapshot.json --passphrase "correct horse battery staple"
```

### Audit and Dashboard

```sh
permabrain log [--tail 10]
permabrain log --follow --interval 1
permabrain log export --output audit.jsonl
permabrain log import audit.jsonl
permabrain dashboard --output dashboard.html --publish
permabrain status
```

### HTTP Client SDK

```sh
permabrain client health [--url http://localhost:8765]
permabrain client status [--url http://localhost:8765]
permabrain client get person/ada-lovelace [--url http://localhost:8765]
permabrain client query --topic computing
permabrain client publish article.md --kind subject --topic ai --source-url https://example.com/ai
```

### Shell Completion

```sh
permabrain completion bash > /etc/bash_completion.d/permabrain
permabrain completion zsh > "${fpath[1]}/_permabrain"
permabrain completion fish > ~/.config/fish/completions/permabrain.fish
```

Then reload your shell or source the generated script.

```javascript
import { createClient } from 'permabrain';
const client = createClient({ baseUrl: 'http://localhost:8765' });

await client.health();
const article = await client.get('person/ada-lovelace');
const { score } = await client.consensus('person/ada-lovelace');
```

### Local HTTP API

```sh
permabrain serve [--port 8765] [--stream-transport ws|sse] [--api-key <key>] [--cors-origin <origin>]
```

Exposes the agent API over REST.

#### API-key authentication

When `--api-key` is set (or `PERMABRAIN_API_KEY` is set in the environment), all protected endpoints require the key. The following endpoints stay public so clients can discover the server and subscribe to live streams without a secret:

- `GET /health`
- `GET /api/v1/events/stream`
- `GET /api/v1/events/ws`
- `GET /api/v1/articles/stream`

Pass the key in any of these ways:

- Header: `Authorization: Bearer <api-key>`
- Header: `X-Api-Key: <api-key>`
- Query parameter: `?api-key=<api-key>`
- JSON body field: `{ "apiKey": "<api-key>" }` (for POST requests)

#### CORS

By default `permabrain serve` sends open CORS headers (`Access-Control-Allow-Origin: *`) so browser viewers and SDK clients on other origins can call the API. Preflight `OPTIONS` requests are handled automatically.

Restrict to a single trusted origin:

```sh
permabrain serve --cors-origin http://trusted.example.com
PERMABRAIN_CORS_ORIGIN=http://trusted.example.com permabrain serve
```

When a specific origin is configured, the server only returns `Access-Control-Allow-Origin` for matching `Origin` headers.

```sh
# Start the server with an API key
PERMABRAIN_API_KEY=pb_xxx permabrain serve

# Or pass it on the command line
permabrain serve --api-key pb_xxx

# Use it with the client CLI
permabrain client health --api-key pb_xxx
permabrain client routes --api-key pb_xxx
```

From code:

```javascript
const client = createClient({ baseUrl: 'http://localhost:8765', apiKey: 'pb_xxx' });
```

#### Key endpoints:

- `GET /health` — server health, transport, agent id, live-stream advertisement
- `GET /api/v1/status`
- `GET /api/v1/articles` — query articles
- `GET /api/v1/articles/:key` — get article
- `POST /api/v1/articles` — publish article
- `POST /api/v1/articles/:key/attest` — attest
- `GET /api/v1/articles/:key/consensus`
- `GET /api/v1/articles/:key/history`
- `GET /api/v1/search?q=...`
- `GET /api/v1/dashboard` and `/api/v1/dashboard.html`
- `GET /api/v1/log` / `POST /api/v1/log`
- `GET /api/v1/log/export` / `POST /api/v1/log/import`
- `GET /api/v1/bundles` — export a single article bundle
- `POST /api/v1/bundles` — import an article bundle
- `GET /api/v1/export-all` — export all indexed articles as a bundle
- `GET /api/v1/history-export?key=...` — export a full version history bundle
- `POST /api/v1/history-import` — import a history bundle
- `POST /api/v1/completion` — generate a shell completion script
- `GET /api/v1/events/stream` — Server-Sent Events real-time stream
- `GET /api/v1/events/ws` — WebSocket real-time event stream
- `GET /api/v1/articles/stream` — live filtered article/attestation SSE stream

#### Route discovery and OpenAPI

The server advertises its full route catalog and an OpenAPI 3.0 JSON document:

- `GET /api/v1/routes` — list every registered route with method, auth requirements, parameter shapes, and descriptions
- `GET /api/v1/openapi.json` — OpenAPI 3.0.3 document with paths, security schemes, and operation summaries

Use the client CLI to inspect them:

```sh
permabrain client routes
permabrain client openapi
permabrain client routes --url http://peer.example.com:8765 --json
```

Or from code:

```javascript
const client = createClient({ baseUrl: 'http://localhost:8765', apiKey: 'pb_xxx' });
const { routes } = await client.routes();
const spec = await client.openapi();

// Export and import bundles
const bundle = await client.exportBundle({ key: 'person/ada-lovelace' });
const all = await client.exportAll();
const history = await client.exportHistory('person/ada-lovelace');
const importResult = await client.importBundle(bundle);
const historyResult = await client.importHistory(history);

// Generate a shell completion script
const { script } = await client.completion({ shell: 'bash' });
```

When `--api-key` is set on the server, discovery endpoints require the same key. Pass it with `--api-key` or `PERMABRAIN_API_KEY`.

Bundle import accepts `{ bundle, verify, skipDuplicates }` and history import accepts the same shape. Completion accepts `{ shell: 'bash' | 'zsh' | 'fish' }` and returns `{ script }`.

Run `permabrain serve --help` for details.

### Multi-Agent Workflow Helpers

```sh
permabrain provision-agent reviewer --key-type ed25519
permabrain attest-for-agent <key> --identity-file reviewer.json --valid --confidence 0.9 --reason "Reviewed"
permabrain list-agents
permabrain goal plan.md --execute
permabrain plan plan.md --topic ai --kind subject
```

## Common Workflows

### Publish and attest a source-backed article

```sh
permabrain init
permabrain import-wikipedia "Ada Lovelace" --kind person --topic computing
permabrain get person/ada-lovelace
permabrain attest person/ada-lovelace --valid --confidence 0.95 --reason "Well-sourced Wikipedia import"
permabrain consensus person/ada-lovelace
```

### Fork, edit, and merge

```sh
permabrain fork subject/artificial-intelligence --slug "shorter" --title "AI (short version)"
permabrain list-forks subject/artificial-intelligence
permabrain diff subject/artificial-intelligence person/ai-shorter
permabrain merge subject/artificial-intelligence person/ai-shorter
permabrain sync --dry-run
```

### Search and export a topic

```sh
permabrain search "Ada Lovelace" --topic computing --limit 10
permabrain topic computing --sort consensus --limit 20
permabrain export-articles --topic computing --format markdown --output computing.md
```

### Encrypted internal note

```sh
permabrain publish-encrypted notes.md --kind subject --topic internal --for "<recipient-public-key>"
permabrain get-encrypted subject/notes --seed-file my-seed.txt
```

### Build and publish a dashboard

```sh
permabrain dashboard --output dashboard.html --publish --topic computing
```

### Audit everything that happened today

```sh
permabrain log --after 2026-06-17T00:00:00Z --order desc --limit 100
```

## Canonical Keys

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
├── logs/
│   └── audit-log.jsonl
└── backups/
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
npm run test:transport-resilience
npm run test:hyperbeam
npm run test:wikipedia
npm run test:arweave
npm run test:public-upload
npm run test:watch
```

Transport calls (HyperBEAM and Arweave) are wrapped with exponential-backoff retries and per-target circuit breakers. After repeated failures the breaker opens for 30 seconds, rejects fast, then tries a few half-open probes before closing. You can inspect breaker state through the probe output or programmatically via `api.getCircuitBreakerStatus()`.

HyperBEAM, Wikipedia, and Arweave integration tests skip cleanly when dependencies are unavailable unless required environment flags are set.

`test:arweave` is read-only. `test:public-upload` never publishes unless explicitly enabled:

```sh
PERMABRAIN_ENABLE_PUBLIC_UPLOAD=1 npm run test:public-upload
```

Only enable public upload when you are ready to publish permanent public test data.

## Agent API

Most CLI commands are also available programmatically through `src/agent-api.mjs`:

```javascript
import { api } from 'permabrain';
await api.init();
const result = await api.publish({ content: '# AI\n...', kind: 'subject', topic: 'ai', sourceUrl: 'https://example.com/ai' });
const article = await api.get('subject/artificial-intelligence');
const report = await api.doctor({ fix: true });
```

You can also talk to a running `permabrain serve` instance with the HTTP client SDK:

```javascript
import { createClient } from 'permabrain';
const client = createClient({ baseUrl: 'http://localhost:8765' });

await client.health();
const { summary } = await client.publish({
  content: '# Ada Lovelace\n...',
  kind: 'person',
  topic: 'computing',
  sourceUrl: 'https://en.wikipedia.org/wiki/Ada_Lovelace'
});
const article = await client.get('person/ada-lovelace');
const { score } = await client.consensus('person/ada-lovelace');
const html = await client.dashboardHTML();
```

The client mirrors the agent API surface and returns JSON responses from the REST endpoints. Every method rejects with `{ status, error }` when the server responds with a non-2xx status code.

See `src/agent-api.mjs` and `src/client.mjs` for the full method lists.
