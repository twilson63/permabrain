#!/usr/bin/env node

const COMMANDS = [
  'init',
  'probe',
  'probe-hyperbeam',
  'probe-devices',
  'publish',
  'publish-encrypted',
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
  'import-bundle',
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
  'search'
];

function printHelp(command = null) {
  if (!command) {
    console.log(`PermaBrain — public signed third brain

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
  if (!COMMANDS.includes(command)) {
    console.error(`Unknown command: ${command}\n`);
    printHelp();
    process.exitCode = 1;
    return;
  }
  const args = parseArgs(rest);
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