/**
 * PermaBrain shell completion generators
 *
 * Provides completion scripts for bash, zsh, and fish.
 * Usage:
 *   permabrain completion bash > /etc/bash_completion.d/permabrain
 *   permabrain completion zsh > "${fpath[1]}/_permabrain"
 *   permabrain completion fish > ~/.config/fish/completions/permabrain.fish
 */

export const COMMANDS = [
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
  'threshold-attest'
];

export const GLOBAL_OPTIONS = [
  '--help',
  '--h',
  '--json',
  '--use-hyperbeam',
  '--use-hyperbeam-reference'
];

export const COMMAND_OPTIONS = {
  init: ['--key-type'],
  probe: ['--url'],
  'probe-hyperbeam': ['--url'],
  'probe-devices': ['--url'],
  publish: ['--kind', '--topic', '--key', '--title', '--source-url', '--source-name', '--language', '--visibility', '--for'],
  'publish-encrypted': ['--kind', '--topic', '--key', '--title', '--source-url', '--source-name', '--language', '--for'],
  'get-encrypted': ['--seed', '--seed-file'],
  'import-wikipedia': ['--kind', '--topic', '--language'],
  query: ['--topic', '--kind', '--key', '--source-name', '--source-url'],
  get: ['--json'],
  attest: ['--valid', '--invalid', '--partially-valid', '--outdated', '--disputed', '--confidence', '--reason', '--source-url'],
  consensus: ['--json'],
  sync: ['--no-auto-merge', '--dry-run'],
  verify: ['--attestations', '--no-verify-chain', '--no-verify-target'],
  'export-bundle': ['--id', '--no-attestations', '--no-versions', '--output'],
  'export-history': ['--output', '--no-verify', '--no-exporter'],
  'export-all': ['--no-attestations', '--output'],
  'import-bundle': ['--no-verify', '--no-skip-duplicates'],
  'import-history': ['--no-verify', '--no-skip-duplicates'],
  fork: ['--key', '--slug', '--title', '--content', '--topic', '--kind', '--source-url', '--source-name', '--source-license', '--language', '--target-id'],
  'list-forks': ['--json'],
  merge: ['--title', '--topic', '--kind', '--source-url', '--source-name', '--source-license', '--language', '--no-carry-attestations'],
  'attest-for-agent': ['--identity-file', '--valid', '--invalid', '--partially-valid', '--outdated', '--disputed', '--confidence', '--reason', '--source-url'],
  'list-agents': ['--json'],
  'provision-agent': ['--key-type'],
  'batch-attest': ['--file'],
  'auto-import': ['--file'],
  goal: ['--topic', '--kind', '--plan', '--import', '--batch-attest', '--execute'],
  plan: ['--topic', '--kind', '--json'],
  match: ['--key', '--value', '--url'],
  'deploy-consensus': ['--url'],
  'meta-info': ['--url'],
  whois: ['--url'],
  reference: [],
  'transport-status': ['--json'],
  watch: ['--topic', '--kind', '--key', '--interval', '--once'],
  history: ['--no-consensus'],
  diff: ['--format', '--context', '--no-preview', '--local'],
  status: ['--json'],
  search: ['--kind', '--topic', '--author', '--key', '--after', '--before', '--limit', '--offset'],
  topic: ['--kind', '--language', '--author', '--sort', '--limit', '--offset', '--no-attestations'],
  activity: ['--topic', '--kind', '--key', '--agent', '--author', '--attested-by', '--event-kind', '--after', '--before', '--order', '--limit', '--offset'],
  list: ['--kind', '--topic', '--author', '--after', '--before', '--sort', '--limit', '--offset'],
  'export-articles': ['--kind', '--topic', '--author', '--after', '--before', '--sort', '--limit', '--offset', '--format', '--output'],
  metrics: ['--kind', '--topic', '--author', '--after', '--before', '--top'],
  stats: ['--kind', '--topic', '--author', '--after', '--before', '--top'],
  config: [],
  remote: ['--transport', '--graphql-url', '--data-url', '--upload-url', '--hyperbeam-references', '--description'],
  archive: ['--passphrase', '--recipient', '--output', '--dry-run'],
  restore: ['--passphrase', '--seed', '--home', '--dry-run'],
  backup: ['--passphrase', '--backup', '--keep', '--max-age-days', '--name', '--dry-run'],
  serve: ['--port'],
  doctor: ['--fix'],
  log: ['--action', '--status', '--key', '--agent', '--after', '--before', '--search', '--order', '--limit', '--offset', '--tail', '--follow', '--interval', '--markdown'],
  template: ['--source', '--topic', '--kind', '--title', '--key', '--app', '--source-url', '--variables', '--encrypt', '--recipient'],
  dashboard: ['--kind', '--topic', '--author', '--key', '--agent', '--after', '--before', '--sort', '--order', '--article-limit', '--activity-limit', '--log-limit', '--output', '--title', '--publish', '--page-id', '--recipient-key-id', '--recipient', '--subdomain', '--key-id', '--private-jwk', '--markdown'],
  threshold: ['--opinion', '--confidence', '--reason', '--source-url', '--target-id'],
  'threshold-attest': ['--opinion', '--confidence', '--reason', '--source-url', '--target-id', '--threshold', '--co-signers', '--output', '--signature', '--signature-type', '--public-key', '--agent-id'],
  client: ['--url'],
  completion: []
};

function bashCommandCase() {
  const cases = [];
  for (const cmd of COMMANDS) {
    const opts = (COMMAND_OPTIONS[cmd] || []).map(o => `'${o}'`).join(' ');
    cases.push(`    ${cmd})
      COMPREPLY=( $(compgen -W "${opts}" -- "\${CURR_WORD}") )
      return 0
      ;;`);
  }
  return cases.join('\n');
}

export function generateBash() {
  return `#!/usr/bin/env bash
# PermaBrain bash completion
# Generated by 'permabrain completion bash'

_permabrain_completion() {
  local cur prev words cword
  _init_completion || return

  local CURR_WORD="\${cur}"
  local PREV_WORD="\${prev}"
  local CMD=""
  local i
  for (( i=1; i < cword; i++ )); do
    local w="\${words[i]}"
    if [[ ! "\${w}" =~ ^- ]]; then
      CMD="\${w}"
      break
    fi
  done

  if [ -z "\${CMD}" ]; then
    if [[ "\${CURR_WORD}" == -* ]]; then
      COMPREPLY=( $(compgen -W "${GLOBAL_OPTIONS.join(' ')}" -- "\${CURR_WORD}") )
    else
      COMPREPLY=( $(compgen -W "${COMMANDS.join(' ')}" -- "\${CURR_WORD}") )
    fi
    return 0
  fi

  case "\${CMD}" in
${bashCommandCase()}
    *)
      COMPREPLY=()
      ;;
  esac
}

complete -F _permabrain_completion permabrain
`;
}

export function generateZsh() {
  const commandSpecs = COMMANDS.map(cmd => {
    const opts = (COMMAND_OPTIONS[cmd] || []).map(o => `'(${o})${o}[${o} option]:value:'`).join('\n      ');
    return `  ${cmd}: '${cmd} command'\n    ${opts ? opts + '\n    ' : ''}_arguments -S -s \
      ${(COMMAND_OPTIONS[cmd] || []).map(o => `{${o}}`).join(' ')}`;
  }).join('\n\n');

  return `#compdef permabrain
# PermaBrain zsh completion
# Generated by 'permabrain completion zsh'

local curcontext="$curcontext" state line
_typeset -a args

args=(
  '1: :->command'
  '*:: :->args'
)

_arguments -C -S -s "$args[@]" && return 0

case "$state" in
  command)
    _alternative 'commands:PermaBrain command:(${COMMANDS.join(' ')})
                'options:global option:(${GLOBAL_OPTIONS.map(o => o.replace(/^--/, '')).join(' ')})
    ;;
  args)
    case "$line[1]" in
${COMMANDS.map(cmd => `      ${cmd})
        ${(COMMAND_OPTIONS[cmd] || []).map(o => `_arguments "${o}(${o}):value:"`).join('\n        ') || '_files'}
        ;;`).join('\n')}
    esac
    ;;
esac
`;
}

export function generateFish() {
  const lines = [
    '# PermaBrain fish completion',
    "# Generated by 'permabrain completion fish'",
    ''
  ];

  // Global command completion
  lines.push(`complete -c permabrain -n '__fish_use_subcommand' -a '${COMMANDS.join(' ')}' -d 'PermaBrain command'`);
  lines.push(`complete -c permabrain -n '__fish_seen_subcommand_from ${COMMANDS.join(' ')}' -l help -s h -d 'Show help'`);
  lines.push(`complete -c permabrain -n '__fish_seen_subcommand_from ${COMMANDS.join(' ')}' -l json -d 'Output JSON'`);
  lines.push(`complete -c permabrain -n '__fish_seen_subcommand_from ${COMMANDS.join(' ')}' -l use-hyperbeam -d 'Use HyperBEAM transport'`);
  lines.push(`complete -c permabrain -n '__fish_seen_subcommand_from ${COMMANDS.join(' ')}' -l use-hyperbeam-reference -d 'Create HyperBEAM references'`);

  for (const cmd of COMMANDS) {
    const opts = COMMAND_OPTIONS[cmd] || [];
    if (opts.length === 0) {
      // Ensure every command has at least a completion guard even with no options
      lines.push(`complete -c permabrain -n '__fish_seen_subcommand_from ${cmd}' -d '${cmd} command'`);
    }
    for (const opt of opts) {
      lines.push(`complete -c permabrain -n '__fish_seen_subcommand_from ${cmd}' -l ${opt.slice(2)} -d '${cmd} option'`);
    }
  }

  return lines.join('\n') + '\n';
}

/**
 * Generate a completion script for the requested shell.
 * @param {'bash'|'zsh'|'fish'} shell
 * @returns {string}
 */
export function generateCompletion(shell) {
  switch (shell) {
    case 'bash': return generateBash();
    case 'zsh': return generateZsh();
    case 'fish': return generateFish();
    default: throw new Error(`Unsupported shell: ${shell}. Supported: bash, zsh, fish`);
  }
}

export function listSupportedShells() {
  return ['bash', 'zsh', 'fish'];
}
