import { initState, loadConfig, getHome, defaultConfig } from './config.mjs';
import { ensureIdentity, publicIdentity } from './keys.mjs';
import { HyperbeamTransport } from './transport.mjs';
import { getArticle, publishArticle, queryArticles, syncArticlesAndAttestations } from './article.mjs';
import { importWikipediaArticle } from './wikipedia.mjs';
import { attestArticle, opinionFromArgs } from './attestation.mjs';
import { attestForAgent, provisionAgentIdentity, parseAttestationRequest, processProxyAttestation, buildAttestationRequestBody, listKnownAgents, getKnownAgent } from './multi-agent.mjs';
import { consensusForArticle } from './consensus.mjs';
import { loadIdentity } from './keys.mjs';
import { getTransport } from './transport.mjs';
import { HyperbeamQuery } from './hb-query.mjs';
import { HyperbeamConsensus } from './hb-consensus.mjs';
import { DEVICES, bundlerUploadUrl } from './hb-devices.mjs';

import fs from 'node:fs';

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

export async function runCommand(command, args) {
  if (command === 'init') return initCommand(args);
  if (command === 'probe-hyperbeam') return probeHyperbeamCommand(args);
  if (command === 'publish') return publishCommand(args);
  if (command === 'import-wikipedia') return importWikipediaCommand(args);
  if (command === 'query') return queryCommand(args);
  if (command === 'get') return getCommand(args);
  if (command === 'attest') return attestCommand(args);
  if (command === 'consensus') return consensusCommand(args);
  if (command === 'sync') return syncCommand(args);
  if (command === 'attest-for-agent') return attestForAgentCommand(args);
  if (command === 'list-agents') return listAgentsCommand(args);
  if (command === 'provision-agent') return provisionAgentCommand(args);
  if (command === 'batch-attest') return batchAttestCommand(args);
  if (command === 'auto-import') return autoImportCommand(args);
  if (command === 'probe-devices') return probeDevicesCommand(args);
  if (command === 'match') return matchCommand(args);
  if (command === 'deploy-consensus') return deployConsensusCommand(args);
  if (command === 'meta-info') return metaInfoCommand(args);
  if (command === 'whois') return whoisCommand(args);
  if (command === 'reference') return referenceCommand(args);
  throw new Error(`Command '${command}' is planned but not implemented yet.`);
}

async function initCommand(args) {
  const { home, createdConfig } = initState();
  const { identity, created, identityInitPath, identityInitCreated } = await ensureIdentity(home, { keyType: args['key-type'] || process.env.PERMABRAIN_KEY_TYPE || 'arweave-rsa4096' });
  const result = {
    home,
    config: createdConfig ? 'created' : 'existing',
    identity: created ? 'created' : 'existing',
    agentId: identity.agentId,
    keyType: identity.type,
    identityInitEvent: identityInitPath,
    identityInit: identityInitCreated ? 'created' : 'existing'
  };
  if (args.json) printJson(result);
  else {
    console.log(`PermaBrain initialized at ${home}`);
    console.log(`Config: ${result.config}`);
    console.log(`Identity: ${result.identity}`);
    console.log(`Agent: ${publicIdentity(identity).agentId}`);
    console.log(`Key Type: ${identity.type}`);
    console.log(`Identity Init Event: ${identityInitPath}`);
  }
  return result;
}

async function probeHyperbeamCommand(args) {
  const home = getHome();
  let config;
  try { config = loadConfig(home); } catch { config = { gateway: { dataUrl: args.url || 'http://localhost:10000', graphqlUrl: `${args.url || 'http://localhost:10000'}/graphql` }, bundler: { uploadUrl: `${args.url || 'http://localhost:10000'}/~bundler@1.0/tx?codec-device=ans104@1.0` } }; }
  if (args.url) {
    config.gateway = { ...(config.gateway || {}), dataUrl: args.url, graphqlUrl: `${args.url}/graphql` };
    config.bundler = { ...(config.bundler || {}), uploadUrl: `${args.url}/~bundler@1.0/tx?codec-device=ans104@1.0` };
  }
  const transport = new HyperbeamTransport(config);
  const result = await transport.probe(args.url || config.gateway.dataUrl);
  if (args.json) printJson(result);
  else {
    console.log(`HyperBEAM probe: ${result.url}`);
    for (const check of result.checks) {
      console.log(`${check.ok ? 'ok' : 'fail'} ${check.name} ${check.status || check.error || ''}`.trim());
    }
  }
  if (!result.ok && process.env.PERMABRAIN_REQUIRE_HYPERBEAM === '1') throw new Error('HyperBEAM probe failed');
  return result;
}

async function publishCommand(args) {
  const file = args._[0];
  if (!file) throw new Error('publish requires <file>');
  const result = await publishArticle({
    file,
    kind: args.kind,
    topic: args.topic,
    key: args.key,
    title: args.title,
    sourceUrl: args['source-url'],
    sourceName: args['source-name'],
    sourceLicense: args['source-license'] || '',
    language: args.language || 'en'
  });
  if (args.json) printJson(result.summary);
  else {
    console.log(`Published ${result.summary.key}`);
    console.log(`ID: ${result.summary.id}`);
    console.log(`Version: ${result.summary.version}`);
  }
  return result;
}

async function importWikipediaCommand(args) {
  const title = args._[0];
  const result = await importWikipediaArticle({ title, kind: args.kind, topic: args.topic, language: args.language || 'en' });
  if (args.json) printJson(result.summary);
  else {
    console.log(`Imported Wikipedia article ${result.summary.key}`);
    console.log(`ID: ${result.summary.id}`);
    console.log(`Version: ${result.summary.version}`);
  }
  return result;
}

async function queryCommand(args) {
  const articles = await queryArticles({
    topic: args.topic,
    kind: args.kind,
    key: args.key,
    sourceName: args['source-name'],
    sourceUrl: args['source-url']
  });
  if (args.json) printJson(articles);
  else {
    if (!articles.length) console.log('No articles found.');
    for (const article of articles) console.log(`${article.key}\tv${article.version}\t${article.title}\t${article.topic}`);
  }
  return articles;
}

async function getCommand(args) {
  const key = args._[0];
  if (!key) throw new Error('get requires <canonical-key>');
  const result = await getArticle(key);
  if (args.json) printJson({ ...result.summary, content: result.content });
  else process.stdout.write(result.content);
  return result;
}

async function attestCommand(args) {
  const key = args._[0];
  if (!key) throw new Error('attest requires <canonical-key>');
  const opinion = opinionFromArgs(args);
  const result = await attestArticle({ key, opinion, confidence: args.confidence, reason: args.reason, sourceUrl: args['source-url'] || '', targetId: args['target-id'] });
  if (args.json) printJson(result.summary);
  else {
    console.log(`Attested ${result.summary.targetKey}: ${result.summary.opinion} (${result.summary.confidence})`);
    console.log(`ID: ${result.summary.id}`);
  }
  return result;
}

async function consensusCommand(args) {
  const key = args._[0];
  if (!key) throw new Error('consensus requires <canonical-key>');
  const result = await consensusForArticle(key);
  if (args.json) printJson(result);
  else {
    console.log(`${result.key}: ${result.status}`);
    console.log(`Latest: ${result.latestArticleId || 'unknown'}`);
    console.log(`Attestations: ${result.totalAttestations}`);
    console.log(`Score: ${result.score}`);
  }
  return result;
}

async function syncCommand(args) {
  const index = await syncArticlesAndAttestations();
  if (args.json) printJson(index);
  else {
    console.log(`Synced ${Object.keys(index.articles).length} articles and ${Object.values(index.attestations).reduce((n, xs) => n + xs.length, 0)} attestations.`);
  }
  return index;
}

// AO commands removed — PermaBrain now uses Arweave GraphQL + local cache directly.
// See docs/refactor-ao-to-research-publish.md for rationale.

async function attestForAgentCommand(args) {
  const key = args._[0];
  if (!key) throw new Error('attest-for-agent requires <canonical-key>');
  const agentName = args.agent;
  if (!agentName) throw new Error('--agent is required (agent name or identity JSON path)');

  let agentIdentity;
  const fs = await import('fs');
  const agentPath = args['identity-file'];
  if (agentPath && fs.existsSync(agentPath)) {
    agentIdentity = JSON.parse(fs.readFileSync(agentPath, 'utf8'));
  } else {
    throw new Error('Agent identity required. Use --identity-file <path> to provide an agent keys.json file.');
  }

  const opinion = opinionFromArgs(args);
  const result = await attestForAgent({
    agentIdentity,
    key,
    opinion,
    confidence: args.confidence,
    reason: args.reason,
    sourceUrl: args['source-url'] || '',
    targetId: args['target-id']
  });

  if (args.json) printJson(result);
  else {
    console.log(`Attested ${result.targetKey}: ${result.opinion} (${result.confidence})`);
    console.log(`Agent: ${result.agentId}`);
    console.log(`ID: ${result.id}`);
  }
  return result;
}

async function listAgentsCommand(args) {
  const agents = listKnownAgents();
  if (args.json) printJson(agents);
  else {
    console.log('Known PermaBrain agents:');
    for (const agent of agents) {
      console.log(`  ${agent.name} (${agent.id})`);
      console.log(`    Fingerprint: ${agent.publicKeyFingerprint}`);
      if (agent.keyId) console.log(`    Key ID: ${agent.keyId}`);
    }
  }
  return agents;
}

async function provisionAgentCommand(args) {
  const agentName = args._[0];
  if (!agentName) throw new Error('provision-agent requires <agent-name>');
  const keyType = args['key-type'] || 'ed25519';
  const identity = await provisionAgentIdentity(agentName, { keyType });
  if (args.json) printJson(identity);
  else {
    console.log(`Provisioned identity for '${agentName}':`);
    console.log(`  Agent ID: ${identity.agentId}`);
    console.log(`  Key Type: ${identity.type}`);
    console.log(`  Public Key: ${identity.publicKey}`);
    console.log('  ⚠ Secret key shown once — store securely!');
  }
  return identity;
}

async function batchAttestCommand(args) {
  const filePath = args.file;
  if (!filePath) throw new Error('batch-attest requires --file <path> (JSON array of attestations)');

  let attestations;
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    attestations = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Failed to read/parse attestation file: ${err.message}`);
  }

  if (!Array.isArray(attestations)) throw new Error('Attestation file must contain a JSON array');
  if (attestations.length === 0) throw new Error('Attestation array is empty');

  // Validate required fields
  for (let i = 0; i < attestations.length; i++) {
    const att = attestations[i];
    if (!att.key) throw new Error(`attestations[${i}]: key is required`);
    if (!att.opinion) throw new Error(`attestations[${i}]: opinion is required`);
    if (att.confidence === undefined) throw new Error(`attestations[${i}]: confidence is required`);
    if (!att.reason) throw new Error(`attestations[${i}]: reason is required`);
  }

  // Use agent API directly
  const { api } = await import('./agent-api.mjs');
  await api.ensureInit();
  const result = await api.batchAttest({ attestations });

  if (args.json) {
    printJson(result);
  } else {
    console.log(`Batch attest: ${result.succeeded} succeeded, ${result.failed} failed`);
    for (const r of result.results) {
      if (r.status === 'ok') {
        console.log(`  ✓ ${r.key}: ${r.summary.opinion} (${r.summary.confidence})`);
      } else {
        console.log(`  ✗ ${r.key}: ${r.error}`);
      }
    }
  }
  return result;
}

async function autoImportCommand(args) {
  const filePath = args.file;
  if (!filePath) throw new Error('auto-import requires --file <path> (JSON array of articles)');

  let articles;
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    articles = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Failed to read/parse import file: ${err.message}`);
  }

  if (!Array.isArray(articles)) throw new Error('Import file must contain a JSON array');
  if (articles.length === 0) throw new Error('Articles array is empty');

  // Validate required fields
  for (let i = 0; i < articles.length; i++) {
    const art = articles[i];
    if (!art.url) throw new Error(`articles[${i}]: url is required`);
    if (!art.kind) throw new Error(`articles[${i}]: kind is required`);
    if (!art.topic) throw new Error(`articles[${i}]: topic is required`);
  }

  // Use agent API directly
  const { api } = await import('./agent-api.mjs');
  await api.ensureInit();
  const result = await api.autoImport({ articles });

  if (args.json) {
    printJson(result);
  } else {
    console.log(`Auto-import: ${result.succeeded} succeeded, ${result.failed} failed`);
    for (const r of result.results) {
      if (r.status === 'ok') {
        console.log(`  ✓ ${r.key}: ${r.summary.title || r.key} (v${r.summary.version})`);
      } else {
        console.log(`  ✗ ${r.key}: ${r.error}`);
      }
    }
  }
  return result;
}

async function probeDevicesCommand(args) {
  const home = getHome();
  let config;
  try { config = loadConfig(home); } catch { config = {}; }
  const baseUrl = args.url || config.gateway?.dataUrl || 'http://localhost:10000';
  const transport = new HyperbeamTransport({
    ...config,
    gateway: { ...(config.gateway || {}), dataUrl: baseUrl, graphqlUrl: `${baseUrl}/graphql` },
    bundler: { ...(config.bundler || {}), uploadUrl: bundlerUploadUrl(baseUrl) },
  });
  const result = await transport.probe(baseUrl);
  if (args.json) {
    printJson(result);
  } else {
    console.log(`HyperBEAM Device Probe: ${result.url}`);
    for (const check of result.checks) {
      const icon = check.ok ? '✓' : '✗';
      console.log(`  ${icon} ${check.name}: ${check.ok ? 'available' : (check.error || `HTTP ${check.status}`)}`);
    }
  }
  return result;
}

async function matchCommand(args) {
  const home = getHome();
  let config;
  try { config = loadConfig(home); } catch { config = {}; }
  const baseUrl = args.url || config.gateway?.dataUrl || 'http://localhost:10000';
  const query = new HyperbeamQuery(baseUrl);
  const key = args.key || args._[0];
  const value = args.value || args._[1];
  if (!key || !value) throw new Error('match requires --key <tag-name> --value <tag-value>');
  const results = await query.match(key, value);
  if (args.json) {
    printJson(results);
  } else {
    console.log(`Match: ${key}=${value}`);
    console.log(`Results: ${results.length}`);
    for (const id of results) {
      console.log(`  ${id}`);
    }
  }
  return results;
}

async function deployConsensusCommand(args) {
  const home = getHome();
  let config;
  try { config = loadConfig(home); } catch { config = {}; }
  const baseUrl = args.url || config.gateway?.dataUrl || 'http://localhost:10000';
  const identity = loadIdentity(home);
  const uploadUrl = config.bundler?.uploadUrl || bundlerUploadUrl(baseUrl);
  const consensus = new HyperbeamConsensus(baseUrl, config.consensus || {});
  const result = await consensus.deploy(uploadUrl, identity);
  if (args.json) {
    printJson(result);
  } else {
    console.log('Deployed PermaBrain consensus modules to HyperBEAM:');
    console.log(`  Consensus module: ${result.consensusModuleId}`);
    console.log(`  Query module: ${result.queryModuleId}`);
  }
  return result;
}

async function metaInfoCommand(args) {
  const home = getHome();
  let config;
  try { config = loadConfig(home); } catch { config = {}; }
  const baseUrl = args.url || config.gateway?.dataUrl || 'http://localhost:10000';
  const transport = new HyperbeamTransport({
    ...config,
    gateway: { ...(config.gateway || {}), dataUrl: baseUrl },
  });
  const result = await transport.metaInfo();
  if (args.json) {
    printJson(result);
  } else {
    console.log('HyperBEAM Node Info:');
    for (const [key, value] of Object.entries(result)) {
      console.log(`  ${key}: ${value}`);
    }
  }
  return result;
}

async function whoisCommand(args) {
  const home = getHome();
  let config;
  try { config = loadConfig(home); } catch { config = {}; }
  const baseUrl = args.url || config.gateway?.dataUrl || 'http://localhost:10000';
  const transport = new HyperbeamTransport({
    ...config,
    gateway: { ...(config.gateway || {}), dataUrl: baseUrl },
  });
  const address = args._[0] || args.address;
  if (!address) throw new Error('whois requires <address>');
  const result = await transport.whois(address);
  if (args.json) {
    printJson(result);
  } else {
    console.log(`Whois: ${address}`);
    for (const [key, value] of Object.entries(result)) {
      console.log(`  ${key}: ${value}`);
    }
  }
  return result;
}

async function referenceCommand(args) {
  const home = getHome();
  let config;
  try { config = loadConfig(home); } catch { config = {}; }
  const baseUrl = args.url || config.gateway?.dataUrl || 'http://localhost:10000';
  const transport = new HyperbeamTransport({
    ...config,
    gateway: { ...(config.gateway || {}), dataUrl: baseUrl },
  });
  const subcommand = args._[0];
  if (!subcommand) throw new Error('reference requires a subcommand: create|update|resolve');

  function parseKeyValuePairs(pairs) {
    const value = {};
    for (const pair of pairs) {
      const idx = pair.indexOf('=');
      if (idx === -1) throw new Error(`Invalid key=value pair: ${pair}`);
      value[pair.slice(0, idx)] = pair.slice(idx + 1);
    }
    return value;
  }

  if (subcommand === 'resolve') {
    const referenceId = args._[1];
    const path = args._[2] || '';
    if (!referenceId) throw new Error('reference resolve requires <ref-id>');
    const result = await transport.resolveReference(referenceId, path);
    if (args.json) printJson(result);
    else {
      console.log(`Reference ${referenceId}${path ? '/' + path : ''}:`);
      if (typeof result === 'object') console.log(JSON.stringify(result, null, 2));
      else console.log(String(result));
    }
    return result;
  }

  const identity = loadIdentity(home);

  if (subcommand === 'create') {
    const pairs = args._.slice(1);
    if (pairs.length === 0) throw new Error('reference create requires at least one key=value pair');
    const value = parseKeyValuePairs(pairs);
    const result = await transport.createReference(value, identity, { authority: identity.agentId });
    if (args.json) printJson(result);
    else {
      console.log(`Created reference: ${result.referenceId}`);
      for (const [k, v] of Object.entries(result.value)) {
        console.log(`  ${k}: ${v}`);
      }
    }
    return result;
  }

  if (subcommand === 'update') {
    const referenceId = args._[1];
    const pairs = args._.slice(2);
    if (!referenceId) throw new Error('reference update requires <ref-id>');
    if (pairs.length === 0) throw new Error('reference update requires at least one key=value pair');
    const value = parseKeyValuePairs(pairs);
    const result = await transport.updateReference(referenceId, value, identity, { authority: identity.agentId });
    if (args.json) printJson(result);
    else {
      console.log(`Updated reference: ${result.referenceId}`);
      console.log(`  timestamp: ${result.timestamp}`);
      for (const [k, v] of Object.entries(result.value)) {
        console.log(`  ${k}: ${v}`);
      }
    }
    return result;
  }

  throw new Error(`Unknown reference subcommand: ${subcommand}`);
}
