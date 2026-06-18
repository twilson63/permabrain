#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'));

const COMMANDS = [
  'init',
  'probe',
  'probe-hyperbeam',
  'probe-devices',
  'publish',
  'publish-encrypted',
  'share-encrypted',
  'get-encrypted',
  'import-wikipedia',
  'query',
  'get',
  'attest',
  'consensus',
  'sync',
  'verify',
  'export-bundle',
  'export-all',
  'export-history',
  'import-bundle',
  'import-history',
  'fork',
  'list-forks',
  'merge',
  'attest-for-agent',
  'list-agents',
  'provision-agent',
  'batch-attest',
  'auto-import',
  'goal',
  'plan',
  'match',
  'deploy-consensus',
  'meta-info',
  'whois',
  'reference',
  'transport-status',
  'watch',
  'history',
  'diff',
  'status',
  'search',
  'topic',
  'activity',
  'list',
  'export-articles',
  'metrics',
  'stats',
  'config',
  'remote',
  'archive',
  'backup',
  'restore',
  'serve',
  'doctor',
  'log',
  'template',
  'dashboard',
  'client',
  'completion',
  'threshold-attest',
  'peer',
  'events',
  'query-stream',
  'subscribe'
];

// Alias support: map legacy/import-export subcommands to canonical names.
const THRESHOLD_SUBCOMMAND_ALIASES = {
  'export-envelope': 'export-envelope',
  'import-envelope': 'import-envelope',
  'create': 'create',
  'add-sig': 'add-sig',
  'finalize': 'finalize',
  'verify': 'verify',
  'import': 'import'
};

function printVersion() {
  console.log(pkg.version);
}

function printHelp(command = null) {
  if (!command) {
    console.log(`PermaBrain — public signed third brain v${pkg.version}

Usage:
  permabrain <command> [options]

Global options:
  --use-hyperbeam              Use HyperbeamTransport for this command
  --use-hyperbeam-reference    Create/update HyperBEAM article references

Commands:
  init                         Initialize local PermaBrain state
  probe                        Probe the configured PermaBrain transport
  probe-hyperbeam              Probe local HyperBEAM endpoints
  probe-devices                Probe all HyperBEAM device endpoints
  publish <file>               Publish a public knowledge article
  publish-encrypted <file>     Publish an encrypted knowledge article
  share-encrypted <file>       Share an encrypted article via ZenBin CAP page
  get-encrypted <key>          Fetch and decrypt an encrypted article
  import-wikipedia <title>     Import and publish a Wikipedia summary
  query                        Query public articles
  get <canonical-key>          Fetch latest article content
  attest <canonical-key>       Publish a signed validity attestation
  consensus <canonical-key>    Compute attestation consensus
  sync                         Sync local cache
  export-bundle                Export an article bundle (versions + attestations)
  export-all                   Export all indexed articles as a bundle
  import-bundle <file>         Import articles/attestations from a bundle file
  fork <source-key>            Fork an article into a new canonical key
  list-forks <source-key>      List forks of an article
  attest-for-agent             Attest on behalf of another agent
  list-agents                  List known external agents
  provision-agent              Generate identity for an external agent
  batch-attest                 Batch attest to multiple articles from a JSON file
  auto-import                  Auto-import articles from URLs via a JSON file
  goal <file>                  Parse a PRD/goal markdown file and generate a plan
  plan <file>                  Generate a PermaBrain plan JSON from a PRD/goal file
  match                        Query the HyperBEAM match device by tag key/value
  deploy-consensus             Deploy PermaBrain consensus Lua modules to HyperBEAM
  meta-info                    Show HyperBEAM node metadata
  whois <address>              Look up an agent identity on HyperBEAM
  reference <subcommand>         Manage HyperBEAM references (create|update|resolve)
  transport-status             Show transport metrics and circuit breaker state
  watch                        Poll transport for new articles/attestations
  history                      Lists the full version chain and attestation timeline for an article key
  diff                         Compare two article versions or local vs remote
  status                       Show working-state overview (articles, divergences, forks, merges)
  export-articles              Export a filtered article directory to JSON or markdown
  metrics                      Show aggregate article/attestation metrics
  stats                        Show dashboard-style aggregate overview
  config                       Get, set, validate, or inspect PermaBrain config
  remote                       Manage named remote endpoints
  archive                      Create an encrypted snapshot of the local PermaBrain home
  backup                       Manage timestamped backups (create/list/restore/prune)
  restore                      Restore a PermaBrain home from an encrypted snapshot
  serve [ --port N ] [--stream-transport ws|sse]
                             Start the local HTTP API server (default port 8765)
  doctor [--fix] [--json]      Validate local PermaBrain state and optionally repair it
  log [filters]                Query the local audit log
  template <file>              Publish an article from a markdown template
  dashboard                    Build a self-contained web dashboard snapshot
  client [action] [args]         HTTP client SDK for a permabrain serve instance
  completion <shell>           Generate shell completion script (bash|zsh|fish)
  validate <type> [path]         Validate article/attestation metadata against JSON Schema
  threshold-attest             Create/collect/finalize/share threshold multi-sig attestations
  peer                         Gossip-style peer sync (info|status|diff|pull|bundle|push)
  events [options]             Subscribe to real-time events from permabrain serve
  query-stream [options]       Subscribe to live filtered article/attestation updates
  subscribe <remote-url> [options]  Forward local events to a remote PermaBrain peer

Common examples:
  permabrain init
  permabrain import-wikipedia "Ada Lovelace" --kind person --topic computing
  permabrain query --topic computing
  permabrain get person/ada-lovelace
  permabrain attest person/ada-lovelace --valid --confidence 0.95 --reason "Source-backed"
  permabrain consensus person/ada-lovelace
  permabrain dashboard --output dashboard.html --publish
  permabrain log --tail 10
  permabrain serve --port 8765 --stream-transport ws
  permabrain serve --stream-transport sse
  permabrain events --events publish,attest --duration 30000
  permabrain validate article ./tags.json

Run 'permabrain <command> --help' for detailed command help.

Environment:
  PERMABRAIN_HOME              State directory (default: .permabrain)
  PERMABRAIN_TRANSPORT         Transport: local|hyperbeam|arweave
  PERMABRAIN_HYPERBEAM_URL     HyperBEAM node base URL (default http://localhost:10000)
  PERMABRAIN_HYPERBEAM_REFERENCES  Set 1 to enable reference creation by default

Run 'permabrain <command> --help' for command-specific help.`);
    return;
  }

  const help = {
    init: `Usage: permabrain init [--key-type arweave-rsa4096|ed25519] [--json]

Creates .permabrain/ or PERMABRAIN_HOME state, config, keys, identity-init event, cache, and logs. Defaults to arweave-rsa4096; can also use PERMABRAIN_KEY_TYPE=ed25519.`,
    probe: `Usage: permabrain probe [--use-hyperbeam] [--url http://localhost:10000] [--json]

Probes the configured PermaBrain transport (arweave/hyperbeam/local). Reports health, device availability, and whether the transport can upload/fetch/query. Use --use-hyperbeam to force a HyperBEAM probe.`,
    'probe-hyperbeam': `Usage: permabrain probe-hyperbeam [--url http://localhost:10000] [--json]

Checks local HyperBEAM health, GraphQL, upload, and fetch endpoints.`,
    publish: `Usage: permabrain publish [--use-hyperbeam] [--use-hyperbeam-reference] <file> --kind <kind> --topic <topic> [--key <key>] [--title <title>] [--source-url <url>] [--source-name <name>] [--language en] [--visibility public|encrypted|private] [--for <pubkey-1>[,<pubkey-2>...]] [--json]

Publishes a signed article DataItem. Use --visibility encrypted (or --publish encrypted) to encrypt the article; with --for, encrypt for specific X25519 public keys (author is included automatically). With --use-hyperbeam, routes the upload through the HyperBEAM ~bundler@1.0 device. With --use-hyperbeam-reference, also creates/updates a ~reference@1.0 pointer for the article key.`,
    'publish-encrypted': `Usage: permabrain publish-encrypted <file> --kind <kind> --topic <topic> --for <public-key-1>[,<public-key-2>...] [--key <key>] [--title <title>] [--source-url <url>] [--source-name <name>] [--language en] [--json]

Publishes an encrypted article readable only by recipients whose X25519 public keys are listed in --for. The author's derived encryption key is included automatically. Use --use-hyperbeam to route the upload through HyperBEAM.`,
    'share-encrypted': `Usage: permabrain share-encrypted <file> --kind <kind> --topic <topic> --for <public-key-1>[,<public-key-2>...] [--recipient-key-id <fingerprint>|--recipient <jwk>] [--key <key>] [--title <title>] [--source-url <url>] [--source-name <name>] [--source-license <license>] [--language en] [--also-publish] [--page-id <id>] [--subdomain <name>] [--key-id <id>] [--private-jwk <json>] [--output <path>] [--json]

Encrypt an article for specific X25519 recipients and publish a self-contained
share page to ZenBin with a CAP recipient. The page embeds the encrypted
envelope and an in-browser decryption helper. Only the intended CAP recipient
can view the page on ZenBin; the encrypted content can be decrypted locally
with the recipient's X25519 seed.

ZenBin credentials are read from the workspace TOOLS.md by default, or override
with --key-id and --private-jwk (JSON string). Use --recipient-key-id or
--recipient to set the CAP recipient fingerprint. Use --also-publish to also
publish the article as a PermaBrain DataItem to the configured transport.

Use --output to write the HTML page locally without publishing to ZenBin.
`,
  'get-encrypted': `Usage: permabrain get-encrypted <canonical-key> [--seed <base64url-seed>] [--seed-file <path>] [--use-hyperbeam] [--json]

Fetches an encrypted article and decrypts it. If --seed/--seed-file is omitted, the author's X25519 seed is derived from the current ed25519 identity. Outputs the plaintext content by default, or a JSON envelope with --json.`,
    'import-wikipedia': `Usage: permabrain import-wikipedia "<title>" --kind <kind> --topic <topic> [--language en] [--json]

Fetches a Wikipedia summary, generates sourced markdown, and publishes it. With --use-hyperbeam, routes the upload through the HyperBEAM ~bundler@1.0 device. With --use-hyperbeam-reference, also creates/updates a ~reference@1.0 pointer for the article key.`,
    query: `Usage: permabrain query [--use-hyperbeam] [--topic <topic>] [--kind <kind>] [--key <key>] [--source-name <name>] [--source-url <url>] [--json]

Queries public articles by tags. With --use-hyperbeam, queries via the ~query@1.0 device first, falling back to GraphQL.`,
    get: `Usage: permabrain get [--use-hyperbeam] <canonical-key> [--json]

Fetches latest article content by canonical key and verifies content hash. With --use-hyperbeam, resolves through HyperBEAM reference and tag query first.`,
    attest: `Usage: permabrain attest [--use-hyperbeam] [--use-hyperbeam-reference] <canonical-key> --valid|--invalid|--partially-valid|--outdated|--disputed --confidence <0..1> --reason <text> [--source-url <url>] [--json]

Publishes a signed attestation against the latest article version. With --use-hyperbeam, uploads through HyperBEAM; --use-hyperbeam-reference updates the article's reference pointer if configured.`,
    consensus: `Usage: permabrain consensus [--use-hyperbeam] <canonical-key> [--json]

Aggregates attestations and computes MVP consensus score. With --use-hyperbeam, resolves the article and its attestations via HyperBEAM first.`,
    sync: `Usage: permabrain sync [--use-hyperbeam] [--no-auto-merge] [--dry-run] [--json]

Queries articles and attestations and writes local cache index. With --use-hyperbeam, uses HyperBEAM query/GraphQL.

By default, divergent versions of the same article key are auto-merged via a
three-way line-level merge when a common ancestor exists. Use --no-auto-merge
to keep the legacy sync behavior. Use --dry-run to preview what would be
merged without publishing.`,
    'attest-for-agent': `Usage: permabrain attest-for-agent <canonical-key> --identity-file <path> --valid|--invalid|--partially-valid|--outdated|--disputed --confidence <0..1> --reason <text> [--source-url <url>] [--json]

Creates and uploads an attestation signed by an external agent's identity.
The identity file should be a JSON file with the agent's keys (ed25519 or arweave).`,
    'list-agents': `Usage: permabrain list-agents [--json]

Lists known external PermaBrain agents (Sage, Relay, etc.).`,
    'provision-agent': `Usage: permabrain provision-agent <name> [--key-type ed25519] [--json]

Generates a provisional identity for an external agent. The secret key is shown once — store securely!`,
    'batch-attest': `Usage: permabrain batch-attest --file <path> [--use-hyperbeam] [--json]

Batch attest to multiple articles from a JSON file.
The file should contain a JSON array of objects:
  [{"key": "subject/ai", "opinion": "valid", "confidence": 0.9, "reason": "Accurate"}, ...]

With --use-hyperbeam, each attestation uploads via the HyperBEAM ~bundler@1.0 device.
Each attestation is processed independently — failures don't block others.`,
    'auto-import': `Usage: permabrain auto-import --file <path> [--use-hyperbeam] [--use-hyperbeam-reference] [--json]

Auto-import articles from URLs and publish to PermaBrain.
The file should contain a JSON array of objects:
  [{"url": "https://...", "kind": "subject", "topic": "ai"}, ...]

With --use-hyperbeam, each article uploads via the HyperBEAM ~bundler@1.0 device.
With --use-hyperbeam-reference, also creates/updates ~reference@1.0 pointers.
Each URL is fetched, HTML is stripped to text, and the result is published.
Title is derived from content or URL if not provided.`,
    'goal': `Usage: permabrain goal <file> [--topic <topic>] [--kind <kind>] [--plan] [--import] [--json]

Parses a PRD or goal markdown file and turns it into a PermaBrain workflow.

Options:
  --topic <topic>   Override inferred topic for generated articles
  --kind <kind>     Override inferred article kind
  --plan            Output a JSON plan (default)
  --import          Output the auto-import articles array
  --batch-attest    Output the batch attestation spec
  --execute         Execute the workflow via the agent API (init, auto-import,
                    publish step articles, batch-attest). Requires network.

Without --execute, the command only prints the generated workflow. Use --json
for machine-readable output.`,
    'plan': `Usage: permabrain plan <file> [--topic <topic>] [--kind <kind>] [--json]

Alias for 'permabrain goal <file> --plan'. Generates a PermaBrain plan JSON
from a PRD/goal markdown file.`,
    'probe-devices': `Usage: permabrain probe-devices [--url http://localhost:10000] [--json]

Probes all HyperBEAM device endpoints used by PermaBrain:
health, bundler, fetch, query, match, meta, and GraphQL.`,
    'match': `Usage: permabrain match --key <tag-name> --value <tag-value> [--url http://localhost:10000] [--json]

Queries the HyperBEAM ~match@1.0 device for messages containing
a specific tag key-value pair. Returns matching message IDs.`,
    'deploy-consensus': `Usage: permabrain deploy-consensus [--url http://localhost:10000] [--json]

Deploys the PermaBrain consensus and query Lua modules to a
HyperBEAM node via the bundler device. Returns module IDs.`,
    'meta-info': `Usage: permabrain meta-info [--url http://localhost:10000] [--json]

Fetches HyperBEAM node metadata from the ~meta@1.0/info device.`,
    'whois': `Usage: permabrain whois <address> [--url http://localhost:10000] [--json]

Looks up an agent identity via the HyperBEAM ~whois@1.0 device.`,
    'watch': `Usage: permabrain watch [--use-hyperbeam] [--topic <topic>] [--kind <kind>] [--key <key>] [--interval <seconds>] [--once] [--json]

Polls the configured transport for new articles and attestations. On first run it records all currently visible items as "seen" so only subsequent new items are reported.

Options:
  --use-hyperbeam    Poll HyperBEAM instead of the default transport
  --topic <topic>    Filter articles by topic
  --kind <kind>      Filter articles by kind
  --key <key>        Filter articles/attestations by canonical key
  --interval <sec>   Seconds between polls (default 30)
  --once             Run a single poll and exit
  --json             Output events as newline-delimited JSON`,
  'reference': `Usage: permabrain reference <subcommand> [args] [--url http://localhost:10000] [--json]

Manage HyperBEAM ~reference@1.0 pointers.

Subcommands:
  reference create <key=value>...        Create a new reference with given values
  reference update <ref-id> <key=value>...  Update an existing reference
  reference resolve <ref-id> [path]     Resolve a reference (optionally with sub-path)

Examples:
  permabrain reference create article-key=subject/foo current-version=abc123
  permabrain reference update refId123 current-version=def456
  permabrain reference resolve refId123 article-key`,
  'transport-status': `Usage: permabrain transport-status [--json]

Show transport metrics and circuit breaker state.
Reports call counts, successes, failures, latency summaries (p50/p95/p99),
and per-operation circuit breaker status for Arweave/HyperBEAM transports.`,
  'verify': `Usage: permabrain verify <id-or-key> [--use-hyperbeam] [--attestations] [--no-verify-chain] [--no-verify-target] [--json]

Verifies a DataItem signature, canonical key, derived key consistency,
content hash, and optional version chain. For attestations, verifies that
the target article exists and that the target key matches.

Options:
  --attestations       Include consensus summary for articles
  --no-verify-chain    Skip resolving the previous version chain
  --no-verify-target   Skip resolving attestation target article
  --json               Output structured verification report`,
  'history': `Usage: permabrain history <canonical-key> [--use-hyperbeam] [--no-consensus] [--json]

Lists the full version chain and attestation timeline for an article key.

The output includes every published version (version number, id, title,
content hash, source, author, timestamp) and every attestation cast against
any version of the key (opinion, confidence, reason, agent, target version).
By default a consensus summary for the latest version is included; use
--no-consensus to skip it. Use --json for machine-readable output.

Options:
  --use-hyperbeam      Resolve history via HyperBEAM transport
  --no-consensus       Skip computing the consensus summary
  --json               Output structured history report`,
  'diff': `Usage: permabrain diff <base> <head> [--use-hyperbeam] [--json] [--format unified|json] [--context N] [--no-preview]
       permabrain diff <canonical-key> --local [--json] [--format unified|json] [--context N]

Compare two article versions and emit a unified diff.

Identifiers can be DataItem IDs or canonical article keys. If two keys are
provided, their latest versions are compared. With a single canonical key and
--local, the local cached/last-synced version is compared against the latest
remote version.

By default a three-way conflict preview is computed when a common ancestor is
available. Use --no-preview to skip it.

Options:
  --use-hyperbeam      Resolve identifiers via HyperBEAM transport
  --json               Output structured diff report (implies --format json)
  --format             Output format: unified (default) or json
  --context N          Context lines around each hunk (default 3)
  --no-preview         Skip three-way conflict preview
  --local              Compare local vs remote for a single key`,
  'status': `Usage: permabrain status [--use-hyperbeam] [--json]

Show a working-state overview of the local PermaBrain node.

Reports local articles, remote latest versions, pending sync divergences,
fork heads, merge/conflict status, transport health, circuit breakers,
and transport metrics.

Options:
  --use-hyperbeam      Query remote state via HyperBEAM transport
  --json               Output structured status report`,
  'export-bundle': `Usage: permabrain export-bundle <canonical-key> [--id <id>] [--no-attestations] [--no-versions] [--output <path>] [--json]

Exports a single article, its version chain, and attestations into a
self-contained PermaBrain bundle JSON. Use --id to export by DataItem ID
instead of canonical key. By default both attestation and version data are
included; use --no-attestations/--no-versions to omit them.`,
  'export-history': `Usage: permabrain export-history <canonical-key> [--output <path>] [--no-verify] [--no-exporter] [--use-hyperbeam] [--json]

Exports a single article's full version chain plus all attestations against
any version as a deterministic, verifiable bundle. Articles are sorted by
version ascending; attestations are sorted by DataItem ID. Each entry is a
raw signed ANS-104 DataItem that importBundle() can verify and submit.

The resulting bundle has type 'history' and includes a deterministic meta
block (sourceKey, rootId, latestId, versionRange, entry counts). Use
--no-verify to skip local signature checks before export. Use --no-exporter
to omit the exporting agent id from meta.`,
  'fork': `Usage: permabrain fork <source-key> [--key <new-key>] [--slug <slug>] [--title <title>] [--content <text>] [--topic <topic>] [--kind <kind>] [--source-url <url>] [--source-name <name>] [--source-license <license>] [--language <lang>] [--target-id <id>] [--use-hyperbeam] [--use-hyperbeam-reference] [--json]

Creates a new version branch from an existing article. The fork is published
under a new canonical key, starting its own version chain at v1, while
tagging the original source key and DataItem ID for provenance
(Article-Fork-Of and Article-Fork-Source-Id tags).

The source article is unchanged. If no --key/--slug is provided, the fork key
is derived from the source title plus '-vN-fork'. Edits override source
metadata: --title, --content, --topic, --kind, --source-url, etc.

Options:
  --key <key>            Explicit canonical key for the fork (must differ from source)
  --slug <slug>          Suffix slug used to derive the fork key
  --title <title>        Override article title
  --content <text>       Override article content (otherwise copied from source)
  --topic <topic>        Override article topic
  --kind <kind>          Override article kind
  --source-url <url>     Override source URL
  --source-name <name>   Override source display name
  --source-license <l>   Override source license
  --language <lang>      Override language (default from source)
  --target-id <id>       Fork a specific source version instead of the latest
  --use-hyperbeam        Upload via HyperBEAM bundler
  --use-hyperbeam-reference  Create/update HyperBEAM reference for the fork`,
  'merge': `Usage: permabrain merge <target-key> <source-key> [--title <title>] [--topic <topic>] [--kind <kind>] [--source-url <url>] [--source-name <name>] [--source-license <license>] [--language <lang>] [--no-carry-attestations] [--use-hyperbeam] [--use-hyperbeam-reference] [--json]

Merges a source article fork into the target article's version branch.

Performs a three-way line-level merge using the common ancestor (resolved via
fork lineage tags or shared version chain). Non-conflicting changes are
applied automatically; conflicts are left as standard conflict markers in the
merged content. A new version of the target article is published with merge
provenance tags (Article-Merge-Source-Key, Article-Merge-Source-Id, etc.).

By default, attestations from the source's latest version are re-cast against
the new merged target version. Use --no-carry-attestations to disable this.

Options:
  --title <title>           Override merged article title
  --topic <topic>           Override merged article topic
  --kind <kind>             Override merged article kind
  --source-url <url>        Override merged source URL
  --source-name <name>      Override merged source display name
  --source-license <l>      Override merged source license
  --language <lang>         Override merged language
  --no-carry-attestations   Do not re-attest source attestations to the merged version
  --use-hyperbeam           Upload merged article via HyperBEAM bundler
  --use-hyperbeam-reference Create/update HyperBEAM reference for the target key`,
  'list-forks': `Usage: permabrain list-forks <source-key> [--use-hyperbeam] [--json]

Lists all articles that declare themselves forks of the given source key by
the Article-Fork-Of tag.`,
  'export-all': `Usage: permabrain export-all [--no-attestations] [--output <path>] [--json]

Exports every article found in the local index plus its version chain and
attestations. The output is a bundle JSON optimized for full snapshots or
cross-agent sharing.`,
  'import-bundle': `Usage: permabrain import-bundle <file> [--no-verify] [--no-skip-duplicates] [--use-hyperbeam] [--json]

Imports articles and attestations from a PermaBrain bundle file. Each entry
is verified (unless --no-verify is passed), signatures are checked, and
duplicates are skipped by default. Use --use-hyperbeam to submit through a
HyperBEAM node.`,
  'import-history': `Usage: permabrain import-history <file> [--no-verify] [--no-skip-duplicates] [--json]

Imports a history bundle produced by export-history into the local store.
Articles are replayed in version order so the version chain is preserved;
attestations are imported after articles. Each entry is verified by default
(unless --no-verify is passed), and duplicates are skipped.`,
  'search': `Usage: permabrain search <query> [--kind <kind>] [--topic <topic>] [--author <agent-id>] [--key <key>] [--after <iso-date>] [--before <iso-date>] [--limit N] [--offset N] [--use-hyperbeam] [--json]

Full-text search across article titles, topics, keys, source names, and
plaintext content.

Performs relevance ranking (title > topic > key > source > content) and
returns snippets, match terms, and encrypted-article flags. Results are
merged from remote transport and the local cache, with the latest version per
canonical key. Use filters to narrow by kind, topic, author, key, or date
range.

Options:
  --kind <kind>        Filter by article kind
  --topic <topic>      Filter by topic
  --author <agent-id>  Filter by author agent id
  --key <key>          Filter by exact canonical key
  --after <date>       Only include articles updated on or after this ISO date
  --before <date>      Only include articles updated on or before this ISO date
  --limit N            Maximum results (default 20)
  --offset N           Pagination offset (default 0)
  --use-hyperbeam      Search via HyperBEAM transport
  --json               Output structured search report`,
  'topic': `Usage: permabrain topic <topic> [--kind <kind>] [--language <lang>] [--author <agent-id>|attested-by:<agent-id>] [--sort date|consensus|title|attestations] [--limit N] [--offset N] [--no-attestations] [--use-hyperbeam] [--json]

Topic feed: list articles tagged with a topic, sorted by date, consensus,
title, or attestation count.

By default each article includes a consensus summary (number of attestations,
latest opinion/confidence, score). Use --no-attestations to skip consensus
enrichment and run faster.

The --author filter accepts either an agent id (only articles authored by that
agent) or 'attested-by:<agent-id>' (only articles attested by that agent).

Options:
  --kind <kind>        Filter by article kind
  --language <lang>    Filter by language code
  --author <agent-id>  Filter by author or attesting agent
  --sort <criterion>   Sort: date (default), consensus, title, attestations
  --limit N            Maximum results (default 50)
  --offset N           Pagination offset (default 0)
  --no-attestations    Do not compute consensus per article
  --use-hyperbeam      Query via HyperBEAM transport
  --json               Output structured JSON instead of markdown`,
  'activity': `Usage: permabrain activity [--topic <topic>] [--kind <kind>] [--key <key>] [--agent <agent-id>] [--author <agent-id>] [--attested-by <agent-id>] [--event-kind publish|attest|fork|merge] [--after <iso-date>] [--before <iso-date>] [--order asc|desc] [--limit N] [--offset N] [--use-hyperbeam] [--json]

Chronological activity feed combining article publish, attestation, fork, and
merge events from the transport and local cache.

Filters narrow the feed by article topic/kind/key, participating agent,
event kind, or date range. By default results are sorted newest-first.

Options:
  --topic <topic>      Filter by article topic
  --kind <kind>        Filter by article kind
  --key <key>          Filter by canonical key
  --agent <agent-id>   Filter by any participating agent
  --author <agent-id>  Filter publish events by author
  --attested-by <id>   Filter by attesting agent (attest/fork/merge events)
  --event-kind <kind>  Filter by event kind (publish, attest, fork, merge)
  --after <date>       Only events on or after this ISO date
  --before <date>      Only events on or before this ISO date
  --order asc|desc     Sort order (default desc)
  --limit N            Maximum results (default 100)
  --offset N           Pagination offset (default 0)
  --use-hyperbeam      Query via HyperBEAM transport
  --json               Output structured JSON instead of markdown`,
  'list': `Usage: permabrain list [--kind <kind>] [--topic <topic>] [--author <agent-id>] [--after <iso-date>] [--before <iso-date>] [--sort date|title|consensus|attestations|key] [--limit N] [--offset N] [--use-hyperbeam] [--json]

Read-only paginated article directory listing the local cache and, when
available, the configured transport.

Filters narrow by article kind, topic, author, or date range. Sorting
supports date (default), title, consensus score, attestation count, or
key. Each article includes its version, attestation count, consensus, and
activity counters (publish/attest/fork/merge).

Options:
  --kind <kind>        Filter by article kind
  --topic <topic>      Filter by topic
  --author <agent-id>  Filter by author agent id
  --after <date>       Only articles updated on or after this ISO date
  --before <date>      Only articles updated on or before this ISO date
  --sort <criterion>   Sort: date (default), title, consensus, attestations, key
  --limit N            Maximum results (default 50)
  --offset N           Pagination offset (default 0)
  --use-hyperbeam      Query via HyperBEAM transport
  --json               Output structured JSON instead of markdown`,
    'export-articles': `Usage: permabrain export-articles [--kind <kind>] [--topic <topic>] [--author <agent-id>] [--after <iso-date>] [--before <iso-date>] [--sort date|title|consensus|attestations|key] [--limit N] [--offset N] [--format json|markdown] [--output <path>] [--use-hyperbeam] [--json]

Export a filtered, sorted article directory to JSON or markdown.

Reuses the list command logic, so all filters, sorting, pagination, and
per-article counts (attestations, consensus, activity) are preserved. By
default prints markdown; use --format json or --json for structured output.
With --output, writes the result to a file instead of stdout.

Options:
  --kind <kind>        Filter by article kind
  --topic <topic>      Filter by topic
  --author <agent-id>  Filter by author agent id
  --after <date>       Only articles updated on or after this ISO date
  --before <date>      Only articles updated on or before this ISO date
  --sort <criterion>   Sort: date (default), title, consensus, attestations, key
  --limit N            Maximum results (default 50)
  --offset N           Pagination offset (default 0)
  --format <fmt>       Output format: json or markdown (default markdown)
  --output <path>      Write result to file instead of stdout
  --use-hyperbeam      Query via HyperBEAM transport
  --json               Force JSON output (also sets format to json)`,
    'metrics': `Usage: permabrain metrics [--kind <kind>] [--topic <topic>] [--author <agent-id>] [--after <iso-date>] [--before <iso-date>] [--top N] [--json]

Show aggregate article and attestation metrics from the local cache.

Reports article counts, attestations, opinion distribution, top-attested
articles, activity timeline, and per-kind/topic/author breakdowns. Filters
narrow the dataset the same way as the list command.

Options:
  --kind <kind>        Filter by article kind
  --topic <topic>      Filter by topic
  --author <agent-id>  Filter by author agent id
  --after <date>       Only articles updated on or after this ISO date
  --before <date>      Only articles updated on or before this ISO date
  --top N              Number of top-attested articles (default 10)
  --json               Output structured JSON instead of markdown`,
    'stats': `Usage: permabrain stats [--kind <kind>] [--topic <topic>] [--author <agent-id>] [--after <iso-date>] [--before <iso-date>] [--top N] [--json]

Show a dashboard-style aggregate overview of the local PermaBrain.

Reports total articles, attestations, unique agents, topics, kinds,
consensus score distribution, average/median consensus, active windows,
activity timeline, and top agents/articles. Filters narrow the dataset the
same way as the metrics command.

Options:
  --kind <kind>        Filter by article kind
  --topic <topic>      Filter by topic
  --author <agent-id>  Filter by author agent id
  --after <date>       Only articles updated on or after this ISO date
  --before <date>      Only articles updated on or before this ISO date
  --top N              Number of top entries per leaderboard (default 10)
  --json               Output structured JSON instead of markdown`,
    'config': `Usage: permabrain config [get|set|validate|env|reset] [path] [value] [--json]

Manage PermaBrain configuration.

Subcommands:
  config get [path]            Show all config or a specific dotted path
  config set <path> <value>    Set a dotted config path
  config validate              Validate current configuration
  config env                   Show environment variables and their current values
  config reset                 Reset config.json to defaults

Examples:
  permabrain config get transport
  permabrain config set transport hyperbeam
  permabrain config set gateway.dataUrl http://localhost:10000
  permabrain config validate
  permabrain config env`,
    'remote': `Usage: permabrain remote <action> [name] [url] [--transport local|arweave|hyperbeam] [--graphql-url <url>] [--data-url <url>] [--upload-url <url>] [--hyperbeam-references] [--description <text>] [--json]

Manage named remote endpoints stored in remotes.json.

Actions:
  remote list                  List all remotes and the default
  remote add <name> <url>      Add a new remote (url may be base or graphql)
  remote remove <name>         Remove a remote
  remote default <name>        Set the default remote
  remote probe [name]          Probe a remote (default if omitted)

Options:
  --transport <type>           Transport: local, arweave, or hyperbeam
  --graphql-url <url>          Override GraphQL endpoint
  --data-url <url>             Override data gateway endpoint
  --upload-url <url>           Override bundler upload endpoint
  --hyperbeam-references       Enable HyperBEAM reference creation for this remote
  --description <text>         Optional description`,
    'archive': `Usage: permabrain archive --passphrase <text> [--recipient <key>] [--output <path>] [--dry-run] [--json]

Create an encrypted snapshot of the local PermaBrain home.

The archive includes keys.json, identity-init.json, config.json, cache/index.json,
and all cache/objects/*.json files. Plaintext cache/pages/*.md files are deliberately
excluded. The archive is encrypted using X25519 ECDH + AES-256-GCM.

By default a passphrase-derived key is added so the same passphrase can restore later.
Additional --recipient X25519 public keys can be provided for escrow or migration.
Use --output to write to a file; otherwise the archive JSON is printed.`,
    'restore': `Usage: permabrain restore <file> [--passphrase <text>] [--seed <base64url-seed>] [--home <path>] [--dry-run] [--json]

Restore a PermaBrain home from an encrypted archive snapshot.

The passphrase must match the one used when creating the archive. If --seed is
provided, it is used as the X25519 seed directly. The current identity's derived
encryption key is tried as a fallback. Use --dry-run to validate decryption without
writing files.`,
    'backup': `Usage: permabrain backup [create|list|restore|prune] [args] [--passphrase <text>] [--backup <name|index>] [--keep N] [--max-age-days D] [--name <filename>] [--dry-run] [--json]

Manage timestamped full-home backup snapshots.

Subcommands:
  backup create [--passphrase <text>] [--name <filename>]
    Create a new encrypted backup and store it in PERMABRAIN_HOME/backups.
  backup list
    List stored backups (newest first).
  backup restore <name|index> [--passphrase <text>] [--dry-run]
    Restore the current home from a stored backup by filename or 1-based index.
  backup prune [--keep N] [--max-age-days D] [--dry-run]
    Delete old backups, keeping the newest N and/or removing backups older than D days.

Options:
  --passphrase <text>    Passphrase for create or restore
  --name <filename>      Override backup filename for create (must end in .json)
  --backup <name|index>  Backup selector for restore
  --keep N               Number of newest backups to keep (default 10)
  --max-age-days D        Also delete backups older than D days
  --dry-run               Preview without creating/deleting files
  --json                  Output structured JSON`,
    'serve': `Usage: permabrain serve [--port N] [--stream-transport ws|sse]

Start the local HTTP API server exposing the PermaBrain agent API over REST.
Default port is 8765 (override with --port or PERMABRAIN_PORT env var).
Default live stream transport is SSE (override with --stream-transport or
PERMABRAIN_STREAM_TRANSPORT env var). The viewer can also override transport
via the ?transport=ws|sse URL parameter.

Press Ctrl+C to stop.`,
    'doctor': `Usage: permabrain doctor [--fix] [--json]

Validate the local PermaBrain state (config, identity, cache index, object files)
and report any issues. With --fix, attempts safe auto-repairs: recreates missing
config.json, rebuilds a stale index from cache/objects, and restores a missing
identity-init.json when keys.json is present.`,
    'log': `Usage: permabrain log [filters] [--tail [N]] [--follow] [--interval N] [--markdown] [--json]
       permabrain log export [--jsonl] [--output <path>] [--json]
       permabrain log import <file> [--skip-duplicates] [--json]

Query, tail, follow, export, or import the local audit log.

The audit log is local-only and separate from the transport activity feed.
It records actions like publish, attest, fork, merge, import, export, init,
and identity events, along with their status and metadata.

Subcommands:
  log export                   Export the full audit log as JSON (or JSONL with --jsonl)
  log import <file>              Import an audit-log bundle or JSONL file

Query/tail/follow options:
  --action <action>    Filter by action name (comma-separated for multiple)
  --status <status>    Filter by status: ok, error, pending
  --key <key>          Filter by canonical article key
  --agent <agent-id>   Filter by agent id
  --after <date>       Only events on or after this ISO date
  --before <date>       Only events on or before this ISO date
  --search <term>      Substring search across action/key/message/details
  --order asc|desc     Sort order (default desc)
  --limit N            Maximum results (default 50)
  --offset N           Pagination offset (default 0)
  --tail [N]           Show the N most recent events (default 10)
  --follow             Stream new log entries until interrupted
  --interval N         Follow polling interval in seconds (default 1)
  --markdown           Render results as markdown
  --json               Output structured JSON`,
    'template': `Usage: permabrain template <file> [--source <source>] [--topic <topic>] [--kind <kind>] [--title <title>] [--key <key>] [--app <app>] [--source-url <url>] [--variables <json>] [--encrypt] [--recipient <key>]... [--use-hyperbeam] [--use-hyperbeam-reference] [--json]

Publish an article from a markdown template with optional YAML frontmatter.
Templates may use {{variable}} placeholders, which are substituted from the
frontmatter and from --variables JSON. The resulting article is published via
the standard article pipeline, including transport and encryption support.

Options:
  --source <source>    Inline template source (alternative to <file>)
  --topic <topic>      Article topic (default from frontmatter or 'general')
  --kind <kind>        Article kind (default from frontmatter or 'article')
  --title <title>      Article title (default from frontmatter)
  --key <key>          Override canonical key
  --app <app>          App tag (default 'PermaBrain')
  --source-url <url>   Source URL tag (default 'template://local')
  --variables <json>   JSON object of {{var}} substitutions
  --encrypt            Encrypt the article for the author plus --recipient keys
  --recipient <key>    X25519 public key to encrypt for (repeatable)
  --use-hyperbeam      Upload via HyperBEAM bundler
  --use-hyperbeam-reference  Create/update HyperBEAM reference
  --json               Output structured JSON instead of summary`,
    'dashboard': `Usage: permabrain dashboard [--kind <kind>] [--topic <topic>] [--author <agent-id>] [--key <key>] [--agent <agent-id>] [--after <date>] [--before <date>] [--sort date|title|consensus|attestations] [--order asc|desc] [--article-limit N] [--activity-limit N] [--log-limit N] [--output <path>] [--title <title>] [--publish] [--page-id <id>] [--recipient-key-id <fingerprint>|--recipient <jwk>] [--subdomain <name>] [--key-id <id>] [--private-jwk <json>] [--markdown] [--json] [--use-hyperbeam]

Build a self-contained snapshot of local PermaBrain state.

By default prints a markdown summary. Use --output dashboard.html to write a
single HTML file with embedded CSS/JS that can be opened in a browser or
published to ZenBin. Use --json for the raw dashboard data.

Use --publish to upload the HTML snapshot to ZenBin as a live page. Credentials
are read from the workspace TOOLS.md ZenBin section by default, or override with
--key-id and --private-jwk (JSON string). Use --page-id to set a stable URL slug,
or omit it for an auto-generated id. Use --recipient-key-id or --recipient to send
a CAP-directed dashboard to another agent.

The dashboard includes:
  - stats overview (articles, attestations, agents, topics, active windows)
  - searchable/filterable article directory
  - activity feed timeline (publish, attest, fork, merge)
  - audit log tail
  - identity and transport metadata

Options:
  --kind <kind>          Filter articles/activity by kind
  --topic <topic>        Filter by topic
  --author <id>         Filter by author agent id
  --key <key>           Filter activity by canonical key
  --agent <id>          Filter activity by participating agent
  --after <date>        Only include items updated on or after this ISO date
  --before <date>        Only include items updated on or before this ISO date
  --sort <criterion>    Article sort: date (default), title, consensus, attestations
  --order asc|desc      Sort order (default desc)
  --article-limit N       Max articles in the directory (default 50)
  --activity-limit N      Max activity events (default 50)
  --log-limit N           Max audit-log entries (default 25)
  --output <path>       Write HTML snapshot to a file
  --title <title>       Override dashboard title
  --publish             Publish the HTML snapshot to ZenBin
  --page-id <id>        Stable ZenBin page id (auto-generated by default)
  --recipient-key-id <fingerprint>  CAP recipient fingerprint for directed content
  --recipient <jwk>     Recipient public JWK; fingerprint is computed automatically
  --subdomain <name>    Publish into a claimed ZenBin subdomain
  --key-id <id>         Override ZenBin key id
  --private-jwk <json>  Override ZenBin private JWK (JSON string)
  --markdown              Output markdown instead of the default summary
  --json                  Output structured JSON dashboard data
  --use-hyperbeam         Query via HyperBEAM transport`,
    'client': `Usage: permabrain client [health|status|get|query|publish] [args] [--url <base-url>] [--json]

HTTP client SDK command for interacting with a running permabrain serve instance.
This is a thin convenience wrapper over the typed SDK in src/client.mjs; it is
useful for quick remote checks and shell scripts.

Actions:
  client health                       GET /health
  client status                       GET /api/v1/status
  client get <key>                    GET /api/v1/articles/:key
  client query [--topic <topic>] [--kind <kind>] [--key <key>]
  client publish <file> --kind <kind> --topic <topic> --source-url <url>

Options:
  --url <base-url>    Server base URL (default http://localhost:8765)
  --use-hyperbeam     Pass useHyperbeam=true to the server
  --json              Output structured JSON`,
    'completion': `Usage: permabrain completion <shell>

Generate a shell completion script for bash, zsh, or fish.

Examples:
  permabrain completion bash > /etc/bash_completion.d/permabrain
  permabrain completion zsh > "${'${fpath[1]}'}/_permabrain"
  permabrain completion fish > ~/.config/fish/completions/permabrain.fish

Install to your shell and reload, or source the generated script in your rc file.`,
    'threshold-attest': `Usage: permabrain threshold-attest <subcommand> [args]

Create/collect/finalize threshold multi-sig attestations.

Subcommands:
  create <key> --opinion <opinion> --confidence <0-1> --reason <reason>
         --threshold <n> --co-signers <id1,id2,...> [--source-url <url>]
         [--target-id <id>] [--output <path>]
         Create a threshold envelope and output it (JSON or file).
  add-sig <envelope-path> --agent-id <id> --signature <base64url>
         [--signature-type ed25519|arweave-rsa4096] [--public-key <base64url>]
         Add a co-signer signature to the envelope.
  finalize <envelope-path> [--use-hyperbeam]
         Verify threshold, publish the multi-sig attestation, and remove
         the envelope file on success.
  verify <envelope-path>
         Verify all co-signer signatures and print threshold status.
  import <envelope-path>
         Load a shared envelope into the in-memory pending map.
  export-envelope <envelopeId> [--output <path>]
         Export a pending envelope to JSON (stdout or file) for sharing.
  import-envelope <envelope-path>
         Alias for import — load a shared envelope into the pending map.

Examples:
  permabrain threshold-attest create subject/ai --valid --confidence 0.95 \\
      --reason "Cross-checked" --threshold 2 --co-signers sage,relay --output env.json
  permabrain threshold-attest finalize env.json
  permabrain threshold-attest export-envelope 0e567ba2-... --output env.json
  permabrain threshold-attest import-envelope env.json
`,
    'events': `Usage: permabrain events [options]

Subscribe to real-time events from a running permabrain serve instance.
Events include publish, attest, fork, merge, import, export, backup, and init.

Options:
  --url <url>            Server base URL (default http://localhost:8765)
  --ws                   Use WebSocket instead of Server-Sent Events
  --events <names>       Comma-separated event filter (e.g. publish,attest)
  --json                 Print each event as JSON
  --compact              Print compact one-line events (default)
  --duration <ms>        Stop after N milliseconds
  --count <n>            Stop after receiving N events

Examples:
  permabrain events
  permabrain events --url http://localhost:9000 --events publish,attest
  permabrain events --ws --json --duration 30000
`,
    'query-stream': `Usage: permabrain query-stream [options]

Subscribe to a live filtered stream of article/attestation updates from a
running permabrain serve instance.

Filters:
  --topic <topic>          Article topic
  --kind <kind>            Article kind
  --agent <agent-id>       Author or attesting agent id
  --key <canonical-key>    Specific article key
  --events <names>         Comma-separated event names (publish, attest, ...)

Connection:
  --url <url>              Server base URL (default http://localhost:8765)
  --ws                     Use WebSocket instead of SSE

Termination:
  --duration <ms>          Stop after N milliseconds
  --count <n>              Stop after receiving N events

Output:
  --json                   Print each event as JSON
  --compact                Print compact one-line events (default)

Examples:
  permabrain query-stream --topic ai --events publish,attest
  permabrain query-stream --kind subject --agent ed25519:a --duration 30000 --json
`,
    'validate': `Usage: permabrain validate <article|attestation> [path] [--json]

Validate article or attestation metadata (flat tags or DataItem tag array)
against the PermaBrain JSON Schema. If [path] is omitted, validates a
built-in example.

The file may be either a flat JSON object of tag name/value pairs or an
ANS-104-style DataItem with a { tags: [{ name, value }, ...] } array.

Examples:
  permabrain validate article ./tags.json
  permabrain validate attestation ./dataitem.json --json
`
  };
  console.log(help[command] || `Unknown command: ${command}`);
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token.startsWith('--')) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) args[key] = true;
      else { args[key] = next; i++; }
    } else args._.push(token);
  }
  return args;
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (!command || command === '--help' || command === '-h') {
    printHelp();
    return;
  }
  if (command === '--version' || command === '-v') {
    printVersion();
    return;
  }
  if (!COMMANDS.includes(command)) {
    console.error(`Unknown command: ${command}\n`);
    printHelp();
    process.exitCode = 1;
    return;
  }
  const args = parseArgs(rest);
  // Handle threshold-attest aliases directly so --help and dispatch work cleanly.
  if (command === 'threshold-attest' && args._[0]) {
    const canonical = THRESHOLD_SUBCOMMAND_ALIASES[args._[0]];
    if (canonical) args._[0] = canonical;
  }
  if (args.help || args.h) {
    printHelp(command);
    return;
  }
  const { runCommand } = await import('../src/commands.mjs');
  await runCommand(command, args);
}

main().catch((err) => {
  console.error(err?.message || String(err));
  process.exitCode = 1;
});