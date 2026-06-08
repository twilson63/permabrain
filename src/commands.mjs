import { initState, loadConfig, getHome, defaultConfig } from './config.mjs';
import { ensureIdentity, publicIdentity } from './keys.mjs';
import { HyperbeamTransport } from './transport.mjs';
import { AOTransport } from './ao-transport.mjs';
import { CompositeTransport } from './composite-transport.mjs';
import { getArticle, publishArticle, queryArticles, syncArticlesAndAttestations } from './article.mjs';
import { importWikipediaArticle } from './wikipedia.mjs';
import { attestArticle, opinionFromArgs } from './attestation.mjs';
import { attestForAgent, provisionAgentIdentity, parseAttestationRequest, processProxyAttestation, buildAttestationRequestBody, listKnownAgents, getKnownAgent } from './multi-agent.mjs';
import { consensusForArticle } from './consensus.mjs';
import { loadIdentity } from './keys.mjs';
import { getTransport } from './transport.mjs';
import { spawn as aoSpawn, loadLua as aoLoadLua, saveProcessId as aoSaveProcessId, waitForProcess } from './ao-deploy.mjs';

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
  if (command === 'ao-deploy') return aoDeployCommand(args);
  if (command === 'ao-bootstrap') return aoBootstrapCommand(args);
  if (command === 'ao-sync') return aoSyncCommand(args);
  if (command === 'ao-query') return aoQueryCommand(args);
  if (command === 'ao-get') return aoGetCommand(args);
  if (command === 'ao-consensus') return aoConsensusCommand(args);
  if (command === 'attest-for-agent') return attestForAgentCommand(args);
  if (command === 'list-agents') return listAgentsCommand(args);
  if (command === 'provision-agent') return provisionAgentCommand(args);
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

async function aoSyncCommand(args) {
  const home = getHome();
  const config = loadConfig(home);
  if (!config.ao?.processId) throw new Error('AO sync requires config.ao.processId. Run `permabrain init` and set PERMABRAIN_AO_PROCESS_ID.');
  const identity = loadIdentity(home);
  const transport = new AOTransport(config);
  const result = await transport.syncFromArweave(identity);
  if (args.json) printJson(result);
  else {
    console.log(`AO sync: ${result.articles} articles, ${result.attestations} attestations`);
    console.log(`Message ID: ${result.messageId}`);
  }
  return result;
}

async function aoQueryCommand(args) {
  const home = getHome();
  const config = loadConfig(home);
  if (!config.ao?.processId) throw new Error('AO query requires config.ao.processId. Run `permabrain init` and set PERMABRAIN_AO_PROCESS_ID.');
  const transport = new AOTransport(config);
  const articles = await transport.queryArticles({
    topic: args.topic,
    kind: args.kind,
    key: args.key,
    sourceName: args['source-name']
  });
  if (args.json) printJson(articles);
  else {
    if (!articles.length) console.log('No articles found.');
    for (const article of articles) console.log(`${article.key}\tv${article.version}\t${article.title}\t${article.topic}`);
  }
  return articles;
}

async function aoGetCommand(args) {
  const home = getHome();
  const config = loadConfig(home);
  if (!config.ao?.processId) throw new Error('AO get requires config.ao.processId. Run `permabrain init` and set PERMABRAIN_AO_PROCESS_ID.');
  const transport = new AOTransport(config);
  const key = args._[0];
  if (!key) throw new Error('ao-get requires <canonical-key>');
  const result = await transport.getArticle(key);
  if (!result) throw new Error(`Article not found via AO: ${key}`);
  if (args.json) printJson(result);
  else console.log(JSON.stringify(result, null, 2));
  return result;
}

async function aoConsensusCommand(args) {
  const home = getHome();
  const config = loadConfig(home);
  if (!config.ao?.processId) throw new Error('AO consensus requires config.ao.processId. Run `permabrain init` and set PERMABRAIN_AO_PROCESS_ID.');
  const transport = new AOTransport(config);
  const key = args._[0];
  if (!key) throw new Error('ao-consensus requires <canonical-key>');
  const result = await transport.getConsensus(key);
  if (!result) throw new Error(`Consensus not available via AO for: ${key}`);
  if (args.json) printJson(result);
  else {
    console.log(`${result.key}: ${result.status}`);
    console.log(`Score: ${result.score}`);
  }
  return result;
}

async function aoDeployCommand(args) {
  const home = getHome();
  const config = loadConfig(home);

  // Spawn the AO process
  console.log('Spawning AO process...');
  const { processId, moduleId, schedulerId } = await aoSpawn({
    cwd: process.cwd(),
    module: args.module,
    scheduler: args.scheduler,
    ao: config.ao
  });

  if (args.json) {
    printJson({ processId, moduleId, schedulerId });
  } else {
    console.log(`AO process spawned: ${processId}`);
    console.log(`Module: ${moduleId}`);
    console.log(`Scheduler: ${schedulerId}`);
  }

  // Save the process ID to config
  aoSaveProcessId(processId, home);
  if (!args.json) console.log(`Process ID saved to config.`);

  // Load process.lua into the new process
  console.log('Loading process.lua...');
  const { messageId } = await aoLoadLua({
    processId,
    cwd: process.cwd(),
    ao: config.ao
  });

  if (args.json) {
    printJson({ processId, messageId, moduleId, schedulerId });
  } else {
    console.log(`Process loaded. Eval message: ${messageId}`);
    console.log('');
    console.log('The process is initializing. Wait ~30 seconds, then use:');
    console.log(`  permabrain ao-sync         # Bootstrap with existing Arweave data`);
    console.log(`  permabrain ao-query         # Query articles via AO`);
    console.log(`  permabrain ao-consensus <key>  # Get consensus via AO`);
  }

  return { processId, messageId, moduleId, schedulerId };
}

async function aoBootstrapCommand(args) {
  const home = getHome();
  const config = loadConfig(home);
  const processId = args.process || config.ao?.processId || process.env.PERMABRAIN_AO_PROCESS_ID;
  if (!processId) throw new Error('AO bootstrap requires --process <id> or config.ao.processId. Run `permabrain ao-deploy` first.');

  // Step 1: Wait for process to be ready
  console.log('Waiting for AO process to be ready...');
  const ready = await waitForProcess({ processId, ao: config.ao, timeoutMs: 180000 });
  if (!ready) {
    throw new Error('AO process is not responding. It may still be initializing. Try again in 30-60 seconds.');
  }
  if (!args.json) console.log('Process is ready.');

  // Step 2: Load process.lua
  console.log('Loading process.lua...');
  const { messageId: luaMessageId } = await aoLoadLua({
    processId,
    cwd: process.cwd(),
    ao: config.ao
  });
  if (!args.json) console.log(`Lua loaded: ${luaMessageId}`);

  // Step 3: Sync existing data from Arweave
  console.log('Syncing existing articles and attestations from Arweave...');
  const identity = loadIdentity(home);
  const transport = new AOTransport({ ...config, ao: { ...config.ao, processId } });
  const syncResult = await transport.syncFromArweave(identity);

  if (args.json) {
    printJson({ processId, luaMessageId, ...syncResult });
  } else {
    console.log(`Bootstrap complete.`);
    console.log(`  Lua loaded: ${luaMessageId}`);
    console.log(`  Articles synced: ${syncResult.articles}`);
    console.log(`  Attestations synced: ${syncResult.attestations}`);
    console.log(`  Sync message: ${syncResult.messageId}`);
  }

  return { processId, luaMessageId, ...syncResult };
}

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
