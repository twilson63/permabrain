#!/usr/bin/env node

const COMMANDS = [
  'init',
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
  'whois'
];

function printHelp(command = null) {
  if (!command) {
    console.log(`PermaBrain — public signed third brain

Usage:
  permabrain <command> [options]

Commands:
  init                         Initialize local PermaBrain state
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

Environment:
  PERMABRAIN_HOME              State directory (default: .permabrain)
  PERMABRAIN_TRANSPORT         Transport: local|hyperbeam|arweave
  PERMABRAIN_HYPERBEAM_URL     HyperBEAM node base URL (default http://localhost:10000)

Run 'permabrain <command> --help' for command-specific help.`);
    return;
  }

  const help = {
    init: `Usage: permabrain init [--key-type arweave-rsa4096|ed25519] [--json]

Creates .permabrain/ or PERMABRAIN_HOME state, config, keys, identity-init event, cache, and logs. Defaults to arweave-rsa4096; can also use PERMABRAIN_KEY_TYPE=ed25519.`,
    'probe-hyperbeam': `Usage: permabrain probe-hyperbeam [--url http://localhost:10000] [--json]

Checks local HyperBEAM health, GraphQL, upload, and fetch endpoints.`,
    publish: `Usage: permabrain publish <file> --kind <kind> --topic <topic> [--key <key>] [--title <title>] [--source-url <url>] [--source-name <name>] [--language en] [--json]

Publishes a signed public article DataItem.`,
    'import-wikipedia': `Usage: permabrain import-wikipedia "<title>" --kind <kind> --topic <topic> [--language en] [--json]

Fetches a Wikipedia summary, generates sourced markdown, and publishes it.`,
    query: `Usage: permabrain query [--topic <topic>] [--kind <kind>] [--key <key>] [--source-name <name>] [--source-url <url>] [--json]

Queries public articles by tags.`,
    get: `Usage: permabrain get <canonical-key> [--json]

Fetches latest article content by canonical key and verifies content hash.`,
    attest: `Usage: permabrain attest <canonical-key> --valid|--invalid|--partially-valid|--outdated|--disputed --confidence <0..1> --reason <text> [--source-url <url>] [--json]

Publishes a signed attestation against the latest article version.`,
    consensus: `Usage: permabrain consensus <canonical-key> [--json]

Aggregates attestations and computes MVP consensus score.`,
    sync: `Usage: permabrain sync [--json]

Queries articles and attestations and writes local cache index.`,
    'attest-for-agent': `Usage: permabrain attest-for-agent <canonical-key> --identity-file <path> --valid|--invalid|--partially-valid|--outdated|--disputed --confidence <0..1> --reason <text> [--source-url <url>] [--json]

Creates and uploads an attestation signed by an external agent's identity.
The identity file should be a JSON file with the agent's keys (ed25519 or arweave).`,
    'list-agents': `Usage: permabrain list-agents [--json]

Lists known external PermaBrain agents (Sage, Relay, etc.).`,
    'provision-agent': `Usage: permabrain provision-agent <name> [--key-type ed25519] [--json]

Generates a provisional identity for an external agent. The secret key is shown once — store securely!`,
    'batch-attest': `Usage: permabrain batch-attest --file <path> [--json]

Batch attest to multiple articles from a JSON file.
The file should contain a JSON array of objects:
  [{"key": "subject/ai", "opinion": "valid", "confidence": 0.9, "reason": "Accurate"}, ...]

Each attestation is processed independently — failures don't block others.`,
    'auto-import': `Usage: permabrain auto-import --file <path> [--json]

Auto-import articles from URLs and publish to PermaBrain.
The file should contain a JSON array of objects:
  [{"url": "https://...", "kind": "subject", "topic": "ai"}, ...]

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

Looks up an agent identity via the HyperBEAM ~whois@1.0 device.`
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