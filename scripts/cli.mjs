#!/usr/bin/env node

const COMMANDS = [
  'init',
  'probe-hyperbeam',
  'publish',
  'import-wikipedia',
  'query',
  'get',
  'attest',
  'consensus',
  'sync',
  'ao-sync',
  'ao-query',
  'ao-get',
  'ao-consensus'
];

function printHelp(command = null) {
  if (!command) {
    console.log(`PermaBrain — public signed third brain

Usage:
  permabrain <command> [options]

Commands:
  init                         Initialize local PermaBrain state
  probe-hyperbeam              Probe local HyperBEAM endpoints
  publish <file>               Publish a public knowledge article
  import-wikipedia <title>     Import and publish a Wikipedia summary
  query                        Query public articles
  get <canonical-key>          Fetch latest article content
  attest <canonical-key>       Publish a signed validity attestation
  consensus <canonical-key>    Compute attestation consensus
  sync                         Sync local cache
  ao-sync                      Bootstrap AO process from Arweave data
  ao-query                     Query articles via AO process (dryrun)
  ao-get                       Get article metadata via AO process (dryrun)
  ao-consensus                 Compute consensus via AO process (dryrun)

Environment:
  PERMABRAIN_HOME              State directory (default: .permabrain)
  PERMABRAIN_TRANSPORT         Transport: local|hyperbeam|arweave|ao|composite
  PERMABRAIN_AO_PROCESS_ID    AO process ID for ao/composite transport

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
    'ao-sync': `Usage: permabrain ao-sync [--json]

Bootstraps the AO process with articles and attestations from Arweave.
Requires PERMABRAIN_AO_PROCESS_ID to be set.`,
    'ao-query': `Usage: permabrain ao-query [--topic <topic>] [--kind <kind>] [--key <key>] [--source-name <name>] [--json]

Queries articles via AO dryrun (instant, free). Falls back to Arweave GraphQL.`,
    'ao-get': `Usage: permabrain ao-get <canonical-key> [--json]

Gets article metadata from the AO process via dryrun.`,
    'ao-consensus': `Usage: permabrain ao-consensus <canonical-key> [--json]

Computes attestation consensus score from the AO process via dryrun.`
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