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
  'sync'
];

function printHelp(command = null) {
  if (!command) {
    console.log(`PermaBrain — public signed third brain\n\nUsage:\n  permabrain <command> [options]\n\nCommands:\n  init                         Initialize local PermaBrain state\n  probe-hyperbeam              Probe local HyperBEAM endpoints\n  publish <file>               Publish a public knowledge article\n  import-wikipedia <title>     Import and publish a Wikipedia summary\n  query                        Query public articles\n  get <canonical-key>          Fetch latest article content\n  attest <canonical-key>       Publish a signed validity attestation\n  consensus <canonical-key>    Compute attestation consensus\n  sync                         Sync local cache\n\nRun 'permabrain <command> --help' for command-specific help.`);
    return;
  }

  const help = {
    init: `Usage: permabrain init [--key-type arweave-rsa4096|ed25519] [--json]\n\nCreates .permabrain/ or PERMABRAIN_HOME state, config, keys, identity-init event, cache, and logs. Defaults to arweave-rsa4096; can also use PERMABRAIN_KEY_TYPE=ed25519.`,
    'probe-hyperbeam': `Usage: permabrain probe-hyperbeam [--url http://localhost:10000] [--json]\n\nChecks local HyperBEAM health, GraphQL, upload, and fetch endpoints.`,
    publish: `Usage: permabrain publish <file> --kind <kind> --topic <topic> [--key <key>] [--title <title>] [--source-url <url>] [--source-name <name>] [--language en] [--json]\n\nPublishes a signed public article DataItem.`,
    'import-wikipedia': `Usage: permabrain import-wikipedia "<title>" --kind <kind> --topic <topic> [--language en] [--json]\n\nFetches a Wikipedia summary, generates sourced markdown, and publishes it.`,
    query: `Usage: permabrain query [--topic <topic>] [--kind <kind>] [--key <key>] [--source-name <name>] [--source-url <url>] [--json]\n\nQueries public articles by tags.`,
    get: `Usage: permabrain get <canonical-key> [--json]\n\nFetches latest article content by canonical key and verifies content hash.`,
    attest: `Usage: permabrain attest <canonical-key> --valid|--invalid|--partially-valid|--outdated|--disputed --confidence <0..1> --reason <text> [--source-url <url>] [--json]\n\nPublishes a signed attestation against the latest article version.`,
    consensus: `Usage: permabrain consensus <canonical-key> [--json]\n\nAggregates attestations and computes MVP consensus score.`,
    sync: `Usage: permabrain sync [--json]\n\nQueries articles and attestations and writes local cache index.`
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
