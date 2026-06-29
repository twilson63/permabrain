# PermaBrain

A public signed knowledge graph for people, organizations, and subjects — built on Arweave and HyperBEAM. Publish articles, gather public attestations, and track consensus over time. No quiet overwrites. No single source of truth. Just permanent versions with receipts.

[![npm version](https://img.shields.io/npm/v/permabrain.svg)](https://www.npmjs.com/package/permabrain)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js >= 20](https://img.shields.io/badge/node-%3E%3D20-green.svg)](https://nodejs.org)

[![Tests](https://github.com/twilson63/permabrain/actions/workflows/release.yml/badge.svg)](https://github.com/twilson63/permabrain/actions)

## Table of Contents

- [Quick Start](#quick-start)
- [What It Tracks](#what-it-tracks)
- [Installation](#installation)
- [Encrypted Articles](#encrypted-articles)
- [CLI Command Catalog](#cli-command-catalog)
  - [Identity and Local State](#identity-and-local-state)
  - [Publishing and Reading](#publishing-and-reading)
  - [Discovery and Feeds](#discovery-and-feeds)
  - [Attestation and Consensus](#attestation-and-consensus)
  - [Version Control: Forks, Merges, and Diffs](#version-control-forks-merges-and-diffs)
  - [Transport and Remotes](#transport-and-remotes)
  - [HyperBEAM Device Commands](#hyperbeam-device-commands)
  - [Bundles, Export, and Import](#bundles-export-and-import)
  - [Snapshots, Backups, and Archives](#snapshots-backups-and-archives)
  - [Audit and Dashboard](#audit-and-dashboard)
  - [HTTP Client SDK](#http-client-sdk)
  - [Shell Completion](#shell-completion)
  - [Interactive Shell](#interactive-shell)
- [Local HTTP API](#local-http-api)
  - [API-key Authentication](#api-key-authentication)
  - [CORS](#cors)
  - [Rate Limiting](#rate-limiting)
  - [Request Logging / Access Logs](#request-logging-access-logs)
  - [Metrics and Monitoring](#metrics-and-monitoring)
  - [Route Discovery and OpenAPI](#route-discovery-and-openapi)
- [Web Viewer](#web-viewer)
- [Multi-Agent Workflow Helpers](#multi-agent-workflow-helpers)
- [Common Workflows](#common-workflows)
- [Canonical Keys](#canonical-keys)
- [Local State](#local-state)
- [ANS-104 Uploads](#ans-104-uploads)
- [Safety](#safety)
- [HyperBEAM Quickstart](#hyperbeam-quickstart)
- [Watching for Updates](#watching-for-updates)
- [Tests](#tests)
- [Agent API](#agent-api)
- [Publishing the Package](#publishing-the-package)

## Quick Start

```sh
npm install -g permabrain
permabrain init
permabrain import-wikipedia "Ada Lovelace" --kind person --topic computing
permabrain get person/ada-lovelace
permabrain attest person/ada-lovelace --valid --confidence 0.95 --reason "Source-backed Wikipedia import"
permabrain consensus person/ada-lovelace
```

## What It Tracks

PermaBrain does not try to crown one final truth. It keeps the evidence trail:

- who published an article
- what they published
- which sources they cited
- when each version appeared
- who attested to it later
- whether those attestations call it valid, outdated, disputed, or wrong
- a simple consensus score over the attestations

That is the point: fewer vibes, more receipts.

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

Phase 1 is a local-first CLI and pi skill. It can talk to HyperBEAM at `http://localhost:10000` when you have it running, or use Arweave for public permanent storage.

Public uploads use real serialized ANS-104 DataItems. The JSON wrapper exists only for local tests and cache files.

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

## CLI Command Catalog

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
permabrain publish-dir <dir> [--recursive] [--dry-run] [--kind <kind>] [--topic <topic>]
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
permabrain remote list
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
permabrain import <file>                 # auto-detects bundle type
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

### Interactive Shell

```sh
permabrain shell
```

Opens a live Node.js REPL with the agent API as the context. `api` and the
alias `pb` expose every API method, so you can explore interactively:

```
permabrain> await api.query({ topic: 'ai', limit: 5 })
permabrain> pb.status()
permabrain> pb.metrics({ top: 10 })
permabrain> .exit
```

Command history is persisted to `<PERMABRAIN_HOME>/repl-history.jsonl`, and
tab completion lists available `api` / `pb` methods. Use `--history-path` or
`--prompt` to customize the session:

```sh
permabrain shell --prompt "pb> " --history-path ~/.pb-history.jsonl
```

```javascript
import { createClient } from 'permabrain';
const client = createClient({ baseUrl: 'http://localhost:8765' });

await client.health();
const article = await client.get('person/ada-lovelace');
const { score } = await client.consensus('person/ada-lovelace');
```

## Local HTTP API

```sh
permabrain serve [--port 8765] [--stream-transport ws|sse] [--api-key <key>] [--cors-origin <origin>] [--access-log none|short|combined|json]
```

Exposes the agent API over REST.

### API-key Authentication

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

### CORS

By default `permabrain serve` sends open CORS headers (`Access-Control-Allow-Origin: *`) so browser viewers and SDK clients on other origins can call the API. Preflight `OPTIONS` requests are handled automatically.

Restrict to a single trusted origin:

```sh
permabrain serve --cors-origin http://trusted.example.com
PERMABRAIN_CORS_ORIGIN=http://trusted.example.com permabrain serve
```

When a specific origin is configured, the server only returns `Access-Control-Allow-Origin` for matching `Origin` headers.

### Rate Limiting

`permabrain serve` can apply a token-bucket rate limit per client to protect public endpoints:

```sh
permabrain serve --rate-limit 60 --rate-window 60000 --rate-burst 10
```

- `--rate-limit <max>` — allowed requests per window (default 60)
- `--rate-window <ms>` — sliding window in milliseconds (default 60000)
- `--rate-burst <n>` — extra burst capacity (default 10)

Set via environment variables:

```sh
PERMABRAIN_RATE_LIMIT=60
PERMABRAIN_RATE_WINDOW=60000
PERMABRAIN_RATE_BURST=10
```

When the limit is exceeded the server returns `429 Too Many Requests` with a `Retry-After` header. Rate-limit state is keyed by client IP; use `--trust-proxy` (or `PERMABRAIN_TRUST_PROXY=true`) when the server sits behind a reverse proxy so the `X-Forwarded-For` header is honored. Live event/stream routes (`/api/v1/events/stream`, `/api/v1/events/ws`, `/api/v1/articles/stream`) are exempt from HTTP rate limiting so long-lived connections are not disrupted.

### Request Logging / Access Logs

`permabrain serve` keeps a bounded in-memory ring buffer of recent HTTP requests and can optionally print structured access logs to the console:

```sh
# Print short access logs to the console
permabrain serve --access-log short

# Print combined (Common Log Format) access logs
permabrain serve --access-log combined

# Record full headers in the ring buffer (no console output)
permabrain serve --access-log json

# Disable recording entirely
permabrain serve --access-log none
```

Environment equivalents:

```sh
PERMABRAIN_ACCESS_LOG=short
PERMABRAIN_REQUEST_LOG_MAX_ENTRIES=5000
```

Inspect recent requests via the API. By default the endpoint returns the in-memory ring buffer. Add `?source=disk` to query persisted logs, and stream live entries with the SSE endpoint:

```sh
curl http://localhost:8765/api/v1/log/requests
# or markdown table
curl -H "Accept: text/markdown" http://localhost:8765/api/v1/log/requests?limit=20

# Query persisted disk log with filters and pagination
curl 'http://localhost:8765/api/v1/log/requests?source=disk&method=GET&status=200&limit=50'

# Live tail of new requests (SSE)
curl -H "Accept: text/event-stream" http://localhost:8765/api/v1/log/requests/stream
```

You can also query the local disk log from the CLI without a running server:

```sh
permabrain access-log --tail 20
permabrain access-log --method GET --status 200 --path /api/v1/articles
permabrain access-log --after 2026-06-18T00:00:00Z --limit 100 --json
```

Or stream live entries from a running server:

```sh
permabrain access-log --follow --url http://localhost:8765 --count 10
```

When the server has a home directory, successful requests are also appended to `logs/access-log.jsonl` as JSON lines. Rotated files are named `access-log.1.jsonl`, `access-log.2.jsonl`, etc. Control persistence with:

```sh
# Custom log directory and retention
PERMABRAIN_ACCESS_LOG_DIR=/var/log/permabrain \
PERMABRAIN_ACCESS_LOG_MAX_SIZE=10485760 \
PERMABRAIN_ACCESS_LOG_MAX_FILES=5 \
PERMABRAIN_ACCESS_LOG_RETENTION_DAYS=30 \
  permabrain serve
```

The web viewer has an **Audit** (👁) tab that renders the persisted access log with filters and an optional live tail.

Every response includes an `X-Request-ID` header. Pass `X-Request-ID` in a request to correlate server logs with client traces.

### Metrics and Monitoring

`permabrain serve` exposes runtime and aggregate metrics at `/api/v1/metrics`:

```sh
# JSON report (runtime counters + article/attestation totals)
curl http://localhost:8765/api/v1/metrics

# Prometheus-compatible exposition text
curl http://localhost:8765/api/v1/metrics?format=prometheus
```

The JSON report includes server uptime, request counts, HTTP status buckets, event counters, active stream connections, and the same data totals returned by `permabrain metrics`. Prometheus output exposes `permabrain_runtime_*`, `permabrain_articles_total`, `permabrain_attestations_total`, and related gauges.

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
- `GET /api/v1/log/requests` — recent HTTP request ring buffer (memory); add `?source=disk` to query persisted logs
- `GET /api/v1/log/requests/stream` — live Server-Sent Events tail of the access log
- `GET /api/v1/bundles` — export a single article bundle
- `POST /api/v1/bundles` — import an article bundle
- `GET /api/v1/export-all` — export all indexed articles as a bundle
- `GET /api/v1/history-export?key=...` — export a full version history bundle
- `POST /api/v1/history-import` — import a history bundle
- `POST /api/v1/completion` — generate a shell completion script
- `GET /api/v1/events/stream` — Server-Sent Events real-time stream
- `GET /api/v1/events/ws` — WebSocket real-time event stream
- `GET /api/v1/articles/stream` — live filtered article/attestation SSE stream

#### Route Discovery and OpenAPI

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
const recentRequests = await client.requests({ limit: 20, status: 500 });
const mdTable = await client.requestsMarkdown({ limit: 50 });
const importResult = await client.importBundle(bundle);
const historyResult = await client.importHistory(history);

// Generate a shell completion script
const { script } = await client.completion({ shell: 'bash' });
```

When `--api-key` is set on the server, discovery endpoints require the same key. Pass it with `--api-key` or `PERMABRAIN_API_KEY`.

Bundle import accepts `{ bundle, verify, skipDuplicates }` and history import accepts the same shape. Completion accepts `{ shell: 'bash' | 'zsh' | 'fish' }` and returns `{ script }`.

Run `permabrain serve --help` for details.

## Web Viewer

`permabrain serve` also serves a browser UI at `/` (open `http://localhost:8765/` after starting the server). The viewer is a single-file HTML app that works against the local HTTP API and requires no build step. It is also a Progressive Web App: open it on a mobile browser, use **Add to Home Screen**, and it installs `viewer/manifest.json` and `viewer/service-worker.mjs` for offline caching.

### Navigation and Layout

- **Sidebar** — search box, topic/author/date filters, sort controls, and toolbar buttons.
- **Mobile toggle** — on small screens the sidebar collapses behind a hamburger menu.
- **Theme toggle** — switch between light and dark mode (also configurable in Settings).
- **Copy link** button — copies a permalink to the current view, filters, selected article, and active tab to the clipboard.

### Views and Tabs

| Button | View | What it does |
|--------|------|--------------|
| 🏠 Home | Article directory | Browse, search, filter, and sort the local index. Click any article card to open a detail modal with content, metadata, attestations, and consensus. |
| 📊 Dashboard | Local dashboard | Fetches `/api/v1/dashboard` and shows stats, recent articles, activity feed, and audit-log tail. |
| 📈 Stats | Aggregate stats | Renders `/api/v1/metrics` data totals: article counts, attestations, top topics, and consensus distribution. |
| 👁 Audit | Request audit log | Shows the persisted HTTP access log (`/api/v1/log/requests`), with method/status/path filters and a live SSE tail. |
| 🔄 Compare | Diff / merge | Select a base and head article, view a unified diff with conflict markers, and preview or apply a merge. |
| 🔄 Import / Export | Data portability | Import bundles or history from files; export a single article, all articles, history, or the raw DataItem. |
| ✏️ Compose | Article editor | Write a new article in markdown with metadata fields, live preview, localStorage draft recovery, and one-click publish via `POST /api/v1/articles`. |
| 📤➕ Publish | Batch publish | Drag/drop or pick multiple markdown files, set batch metadata, preview the dry-run report, and publish the whole directory. |
| 🔧 Settings | Preferences | Transport (SSE / WebSocket), theme, default sort, results per page, and live-tail toggle. Persisted to localStorage and reflected in the URL. |
| 📈 Admin | Monitoring panel | Read-only server overview: status, runtime metrics, recent access-log entries, and audit-log tail. |

### Search, Filters, and Sorting

The Home view supports:

- **Search** — full-text search across article titles and content via `/api/v1/search`.
- **Topic dropdown** — auto-populated from the local index.
- **Date range** — filter articles published after/before a date.
- **Author** — filter by agent id.
- **Sort** — by date, title, consensus score, or canonical key.

All choices are encoded in the URL, so copying the link restores the exact filtered view on another device or after a refresh.

### Article Detail and Version History

Clicking an article card opens a modal with:

- Rendered markdown content
- Metadata (author, topic, kind, source URL/name, visibility, ANS-104 id)
- Attestation list with labels (valid, outdated, disputed, wrong) and confidence
- Consensus score
- **History** tab — every prior version fetched from `/api/v1/articles/:key/history`
- **Raw** tab — ANS-104 DataItem fallback and Viewblock/source links
- **Decrypt** panel — for encrypted articles, paste an X25519 seed to render plaintext locally (seed is never persisted or sent to the server)

### Live Streams

The viewer subscribes to live updates so the article list and counts refresh as articles or attestations are published:

- **SSE** — `/api/v1/articles/stream` (default, server-pushed events)
- **WebSocket** — same endpoint, upgraded to a WebSocket connection
- **Transport indicator** — shows which transport is active; click it to cycle preferences
- **Failover** — if one transport fails, the viewer reconnects and tries the other automatically

The server advertises its preferred transport in `/health`; the viewer defaults to the server preference unless the URL or Settings override it.

### Compose

The Compose view is a complete article editor:

- Markdown textarea with live preview
- Metadata inputs: topic, kind, language, source URL, source name, visibility
- Derived canonical-key hint that updates as you type
- `Authorization: Bearer <apiKey>` header field for protected servers
- **Publish** — POSTs to `/api/v1/articles`
- Drafts are saved to `localStorage` under `permabrain-compose-draft` and restored automatically
- Deep-linkable via `?view=compose`

### Batch Publish

The Publish view lets you publish many files at once:

- Drag-and-drop dropzone or multi-file picker
- Batch metadata: topic, kind, source URL/name, language, visibility, recursive option
- **Preview** — calls `/api/v1/publish-dir/preview` and renders a dry-run report
- **Publish** — calls `/api/v1/publish-dir` with files sent as inline `{ path, content }` arrays
- Inline report with succeeded/failed counts and per-file details
- Deep-linkable via `?view=publish`

### Import and Export

The Import / Export view consolidates data portability:

- **Export** — download an article bundle, all articles, history, or a raw DataItem as a browser Blob
- **Import** — pick a bundle or history file, preview the metadata summary, choose dry-run/preview, and POST to `/api/v1/bundles` or `/api/v1/history-import`
- Supports API-key auth for protected servers
- Active tab, export key, and export mode are restored from URL state

### Compare

The Compare view visualizes changes between two versions:

- Select a **base** and **head** article from dropdowns
- Rendered unified diff with hunks and conflict markers
- **Merge preview** and **apply merge** via `/api/v1/merge`
- Deep-linkable via `?view=compare&compareBase=...&compareHead=...`

### Settings

Open Settings to change:

- **Live transport** — SSE or WebSocket
- **Theme** — light, dark, or auto (follows system preference)
- **Default sort** — date, title, consensus, key
- **Results per page** — 5 to 1000
- **Live tail** — enable/disable automatic live-stream updates

Settings are saved to `localStorage` and reflected in URL query parameters. The viewer restores them on reload, and the URL takes precedence when sharing a link.

### Encrypted Articles in the Browser

Encrypted articles are rendered with a lock icon and a decrypt panel. Paste the X25519 seed once per session; the seed is kept in memory only. Decryption runs locally in `viewer/crypto.mjs` using libsodium-style X25519 + XSalsa20-Poly1305 via the browser Web Crypto APIs. The plaintext is never stored or transmitted.

### PWA / Offline Support

- `viewer/manifest.json` defines the app name, theme color, icons, and standalone display mode
- `viewer/service-worker.mjs` caches the app shell and key assets on install
- Offline loads serve the cached HTML; API calls naturally require the server to be reachable again
- The viewer scope is the `viewer/` directory, so deep links such as `?view=compare&compareBase=a&compareHead=b` survive install

## Multi-Agent Workflow Helpers

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

### Publish a directory of articles

```sh
# Publish all .md files in a directory (non-recursive)
permabrain publish-dir ./docs --kind subject --topic ai --source-url https://example.com/docs

# Recursively publish every markdown file under ./docs
permabrain publish-dir ./docs --recursive

# Preview what would be published without writing anything
permabrain publish-dir ./docs --dry-run --recursive --markdown

# Override frontmatter defaults for the whole batch
permabrain publish-dir ./wiki --recursive --kind subject --topic permabrain \
  --source-name "Community Wiki" --source-license "CC-BY-SA-4.0"
```

Each file's canonical key is derived from its path: subdirectories become the
`topic` unless overridden with `--topic`, and the filename becomes the slug.
Frontmatter inside each markdown file can override the key, kind, topic, or
title for individual files. Re-publishing the same directory updates version
history for articles whose content changed.

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

## Watching for Updates

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

// Publish every .md file in a directory
const batch = await api.publishDirectory('./docs', {
  recursive: true,
  kind: 'subject',
  topic: 'ai',
  sourceName: 'Docs',
  sourceLicense: 'CC-BY-SA-4.0'
});
console.log(batch.succeeded, batch.failed);
console.log(await api.publishDirectoryToMarkdown(batch));
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
const metrics = await client.metrics();           // JSON runtime + data metrics
const prom = await client.metrics({ format: 'prometheus' }); // Prometheus text

// Batch publish from an inline file batch or a server-local directory
const batch = await client.publishDirectory({
  dir: 'docs',
  recursive: true,
  kind: 'subject',
  topic: 'ai',
  sourceName: 'Docs',
  sourceLicense: 'CC-BY-SA-4.0'
});
console.log(batch.succeeded, batch.count);

// Dry-run preview without publishing
const preview = await client.previewDirectory({
  files: [
    { path: 'docs/overview.md', content: '# Overview\n...' }
  ],
  kind: 'subject',
  topic: 'ai'
});
console.log(preview.results.map((r) => r.key));

// Markdown report via Accept header
const reportMd = await client.publishDirectoryMarkdown({
  files: [
    { path: 'docs/overview.md', content: '# Overview\n...' }
  ]
});
```

The client mirrors the agent API surface and returns JSON responses from the REST endpoints. Every method rejects with `{ status, error }` when the server responds with a non-2xx status code.

See `src/agent-api.mjs` and `src/client.mjs` for the full method lists.

## Publishing the Package

To publish a new version to npm:

1. Run the full test suite: `npm test`
2. Bump the version: `npm version patch|minor|major`
3. Review the package contents: `npm pack --dry-run`
4. Publish a dry-run to check everything: `npm run publish:dry-run`
5. Publish: `npm publish --access public`

`package.json` `files` includes `src/`, `scripts/`, `viewer/`, `skills/`, `docs/`, `README.md`, `CHANGELOG.md`, `NEXT-STEPS.md`, and `package.json`. The `permabrain` bin entry points at `scripts/cli.mjs`.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to file issues, submit PRs, and set up a development environment.

## Code of Conduct

Please read and follow our [Code of Conduct](CODE_OF_CONDUCT.md) to keep this community welcoming for everyone.

## Security

If you find a security vulnerability, please see [SECURITY.md](SECURITY.md) for responsible disclosure. **Do not open a public issue for security concerns.**

## License

This project is [MIT licensed](LICENSE).
