#!/usr/bin/env node

const COMMANDS = [
  'init',
  'probe',
  'probe-hyperbeam',
  'probe-devices',
  'publish',
  'import-wikipedia',
  'query',
  'get',
  'attest',
  'consensus',
  'sync',
  'attest-for-agent',
  'list-agents',
  'provision-agent',
  'batch-attest',
  'auto-import',
  'match',
  'deploy-consensus',
  'meta-info',
  'whois',
  'reference',
  'watch'
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
  import-wikipedia <title>     Import and publish a Wikipedia summary
  query                        Query public articles
  get <canonical-key>          Fetch latest article content
  attest <canonical-key>       Publish a signed validity attestation
  consensus <canonical-key>    Compute attestation consensus
  sync                         Sync local cache
  attest-for-agent             Attest on behalf of another agent
  list-agents                  List known external agents
  provision-agent              Generate identity for an external agent
  batch-attest                 Batch attest to multiple articles from a JSON file
  auto-import                  Auto-import articles from URLs via a JSON file
  match                        Query the HyperBEAM match device by tag key/value
  deploy-consensus             Deploy PermaBrain consensus Lua modules to HyperBEAM
  meta-info                    Show HyperBEAM node metadata
  whois <address>              Look up an agent identity on HyperBEAM
  reference <subcommand>         Manage HyperBEAM references (create|update|resolve)
  watch                        Poll transport for new articles/attestations

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
    publish: `Usage: permabrain publish [--use-hyperbeam] [--use-hyperbeam-reference] <file> --kind <kind> --topic <topic> [--key <key>] [--title <title>] [--source-url <url>] [--source-name <name>] [--language en] [--json]

Publishes a signed public article DataItem. With --use-hyperbeam, routes the upload through the HyperBEAM ~bundler@1.0 device. With --use-hyperbeam-reference, also creates/updates a ~reference@1.0 pointer for the article key.`,
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
    sync: `Usage: permabrain sync [--use-hyperbeam] [--json]

Queries articles and attestations and writes local cache index. With --use-hyperbeam, uses HyperBEAM query/GraphQL.`,
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
  permabrain reference resolve refId123 article-key`
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