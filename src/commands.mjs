import { initState, loadConfig, getHome, defaultConfig } from './config.mjs';
import { ensureIdentity, publicIdentity, loadIdentity } from './keys.mjs';
import { getArticle, publishArticle, queryArticles } from './article.mjs';
import { importWikipediaArticle } from './wikipedia.mjs';
import { attestArticle, opinionFromArgs } from './attestation.mjs';
import { attestForAgent, provisionAgentIdentity, parseAttestationRequest, processProxyAttestation, buildAttestationRequestBody, listKnownAgents, getKnownAgent } from './multi-agent.mjs';
import { consensusForArticle } from './consensus.mjs';
import { watch, watchOnce } from './watch.mjs';
import { getTransport, HyperbeamTransport, ArweaveTransport, LocalTransport, probeTransport } from './transport.mjs';
import { HyperbeamQuery } from './hb-query.mjs';
import { HyperbeamConsensus } from './hb-consensus.mjs';
import { DEVICES, bundlerUploadUrl } from './hb-devices.mjs';
import { getCircuitBreakerStatus, getTransportMetrics } from './transport.mjs';
import { parseGoalFile, planFromGoal, importArticlesFromGoal, attestationsFromGoal } from './goal.mjs';
import { verifyDataItemById, verifyByKey } from './verify.mjs';
import { exportBundle, exportAllArticles, importBundle } from './bundle.mjs';
import { exportHistory } from './export-history.mjs';
import { importHistory } from './import-history.mjs';
import { historyForKey } from './history.mjs';
import { forkArticle, listForks } from './fork.mjs';
import { mergeArticles } from './merge.mjs';
import { syncWithMerge } from './sync.mjs';
import { diffArticles, diffLocalVsRemote } from './diff.mjs';
import { status } from './status.mjs';
import { searchArticles } from './search.mjs';
import { topicFeed, feedToMarkdown } from './topic-feed.mjs';
import { activityFeed, activityToMarkdown } from './activity.mjs';
import { listArticles, listToMarkdown } from './list.mjs';
import { exportArticles } from './export-articles.mjs';
import { computeMetrics, metricsToMarkdown } from './article-metrics.mjs';
import { computeStats, statsToMarkdown } from './stats.mjs';
import { runConfigCommand, configToMarkdown } from './config-manager.mjs';
import { listRemotes, addRemote, removeRemote, setDefaultRemote, probeRemote, remotesToMarkdown } from './remotes.mjs';
import { createBackup, listBackups, restoreBackup, pruneBackups, backupsToMarkdown } from './backup.mjs';
import { startServer, stopServer } from './serve.mjs';
import { runDoctor, doctorReportToMarkdown } from './doctor.mjs';
import { queryLog, logToMarkdown, logAction } from './log.mjs';

import fs from 'node:fs';

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

export async function runCommand(command, args) {
  if (command === 'init') return initCommand(args);
  if (command === 'probe') return probeCommand(args);
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
  if (command === 'goal' || command === 'plan') return goalCommand(args);
  if (command === 'probe-devices') return probeDevicesCommand(args);
  if (command === 'match') return matchCommand(args);
  if (command === 'deploy-consensus') return deployConsensusCommand(args);
  if (command === 'meta-info') return metaInfoCommand(args);
  if (command === 'whois') return whoisCommand(args);
  if (command === 'reference') return referenceCommand(args);
  if (command === 'get-encrypted') return getEncryptedCommand(args);
  if (command === 'publish-encrypted') return publishEncryptedCommand(args);
  if (command === 'verify') return verifyCommand(args);
  if (command === 'export-bundle') return exportBundleCommand(args);
  if (command === 'export-history') return exportHistoryCommand(args);
  if (command === 'export-all') return exportAllCommand(args);
  if (command === 'import-bundle') return importBundleCommand(args);
  if (command === 'import-history') return importHistoryCommand(args);
  if (command === 'transport-status') return transportStatusCommand(args);
  if (command === 'watch') return watchCommand(args);
  if (command === 'history') return historyCommand(args);
  if (command === 'fork') return forkCommand(args);
  if (command === 'list-forks') return listForksCommand(args);
  if (command === 'merge') return mergeCommand(args);
  if (command === 'diff') return diffCommand(args);
  if (command === 'status') return statusCommand(args);
  if (command === 'search') return searchCommand(args);
  if (command === 'topic') return topicCommand(args);
  if (command === 'activity') return activityCommand(args);
  if (command === 'list') return listCommand(args);
  if (command === 'export-articles') return exportArticlesCommand(args);
  if (command === 'config') return configCommand(args);
  if (command === 'metrics') return metricsCommand(args);
  if (command === 'stats') return statsCommand(args);
  if (command === 'remote') return remoteCommand(args);
  if (command === 'archive') return archiveCommand(args);
  if (command === 'restore') return restoreCommand(args);
  if (command === 'backup') return backupCommand(args);
  if (command === 'serve') return serveCommand(args);
  if (command === 'doctor') return doctorCommand(args);
  if (command === 'log') return logCommand(args);
  throw new Error(`Command '${command}' is planned but not implemented yet.`);
}

async function probeCommand(args) {
  const home = getHome();
  let config;
  try { config = loadConfig(home); } catch { config = defaultConfig(); }
  const useHyperbeam = args['use-hyperbeam'] === true || args['use-hyperbeam'] === 'true' || config.transport === 'hyperbeam';
  if (useHyperbeam) {
    const baseUrl = args.url || config.gateway?.dataUrl || process.env.PERMABRAIN_HYPERBEAM_URL || 'http://localhost:10000';
    config = { ...config, transport: 'hyperbeam', gateway: { ...(config.gateway || {}), type: 'hyperbeam', dataUrl: baseUrl, graphqlUrl: `${baseUrl}/graphql` }, bundler: { ...(config.bundler || {}), type: 'hyperbeam', uploadUrl: `${baseUrl}/~bundler@1.0/tx?codec-device=ans104@1.0` } };
  }
  const { probeTransport } = await import('./transport.mjs');
  const result = await probeTransport(config, home, { useHyperbeam });
  if (args.json) printJson(result);
  else {
    console.log(`PermaBrain probe: ${result.url} (${result.transport})`);
    for (const check of result.checks) {
      console.log(`${check.ok ? 'ok' : 'fail'} ${check.name} ${check.status || check.error || ''}`.trim());
    }
  }
  return result;
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
  const visibility = args.visibility || args.publish || 'public';
  if (!['public', 'encrypted', 'private'].includes(visibility)) throw new Error(`--visibility must be public, encrypted, or private (got: ${visibility})`);
  const encryptedFor = args.for ? String(args.for).split(',').map(k => k.trim()).filter(Boolean) : [];
  const result = await publishArticle({
    file,
    kind: args.kind,
    topic: args.topic,
    key: args.key,
    title: args.title,
    sourceUrl: args['source-url'],
    sourceName: args['source-name'],
    sourceLicense: args['source-license'] || '',
    language: args.language || 'en',
    useHyperbeam: args['use-hyperbeam'] ?? false,
    useHyperbeamReference: args['use-hyperbeam-reference'] ?? (process.env.PERMABRAIN_HYPERBEAM_REFERENCES === '1' ? true : undefined),
    visibility,
    encryptedFor
  });
  if (args.json) printJson(result.summary);
  else {
    console.log(`Published ${visibility !== 'public' ? visibility + ' ' : ''}${result.summary.key}`);
    console.log(`ID: ${result.summary.id}`);
    console.log(`Version: ${result.summary.version}`);
    if (result.reference) {
      console.log(`Reference: ${result.reference.referenceId} (${result.reference.action})`);
    }
  }
  return result;
}

async function importWikipediaCommand(args) {
  const title = args._[0];
  const result = await importWikipediaArticle({ title, kind: args.kind, topic: args.topic, language: args.language || 'en', useHyperbeam: args['use-hyperbeam'] ?? false, useHyperbeamReference: args['use-hyperbeam-reference'] ?? (process.env.PERMABRAIN_HYPERBEAM_REFERENCES === '1' ? true : undefined) });
  if (args.json) printJson(result.summary);
  else {
    console.log(`Imported Wikipedia article ${result.summary.key}`);
    console.log(`ID: ${result.summary.id}`);
    console.log(`Version: ${result.summary.version}`);
  }
  return result;
}

async function getEncryptedCommand(args) {
  const key = args._[0];
  if (!key) throw new Error('get-encrypted requires <canonical-key>');

  let decryptSeed;
  if (args['seed-file']) {
    decryptSeed = fs.readFileSync(args['seed-file'], 'utf8').trim();
  } else if (args.seed) {
    decryptSeed = args.seed;
  }

  const { api } = await import('./agent-api.mjs');
  await api.ensureInit();
  const result = await api.getAndDecrypt(key, { useHyperbeam: args['use-hyperbeam'] ?? false, decryptSeed });
  if (args.json) printJson({ ...result, content: result.content });
  else process.stdout.write(result.content);
  return result;
}

async function publishEncryptedCommand(args) {
  const file = args._[0];
  if (!file) throw new Error('publish-encrypted requires <file>');
  if (!args.for) throw new Error('--for is required (comma-separated X25519 public keys)');
  const encryptedFor = String(args.for).split(',').map(k => k.trim()).filter(Boolean);
  if (encryptedFor.length === 0) throw new Error('--for must include at least one recipient public key');
  const result = await publishArticle({
    file,
    kind: args.kind,
    topic: args.topic,
    key: args.key,
    title: args.title,
    sourceUrl: args['source-url'],
    sourceName: args['source-name'],
    sourceLicense: args['source-license'] || '',
    language: args.language || 'en',
    encryptedFor,
    useHyperbeam: args['use-hyperbeam'] ?? false,
    useHyperbeamReference: args['use-hyperbeam-reference'] ?? (process.env.PERMABRAIN_HYPERBEAM_REFERENCES === '1' ? true : undefined)
  });
  if (args.json) printJson({ ...result.summary, encrypted: result.encrypted, encryptionEnvelope: result.encryptionEnvelope });
  else {
    console.log(`Published encrypted ${result.summary.key}`);
    console.log(`ID: ${result.summary.id}`);
    console.log(`Version: ${result.summary.version}`);
    console.log(`Recipients: ${result.encryptionEnvelope?.recipients?.length || encryptedFor.length}`);
  }
  return result;
}

async function queryCommand(args) {
  const articles = await queryArticles({
    topic: args.topic,
    kind: args.kind,
    key: args.key,
    sourceName: args['source-name'],
    sourceUrl: args['source-url'],
    useHyperbeam: args['use-hyperbeam'] ?? false
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
  const result = await getArticle(key, { useHyperbeam: args['use-hyperbeam'] ?? false });
  if (args.json) printJson({ ...result.summary, content: result.content });
  else process.stdout.write(result.content);
  return result;
}

async function attestCommand(args) {
  const key = args._[0];
  if (!key) throw new Error('attest requires <canonical-key>');
  const opinion = opinionFromArgs(args);
  const result = await attestArticle({
    key,
    opinion,
    confidence: args.confidence,
    reason: args.reason,
    sourceUrl: args['source-url'] || '',
    targetId: args['target-id'],
    useHyperbeam: args['use-hyperbeam'] ?? false,
    useHyperbeamReference: args['use-hyperbeam-reference'] ?? (process.env.PERMABRAIN_HYPERBEAM_REFERENCES === '1' ? true : undefined)
  });
  if (args.json) printJson(result.summary);
  else {
    console.log(`Attested ${result.summary.targetKey}: ${result.summary.opinion} (${result.summary.confidence})`);
    console.log(`ID: ${result.summary.id}`);
    if (result.reference) {
      console.log(`Reference: ${result.reference.referenceId} (${result.reference.action})`);
    }
  }
  return result;
}

async function consensusCommand(args) {
  const key = args._[0];
  if (!key) throw new Error('consensus requires <canonical-key>');
  const result = await consensusForArticle(key, { useHyperbeam: args['use-hyperbeam'] ?? false });
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
  const result = await syncWithMerge({
    useHyperbeam: args['use-hyperbeam'] ?? false,
    autoMerge: args['no-auto-merge'] ? false : true,
    dryRun: args['dry-run'] === true || args['dry-run'] === 'true'
  });
  if (args.json) printJson(result);
  else {
    console.log(`Synced ${result.articleCount} articles and ${result.attestationCount} attestations.`);
    if (result.report.merges.length) {
      console.log(`Auto-merged ${result.report.merges.length} divergent version(s):`);
      for (const m of result.report.merges) {
        const conflictNote = m.hasConflicts ? ` ⚠ ${m.conflictCount} conflict(s)` : '';
        console.log(`  ${m.key}: ${m.localId} + ${m.remoteId} → ${m.mergedId || '(dry-run)'}${conflictNote}`);
      }
    }
    if (result.report.divergences.length) {
      console.log(`${result.report.divergences.length} divergence(s) need manual resolution:`);
      for (const d of result.report.divergences) {
        console.log(`  ${d.key} (${d.status}): ${d.reason}`);
      }
    }
    if (!result.report.merges.length && !result.report.divergences.length) {
      console.log('No divergent versions detected.');
    }
  }
  return result;
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
  const result = await api.batchAttest({ attestations, useHyperbeam: args['use-hyperbeam'] ?? false });

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
  const result = await api.autoImport({ articles, useHyperbeam: args['use-hyperbeam'] ?? false, useHyperbeamReference: args['use-hyperbeam-reference'] ?? (process.env.PERMABRAIN_HYPERBEAM_REFERENCES === '1' ? true : undefined) });

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
  const uploadUrl = bundlerUploadUrl(baseUrl);
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

async function watchCommand(args) {
  const opts = {
    useHyperbeam: args['use-hyperbeam'] === true || args['use-hyperbeam'] === 'true',
    topic: args.topic,
    kind: args.kind,
    key: args.key,
    interval: Number(args.interval || 30),
    once: args.once === true || args.once === 'true',
    json: args.json === true || args.json === 'true'
  };

  if (opts.once) {
    const { cancel } = await watchOnce(opts);
    return { status: 'watched-once' };
  }

  const { cancel } = await watch(opts);
  // Keep the process alive until SIGINT/SIGTERM.
  process.once('SIGINT', () => {
    cancel();
    process.exit(0);
  });
  process.once('SIGTERM', () => {
    cancel();
    process.exit(0);
  });
  return { status: 'watching' };
}

async function verifyCommand(args) {
  const id = args._[0];
  if (!id) throw new Error('verify requires <id-or-key>');
  const isKey = id.includes('/');
  const useHyperbeam = args['use-hyperbeam'] ?? false;
  const opts = {
    useHyperbeam,
    includeAttestations: args.attestations === true || args.attestations === 'true',
    verifyChain: args['verify-chain'] !== false,
    verifyTarget: args['verify-target'] !== false
  };
  const result = isKey ? await verifyByKey(id, opts) : await verifyDataItemById(id, opts);
  if (args.json) printJson(result);
  else {
    const status = result.valid ? 'valid' : 'invalid';
    console.log(`Verify ${id}: ${status}`);
    for (const check of result.checks) {
      console.log(`  ${check.ok ? '✓' : '✗'} ${check.name}${check.error ? `: ${check.error}` : check.note ? `: ${check.note}` : ''}`);
    }
    if (result.article?.encrypted) console.log('  (encrypted article — content hash not independently verifiable)');
    if (result.consensus) {
      console.log(`  Consensus: ${result.consensus.status} score=${result.consensus.score}`);
    }
  }
  return result;
}

async function transportStatusCommand(args) {
  const status = {
    circuitBreakers: getCircuitBreakerStatus(),
    metrics: getTransportMetrics(),
  };
  if (args.json) printJson(status);
  else {
    console.log('Transport status');
    console.log('Circuit breakers:');
    for (const [name, b] of Object.entries(status.circuitBreakers)) {
      console.log(`  ${name}: ${b.state} (failures=${b.failures}, successes=${b.successes}, calls=${b.stats?.calls || 0})`);
    }
    console.log('Metrics:');
    for (const [name, m] of Object.entries(status.metrics.histograms)) {
      console.log(`  ${name}: count=${m.count} success=${m.success} failure=${m.failure} avg=${m.summary.avg?.toFixed(2) || '-'}ms p95=${m.summary.p95?.toFixed(2) || '-'}ms`);
    }
    if (Object.keys(status.metrics.histograms).length === 0) console.log('  (no transport calls recorded yet)');
  }
  return status;
}

async function goalCommand(args) {
  const filePath = args._[0];
  if (!filePath) throw new Error('goal/plan requires <prd-file> (markdown PRD or goal)');

  const opts = {};
  if (args.topic) opts.topics = [args.topic];
  if (args.kind) opts.kinds = [args.kind];

  const parsed = parseGoalFile(filePath, opts);

  if (args.import) {
    const articles = importArticlesFromGoal(parsed);
    if (args.json) printJson(articles);
    else {
      console.log(`Import articles from goal: ${articles.length}`);
      for (const art of articles) {
        console.log(`  ${art.key}: ${art.url}`);
      }
    }
    return articles;
  }

  if (args['batch-attest']) {
    const attestations = attestationsFromGoal(parsed);
    if (args.json) printJson(attestations);
    else {
      console.log(`Attestations from goal: ${attestations.length}`);
      for (const att of attestations) {
        console.log(`  ${att.key}: ${att.opinion} (${att.confidence})`);
      }
    }
    return attestations;
  }

  if (args.execute) {
    const { api } = await import('./agent-api.mjs');
    await api.ensureInit();

    const plan = planFromGoal(parsed);
    const result = {
      planKey: plan.planKey,
      topic: plan.topic,
      imported: { succeeded: 0, failed: 0, results: [] },
      published: { succeeded: 0, failed: 0, results: [] },
      attested: { succeeded: 0, failed: 0, results: [] }
    };

    if (plan.importArticles.length) {
      const importResult = await api.autoImport({
        articles: plan.importArticles,
        useHyperbeam: args['use-hyperbeam'] ?? false,
        useHyperbeamReference: args['use-hyperbeam-reference'] ?? (process.env.PERMABRAIN_HYPERBEAM_REFERENCES === '1' ? true : undefined)
      });
      result.imported = importResult;
    }

    if (plan.publishArticles.length) {
      for (const art of plan.publishArticles) {
        try {
          const pub = await api.publish({
            content: art.content,
            kind: art.kind,
            topic: art.topic,
            title: art.title,
            key: art.key,
            sourceUrl: art.sourceUrl,
            useHyperbeam: args['use-hyperbeam'] ?? false,
            useHyperbeamReference: args['use-hyperbeam-reference'] ?? (process.env.PERMABRAIN_HYPERBEAM_REFERENCES === '1' ? true : undefined)
          });
          result.published.results.push({ key: art.key, status: 'ok', summary: pub.summary });
          result.published.succeeded++;
        } catch (err) {
          result.published.results.push({ key: art.key, status: 'error', error: err.message });
          result.published.failed++;
        }
      }
    }

    if (plan.attestations.length) {
      const attestResult = await api.batchAttest({
        attestations: plan.attestations,
        useHyperbeam: args['use-hyperbeam'] ?? false,
        useHyperbeamReference: args['use-hyperbeam-reference'] ?? (process.env.PERMABRAIN_HYPERBEAM_REFERENCES === '1' ? true : undefined)
      });
      result.attested = attestResult;
    }

    if (args.json) printJson(result);
    else {
      console.log(`Executed goal plan '${plan.title}'`);
      console.log(`  Imported: ${result.imported.succeeded} succeeded, ${result.imported.failed} failed`);
      console.log(`  Published: ${result.published.succeeded} succeeded, ${result.published.failed} failed`);
      console.log(`  Attested: ${result.attested.succeeded} succeeded, ${result.attested.failed} failed`);
    }
    return result;
  }

  const plan = planFromGoal(parsed);
  if (args.json) printJson(plan);
  else {
    console.log(`Plan: ${plan.title}`);
    console.log(`Key: ${plan.planKey}`);
    console.log(`Topic: ${plan.topic} | Kind: ${plan.kind}`);
    console.log(`\nSteps:`);
    for (const step of plan.steps) {
      console.log(`  ${step.order}. ${step.title}`);
      for (const c of step.criteria) {
        console.log(`     ✓ ${c}`);
      }
    }
    console.log(`\nImportable URLs: ${plan.importArticles.length}`);
    for (const art of plan.importArticles) {
      console.log(`  - ${art.url} → ${art.key}`);
    }
    console.log(`\nPublishable step articles: ${plan.publishArticles.length}`);
    console.log(`Attestations: ${plan.attestations.length}`);
  }
  return plan;
}

async function exportBundleCommand(args) {
  const key = args._[0];
  const id = args.id;
  if (!key && !id) throw new Error('export-bundle requires <canonical-key> or --id <id>');
  const result = await exportBundle({
    key,
    id,
    includeAttestations: args.attestations !== false,
    includeVersions: args.versions !== false,
    home: getHome(),
    transport: args['use-hyperbeam'] ?? false
  });
  if (args.output) {
    fs.writeFileSync(args.output, JSON.stringify(result, null, 2) + '\n');
  }
  if (args.json || !args.output) {
    printJson(result);
  } else {
    console.log(`Exported bundle to ${args.output}: ${result.entries.length} entries`);
  }
  return result;
}

async function exportHistoryCommand(args) {
  const key = args._[0];
  if (!key) throw new Error('export-history requires <canonical-key>');
  const result = await exportHistory(key, {
    home: getHome(),
    useHyperbeam: args['use-hyperbeam'] ?? false,
    verify: args['no-verify'] !== true,
    includeExporter: args['no-exporter'] !== true
  });
  if (args.output) {
    fs.writeFileSync(args.output, JSON.stringify(result, null, 2) + '\n');
  }
  if (args.json || !args.output) {
    printJson(result);
  } else {
    console.log(`Exported history for ${result.meta.sourceKey}: ${result.entries.length} entries`);
    console.log(`  Versions: ${result.meta.entryCount.articles} | Attestations: ${result.meta.entryCount.attestations}`);
  }
  return result;
}

async function exportAllCommand(args) {
  const result = await exportAllArticles({
    includeAttestations: args.attestations !== false,
    home: getHome(),
    transport: args['use-hyperbeam'] ?? false
  });
  if (args.output) {
    fs.writeFileSync(args.output, JSON.stringify(result, null, 2) + '\n');
  }
  if (args.json || !args.output) {
    printJson(result);
  } else {
    console.log(`Exported ${result.articles.length} articles and ${result.attestations.length} attestations to ${args.output}`);
  }
  return result;
}

async function historyCommand(args) {
  const key = args._[0];
  if (!key) throw new Error('history requires <canonical-key>');
  const result = await historyForKey(key, {
    useHyperbeam: args['use-hyperbeam'] ?? false,
    includeConsensus: args['no-consensus'] !== true
  });
  if (args.json) {
    printJson(result);
  } else {
    console.log(`History for ${result.key}`);
    console.log(`Versions: ${result.versionCount} | Attestations: ${result.attestationCount}`);
    for (const event of result.timeline) {
      if (event.type === 'version') {
        console.log(`\n[v${event.version}] ${event.title || '(untitled)'}`);
        console.log(`  ID: ${event.id}`);
        console.log(`  Hash: ${event.contentHash || 'n/a'}`);
        console.log(`  Source: ${event.sourceName || 'n/a'} (${event.sourceUrl || 'n/a'})`);
        console.log(`  Author: ${event.authorAgentId || 'unknown'} | Updated: ${event.updatedAt || 'unknown'}`);
        if (event.previousId) console.log(`  Previous: ${event.previousId}`);
        if (event.encrypted) console.log(`  Visibility: encrypted`);
      } else {
        console.log(`\n[attestation] ${event.targetKey}: ${event.opinion} (${event.confidence}) by ${event.agentId}`);
        console.log(`  Target version: ${event.targetVersion ?? 'unknown'}`);
        console.log(`  Reason: ${event.reason || 'none'}`);
        console.log(`  ID: ${event.id} | Created: ${event.createdAt || 'unknown'}`);
      }
    }
    if (result.consensus) {
      console.log(`\nConsensus (latest v${result.consensus.latestVersion}): ${result.consensus.status} score=${result.consensus.score}`);
      console.log(`  Total attestations considered: ${result.consensus.totalAttestations}`);
      if (Object.keys(result.consensus.opinionCounts).length) {
        console.log('  Opinions:', JSON.stringify(result.consensus.opinionCounts));
      }
    }
  }
  return result;
}

async function importHistoryCommand(args) {
  const file = args._[0] || args.file;
  if (!file) throw new Error('import-history requires <file>');
  const raw = fs.readFileSync(file, 'utf8');
  const bundle = JSON.parse(raw);
  const result = await importHistory(bundle, {
    home: getHome(),
    verify: args['no-verify'] !== true,
    skipDuplicates: args['skip-duplicates'] !== false
  });
  if (args.json) printJson(result);
  else {
    console.log(`Import history: ${result.importedArticles} articles, ${result.importedAttestations} attestations imported`);
    if (result.skippedArticles || result.skippedAttestations) {
      console.log(`  Skipped: ${result.skippedArticles} articles, ${result.skippedAttestations} attestations`);
    }
    if (result.failed) console.log(`  Failed: ${result.failed}`);
    for (const r of result.results) {
      if (!r.ok) {
        console.log(`  ✗ ${r.type}${r.key ? ` ${r.key}` : ''}${r.targetKey ? ` ${r.targetKey}` : ''}: ${r.error}`);
      } else if (!r.imported) {
        console.log(`  - ${r.type} ${r.key || r.targetKey || ''}: already present`);
      } else {
        console.log(`  ✓ ${r.type} ${r.key || r.targetKey || ''}: ${r.id}`);
      }
    }
  }
  return result;
}

async function importBundleCommand(args) {
  const file = args._[0] || args.file;
  if (!file) throw new Error('import-bundle requires <file>');
  const raw = fs.readFileSync(file, 'utf8');
  const bundle = JSON.parse(raw);
  const results = await importBundle(bundle, {
    home: getHome(),
    transport: args['use-hyperbeam'] ?? false,
    verify: args['no-verify'] !== true,
    skipDuplicates: args['skip-duplicates'] !== false
  });
  if (args.json) printJson(results);
  else {
    const imported = results.filter(r => r.imported).length;
    const skipped = results.filter(r => r.ok && !r.imported).length;
    const failed = results.filter(r => !r.ok).length;
    console.log(`Import bundle: ${imported} imported, ${skipped} skipped, ${failed} failed`);
    for (const r of results) {
      if (!r.ok) {
        console.log(`  ✗ ${r.type}${r.key ? ` ${r.key}` : ''}: ${r.error}`);
      } else if (!r.imported) {
        console.log(`  - ${r.type} ${r.key || r.target}: already present`);
      } else {
        console.log(`  ✓ ${r.type} ${r.key || r.target}: ${r.id}`);
      }
    }
  }
  return results;
}

async function forkCommand(args) {
  const sourceKey = args._[0];
  if (!sourceKey) throw new Error('fork requires <source-key>');

  const edits = {};
  if (args.key) edits.key = args.key;
  if (args.slug) edits.slug = args.slug;
  if (args.title) edits.title = args.title;
  if (args.content) edits.content = args.content;
  if (args.topic) edits.topic = args.topic;
  if (args.kind) edits.kind = args.kind;
  if (args['source-url']) edits.sourceUrl = args['source-url'];
  if (args['source-name']) edits.sourceName = args['source-name'];
  if (args['source-license']) edits.sourceLicense = args['source-license'];
  if (args.language) edits.language = args.language;

  const opts = {
    useHyperbeam: args['use-hyperbeam'] ?? false,
    useHyperbeamReference: args['use-hyperbeam-reference'] ?? (process.env.PERMABRAIN_HYPERBEAM_REFERENCES === '1' ? true : undefined),
    targetId: args['target-id']
  };

  const result = await forkArticle(sourceKey, edits, opts);
  if (args.json) printJson(result);
  else {
    console.log(`Forked ${result.source.key} → ${result.fork.key}`);
    console.log(`Source ID: ${result.source.id} (v${result.source.version})`);
    console.log(`Fork ID: ${result.fork.id} (v${result.fork.version})`);
    if (result.editsApplied.length) {
      console.log(`Edits: ${result.editsApplied.join(', ')}`);
    }
    if (result.reference) {
      console.log(`Reference: ${result.reference.referenceId} (${result.reference.action})`);
    }
  }
  return result;
}

async function listForksCommand(args) {
  const sourceKey = args._[0];
  if (!sourceKey) throw new Error('list-forks requires <source-key>');
  const result = await listForks(sourceKey, { useHyperbeam: args['use-hyperbeam'] ?? false });
  if (args.json) printJson(result);
  else {
    console.log(`Forks of ${sourceKey}: ${result.length}`);
    for (const fork of result) {
      console.log(`  ${fork.key} (v${fork.version}): ${fork.title || '(untitled)'} — forked from v${fork.sourceVersion}`);
    }
  }
  return result;
}

async function diffCommand(args) {
  const base = args._[0];
  const head = args._[1];

  // Support single-key local-vs-remote diff: permabrain diff <key> --local
  if (base && base.includes('/') && (!head || args.local)) {
    const result = await diffLocalVsRemote(base, {
      useHyperbeam: args['use-hyperbeam'] ?? false,
      format: args.json ? 'json' : (args.format || 'unified'),
      context: args.context ? Number(args.context) : undefined
    });
    if (args.json) printJson(result);
    else if (args.format === 'json') printJson(result);
    else process.stdout.write(result.text + '\n');
    return result;
  }

  if (!base || !head) throw new Error('diff requires <base> <head> (identifiers, keys, or id:id)');
  const result = await diffArticles(base, head, {
    useHyperbeam: args['use-hyperbeam'] ?? false,
    format: args.json ? 'json' : (args.format || 'unified'),
    context: args.context ? Number(args.context) : undefined,
    preview: args['no-preview'] ? false : true
  });
  if (args.json) printJson(result);
  else if (args.format === 'json') printJson(result);
  else process.stdout.write(result.text + '\n');
  return result;
}

async function statusCommand(args) {
  const result = await status({ useHyperbeam: args['use-hyperbeam'] ?? false, home: getHome() });
  if (args.json) {
    printJson(result);
  } else {
    console.log(`PermaBrain status: ${result.home} (${result.transport})`);
    console.log(`  Transport: ${result.transportOk ? 'ok' : 'degraded'}`);
    const s = result.summary;
    console.log(`  Articles: ${s.localArticles} local, ${s.remoteArticles} remote latest`);
    console.log(`  Divergences: ${s.divergenceCount} (${s.conflictCount} conflict, ${s.mergeableCount} mergeable)`);
    console.log(`  Forks: ${s.forkCount}`);
    console.log(`  Attestations: ${s.totalAttestations} across ${s.attestationTargets} keys`);
    if (result.remoteError) console.log(`  Remote query error: ${result.remoteError}`);
    if (s.divergenceCount) {
      console.log('  Pending divergences:');
      for (const d of result.divergences) {
        const note = d.encrypted ? 'encrypted' : (d.mergeable ? 'mergeable' : 'manual');
        console.log(`    ${d.key}: ${d.localId} <-> ${d.remoteId} (${note})`);
      }
    }
    if (s.forkCount) {
      console.log('  Fork heads:');
      for (const f of result.forkHeads) {
        console.log(`    ${f.key} (from ${f.sourceKey}) v${f.version}: ${f.id}`);
      }
    }
  }
  return result;
}

async function searchCommand(args) {
  const query = args._[0];
  if (!query) throw new Error('search requires <query>');
  const opts = {
    home: getHome(),
    useHyperbeam: args['use-hyperbeam'] ?? false,
    limit: args.limit ? Number(args.limit) : undefined,
    offset: args.offset ? Number(args.offset) : undefined,
    kind: args.kind,
    topic: args.topic,
    author: args.author,
    key: args.key,
    after: args.after,
    before: args.before
  };
  const result = await searchArticles(query, opts);
  if (args.json) {
    printJson(result);
  } else {
    console.log(`PermaBrain search: "${result.query}" — ${result.total} result(s) (limit ${result.limit}, offset ${result.offset})`);
    for (const item of result.results) {
      const meta = [
        `v${item.version}`,
        item.kind,
        item.topic,
        item.sourceName,
        item.updatedAt ? new Date(item.updatedAt).toISOString().slice(0, 10) : ''
      ].filter(Boolean).join(' · ');
      const encryptedFlag = item.encrypted ? ' [encrypted]' : '';
      console.log(`  ${item.key}${encryptedFlag}`);
      console.log(`    ${item.title || '(untitled)'} — ${meta}`);
      if (item.matchedTerms?.length) console.log(`    matched: ${item.matchedTerms.join(', ')}`);
      if (item.snippet) console.log(`    ${item.snippet}`);
    }
  }
  return result;
}

async function topicCommand(args) {
  const topic = args._[0];
  if (!topic) throw new Error('topic requires <topic>');
  const opts = {
    home: getHome(),
    useHyperbeam: args['use-hyperbeam'] ?? false,
    kind: args.kind,
    language: args.language,
    agent: args.author,
    sort: args.sort || 'date',
    limit: args.limit ? Number(args.limit) : undefined,
    offset: args.offset ? Number(args.offset) : undefined,
    includeAttestations: args['no-attestations'] !== true
  };
  const result = await topicFeed(topic, opts);
  if (args.json) {
    printJson(result);
  } else {
    console.log(feedToMarkdown(result));
  }
  return result;
}

async function listCommand(args) {
  const opts = {
    home: getHome(),
    useHyperbeam: args['use-hyperbeam'] ?? false,
    kind: args.kind,
    topic: args.topic,
    author: args.author,
    after: args.after,
    before: args.before,
    sort: args.sort || 'date',
    limit: args.limit ? Number(args.limit) : undefined,
    offset: args.offset ? Number(args.offset) : undefined
  };
  const result = await listArticles(opts);
  if (args.json) {
    printJson(result);
  } else {
    console.log(listToMarkdown(result));
  }
  return result;
}

async function exportArticlesCommand(args) {
  const opts = {
    home: getHome(),
    useHyperbeam: args['use-hyperbeam'] ?? false,
    kind: args.kind,
    topic: args.topic,
    author: args.author,
    after: args.after,
    before: args.before,
    sort: args.sort || 'date',
    limit: args.limit ? Number(args.limit) : undefined,
    offset: args.offset ? Number(args.offset) : undefined,
    format: args.format || (args.json ? 'json' : 'markdown')
  };
  const result = await exportArticles(opts);
  const output = args.json || result.format === 'json'
    ? JSON.stringify(result, null, 2) + '\n'
    : result.markdown;
  if (args.output) {
    fs.writeFileSync(args.output, output);
    console.log(`Exported ${result.total} articles to ${args.output} (${result.format})`);
  } else if (args.json || result.format === 'json') {
    printJson(result);
  } else {
    console.log(output);
  }
  return result;
}

async function configCommand(args) {
  const action = args._[0] || 'get';
  const opts = { action, home: getHome() };
  if (action === 'get' || action === 'set') {
    opts.path = args._[1] || args.path || undefined;
  }
  if (action === 'set') {
    opts.value = args._[2] !== undefined ? args._[2] : args.value;
  }
  const result = runConfigCommand(opts);
  if (args.json) {
    printJson(result);
  } else {
    if (action === 'env') {
      const active = Object.entries(result.env).filter(([, v]) => v.active);
      const inactive = Object.entries(result.env).filter(([, v]) => !v.active);
      console.log(`Active environment variables (${active.length}):`);
      for (const [name, v] of active) console.log(`  ${name}=${v.value} → ${v.mapsTo}`);
      console.log(`Inactive (${inactive.length}): ${inactive.map(([n]) => n).join(', ')}`);
    } else if (action === 'get' && !opts.path) {
      console.log(configToMarkdown(result.config, result.sources));
    } else if (action === 'set') {
      console.log(`Set ${result.path} = ${JSON.stringify(result.value)}`);
      if (result.validation.warnings?.length) console.log(`Warnings: ${result.validation.warnings.join('; ')}`);
    } else if (action === 'validate') {
      console.log(`Validation: ${result.ok ? 'ok' : 'failed'}`);
      for (const err of result.errors) console.log(`  ✗ ${err}`);
      for (const w of result.warnings) console.log(`  ! ${w}`);
    } else if (action === 'reset') {
      console.log('Config reset to defaults');
      console.log(configToMarkdown(result.config, {}));
    } else {
      console.log(`${opts.path}: ${JSON.stringify(result.value)}`);
    }
  }
  return result;
}

async function metricsCommand(args) {
  const opts = {
    home: getHome(),
    kind: args.kind,
    topic: args.topic,
    author: args.author,
    after: args.after,
    before: args.before,
    top: args.top ? Number(args.top) : undefined
  };
  const result = computeMetrics(opts);
  if (args.json) {
    printJson(result);
  } else {
    console.log(metricsToMarkdown(result));
  }
  return result;
}

async function statsCommand(args) {
  const opts = {
    home: getHome(),
    kind: args.kind,
    topic: args.topic,
    author: args.author,
    after: args.after,
    before: args.before,
    top: args.top ? Number(args.top) : undefined
  };
  const result = computeStats(opts);
  if (args.json) {
    printJson(result);
  } else {
    console.log(statsToMarkdown(result));
  }
  return result;
}

async function activityCommand(args) {
  const opts = {
    home: getHome(),
    useHyperbeam: args['use-hyperbeam'] ?? false,
    topic: args.topic,
    kind: args.kind,
    key: args.key,
    agent: args.agent,
    author: args.author,
    attestedBy: args['attested-by'],
    eventKind: args['event-kind'],
    after: args.after,
    before: args.before,
    order: args.order || 'desc',
    limit: args.limit ? Number(args.limit) : undefined,
    offset: args.offset ? Number(args.offset) : undefined
  };
  const result = await activityFeed(opts);
  if (args.json) {
    printJson(result);
  } else {
    console.log(activityToMarkdown(result));
  }
  return result;
}

async function remoteCommand(args) {
  const action = args._[0] || 'list';
  const name = args._[1] || args.name || undefined;
  const url = args.url || args._[2] || undefined;

  if (action === 'list') {
    const data = listRemotes(getHome());
    if (args.json) printJson(data);
    else console.log(remotesToMarkdown(data));
    return data;
  }

  if (action === 'add') {
    if (!name) throw new Error('remote add requires <name>');
    if (!url) throw new Error('remote add requires <url>');
    const values = {
      url,
      transport: args.transport,
      graphqlUrl: args['graphql-url'],
      dataUrl: args['data-url'],
      uploadUrl: args['upload-url'],
      hyperbeamReferences: args['hyperbeam-references'],
      description: args.description
    };
    const result = addRemote(name, values, getHome());
    if (args.json) printJson(result);
    else console.log(`Added remote '${result.remote.name}' as default '${result.defaultRemote}'`);
    return result;
  }

  if (action === 'remove' || action === 'rm') {
    if (!name) throw new Error('remote remove requires <name>');
    const result = removeRemote(name, getHome());
    if (args.json) printJson(result);
    else console.log(`Removed remote '${result.remote.name}'. Default is now '${result.defaultRemote || '(none)'}'`);
    return result;
  }

  if (action === 'default') {
    if (!name) throw new Error('remote default requires <name>');
    const result = setDefaultRemote(name, getHome());
    if (args.json) printJson(result);
    else console.log(`Default remote set to '${result.defaultRemote}'`);
    return result;
  }

  if (action === 'probe') {
    const result = await probeRemote(name, getHome());
    if (args.json) printJson(result);
    else {
      console.log(`Remote '${result.name}' probe: ${result.url} (${result.transport})`);
      for (const check of result.checks) {
        console.log(`${check.ok ? 'ok' : 'fail'} ${check.name} ${check.status || check.error || ''}`.trim());
      }
    }
    return result;
  }

  throw new Error(`Unknown remote action: ${action}`);
}

async function archiveCommand(args) {
  const home = getHome();
  const passphrase = args.passphrase;
  const recipients = args.recipient ? (Array.isArray(args.recipient) ? args.recipient : [args.recipient]) : [];

  const ar = await archive({ home, passphrase, recipients });

  if (args.output) {
    fs.writeFileSync(args.output, JSON.stringify(ar, null, 2) + '\n');
  }

  if (args.json || !args.output) {
    printJson(ar);
  } else {
    console.log(`Archive created for ${ar.agentId}`);
    console.log(`  Files: ${ar.entries.length}`);
    console.log(`  Recipients: ${ar.encryption.recipientCount}`);
    console.log(`  Passphrase: ${ar.encryption.hasPassphrase ? 'yes' : 'no'}`);
    console.log(`  Written to: ${args.output || '(stdout)'}`);
  }
  return ar;
}

async function restoreCommand(args) {
  const file = args._[0] || args.file;
  if (!file) throw new Error('restore requires <file>');
  const home = args.home || getHome();
  const passphrase = args.passphrase;
  const dryRun = args['dry-run'] === true || args['dry-run'] === 'true';

  const raw = fs.readFileSync(file, 'utf8');
  const ar = JSON.parse(raw);
  const result = await restore(ar, { home, passphrase, dryRun });

  if (args.json) {
    printJson(result);
  } else {
    console.log(`Restore ${result.dryRun ? '(dry-run)' : 'complete'}: ${result.entriesRestored} files`);
    for (const p of result.paths) {
      console.log(`  ${p}`);
    }
  }
  return result;
}

async function backupCommand(args) {
  const action = args._[0] || 'create';
  const home = getHome();

  if (action === 'create') {
    const passphrase = args.passphrase;
    if (!passphrase) throw new Error('backup create requires --passphrase <text>');
    const result = await createBackup(home, {
      passphrase,
      recipients: args.recipient ? (Array.isArray(args.recipient) ? args.recipient : [args.recipient]) : [],
      name: args.name
    });
    if (args.json) printJson(result);
    else {
      console.log(`Backup created: ${result.name}`);
      console.log(`  Files: ${result.meta.entries}`);
      console.log(`  Recipients: ${result.meta.recipientCount}`);
      console.log(`  Passphrase: ${result.meta.hasPassphrase ? 'yes' : 'no'}`);
      console.log(`  Path: ${result.path}`);
    }
    return result;
  }

  if (action === 'list') {
    const backups = listBackups(home);
    if (args.json) printJson({ home, backups });
    else console.log(backupsToMarkdown(backups, { home }));
    return { home, backups };
  }

  if (action === 'restore') {
    const backup = args._[1] || args.backup;
    if (!backup) throw new Error('backup restore requires <backup-name|index>');
    const result = await restoreBackup(home, {
      backup,
      passphrase: args.passphrase,
      dryRun: args['dry-run'] === true || args['dry-run'] === 'true'
    });
    if (args.json) printJson(result);
    else {
      console.log(`Restore from ${result.backup} ${result.dryRun ? '(dry-run)' : 'complete'}: ${result.entriesRestored} files`);
      for (const p of result.paths) console.log(`  ${p}`);
    }
    return result;
  }

  if (action === 'prune') {
    const keep = args.keep ? Number(args.keep) : undefined;
    const maxAgeDays = args['max-age-days'] ? Number(args['max-age-days']) : undefined;
    const dryRun = args['dry-run'] === true || args['dry-run'] === 'true';
    const result = pruneBackups(home, { keep, maxAgeDays, dryRun });
    if (args.json) printJson(result);
    else {
      const mode = dryRun ? 'would keep' : 'kept';
      const rmode = dryRun ? 'would remove' : 'removed';
      console.log(`Prune backups: ${result.kept.length} ${mode}, ${result.removed.length} ${rmode}`);
      for (const b of result.removed) console.log(`  ${rmode} ${b.name} (${b.createdAt})`);
    }
    return result;
  }

  throw new Error(`Unknown backup action: ${action}`);
}

async function mergeCommand(args) {
  const targetKey = args._[0];
  const sourceKey = args._[1];
  if (!targetKey || !sourceKey) throw new Error('merge requires <target-key> <source-key>');

  const opts = {
    useHyperbeam: args['use-hyperbeam'] ?? false,
    useHyperbeamReference: args['use-hyperbeam-reference'] ?? (process.env.PERMABRAIN_HYPERBEAM_REFERENCES === '1' ? true : undefined),
    carryAttestations: args['no-carry-attestations'] ? false : true
  };
  if (args.title) opts.title = args.title;
  if (args.topic) opts.topic = args.topic;
  if (args.kind) opts.kind = args.kind;
  if (args['source-url']) opts.sourceUrl = args['source-url'];
  if (args['source-name']) opts.sourceName = args['source-name'];
  if (args['source-license']) opts.sourceLicense = args['source-license'];
  if (args.language) opts.language = args.language;

  const result = await mergeArticles(targetKey, sourceKey, opts);
  if (args.json) printJson(result);
  else {
    const conflicts = result.hasConflicts ? ` ⚠ ${result.conflictCount} conflict(s)` : ' no conflicts';
    console.log(`Merged ${result.source.key} → ${result.target.key}`);
    console.log(`Ancestor: ${result.ancestor?.id || '(target used as base)'}`);
    console.log(`New version: ${result.merged.id} (v${result.merged.version})${conflicts}`);
    console.log(`Edits applied: ${result.editsApplied.join(', ') || 'none'}`);
    if (result.carriedAttestations.length) {
      console.log(`Attestations carried forward: ${result.carriedAttestations.filter((a) => a.id).length}`);
      for (const att of result.carriedAttestations) {
        if (att.error) console.log(`  ✗ ${att.sourceAttestationId}: ${att.error}`);
        else console.log(`  ✓ ${att.id}: ${att.opinion} (${att.confidence}) by ${att.agentId}`);
      }
    }
    if (result.reference) {
      console.log(`Reference: ${result.reference.referenceId} (${result.reference.action})`);
    }
  }
  return result;
}

async function doctorCommand(args) {
  const home = getHome();
  const report = await runDoctor(home, { fix: args.fix === true || args.fix === 'true' });
  if (args.json) printJson(report);
  else console.log(doctorReportToMarkdown(report));
  if (!report.ok && process.env.PERMABRAIN_REQUIRE_DOCTOR_OK === '1') throw new Error('PermaBrain doctor found issues');
  return report;
}

async function logCommand(args) {
  const home = getHome();
  const result = queryLog({
    home,
    action: args.action,
    status: args.status,
    key: args.key,
    agentId: args.agent || args['agent-id'],
    after: args.after,
    before: args.before,
    search: args.search,
    order: args.order,
    limit: args.limit ? Number(args.limit) : undefined,
    offset: args.offset ? Number(args.offset) : undefined,
    markdown: args.markdown
  });
  if (args.json) printJson(result);
  else console.log(args.markdown ? logToMarkdown(result) : logToMarkdown(result));
  return result;
}

async function serveCommand(args) {
  const port = args.port ? Number(args.port) : (args.p ? Number(args.p) : undefined);
  const home = getHome();
  const result = await startServer({ home, port });
  console.log(`PermaBrain HTTP API serving at http://localhost:${result.port}`);
  console.log(`Home: ${result.home}`);
  console.log(`Agent: ${result.agentId || 'unknown'}`);

  const shutdown = async (signal) => {
    console.log(`\n${signal} received, stopping server...`);
    await stopServer(result.server);
    process.exit(0);
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));

  return new Promise(() => {}); // keep running until signal
}
