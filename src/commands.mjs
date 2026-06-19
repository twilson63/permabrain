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
import { buildDashboard, dashboardToHtml, dashboardToMarkdown, writeDashboard, publishDashboard } from './dashboard.mjs';
import { shareEncryptedArticle, publishEncryptedShare, buildEncryptedSharePage } from './share-encrypted.mjs';
import { runConfigCommand, configToMarkdown } from './config-manager.mjs';
import { listRemotes, addRemote, removeRemote, setDefaultRemote, probeRemote, remotesToMarkdown } from './remotes.mjs';
import { createBackup, listBackups, restoreBackup, pruneBackups, backupsToMarkdown } from './backup.mjs';
import { startServer, stopServer } from './serve.mjs';
import { renderTemplate, createArticleFromTemplate } from './template.mjs';
import { runDoctor, doctorReportToMarkdown } from './doctor.mjs';
import { queryLog, logToMarkdown, logAction, tailLog, followLog, exportLog, importLog } from './log.mjs';
import { requestLogger, accessLogResultToMarkdown } from './request-log.mjs';
import { generateCompletion, listSupportedShells } from './completion.mjs';
import { validateArticleMetadata, validateAttestationMetadata, validateDataItemTags, formatValidationErrors } from './schema.mjs';
import { subscribeEventsRemote, runEventsSubscriber } from './events-client.mjs';
import {
  createThresholdEnvelope,
  addCoSigner,
  finalizeThresholdAttestation,
  verifyThresholdEnvelope,
  verifyThresholdSignature,
  signThresholdDigest,
  importThresholdEnvelope,
  exportThresholdEnvelope
} from './threshold-attestation.mjs';

import {
  peerInfo,
  diffPeerKeys,
  diffKeysForPush,
  buildPeerPullBundle,
  buildPeerPushBundle,
  pullFromPeer,
  pullFromPeerAsBundle,
  pushToPeer,
  pushToPeerClient,
  peerStatus,
  peerInfoToMarkdown,
  peerStatusToMarkdown
} from './peer.mjs';

import { importBundleAutoDetect, importReportToMarkdown, BUNDLE_TYPES, detectBundleType } from './import-unified.mjs';
import { publishDirectory, publishDirectoryToMarkdown } from './publish-dir.mjs';
import fs from 'node:fs';
import path from 'node:path';

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
  if (command === 'share-encrypted') return shareEncryptedCommand(args);
  if (command === 'verify') return verifyCommand(args);
  if (command === 'export-bundle') return exportBundleCommand(args);
  if (command === 'export-history') return exportHistoryCommand(args);
  if (command === 'export-all') return exportAllCommand(args);
  if (command === 'import-bundle') return importBundleCommand(args);
  if (command === 'import-history') return importHistoryCommand(args);
  if (command === 'import') return importUnifiedCommand(args);
  if (command === 'publish-dir') return publishDirectoryCommand(args);
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
  if (command === 'access-log') return accessLogCommand(args);
  if (command === 'template') return templateCommand(args);
  if (command === 'dashboard') return dashboardCommand(args);
  if (command === 'client') return clientCommand(args);
  if (command === 'completion') return completionCommand(args);
  if (command === 'validate') return validateCommand(args);
  if (command === 'events') return eventsCommand(args);
  if (command === 'query-stream') return queryStreamCommand(args);
  if (command === 'subscribe') return subscribeRemoteCommand(args);
  if (command === 'threshold-attest' || command === 'threshold') return thresholdAttestCommand(args);
  if (command === 'peer') return peerCommand(args);
  if (command === 'shell') return shellCommand(args);
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

async function shareEncryptedCommand(args) {
  const file = args._[0];
  if (!file) throw new Error('share-encrypted requires <file>');
  if (!args.for) throw new Error('--for is required (comma-separated X25519 public keys)');
  const encryptedFor = String(args.for).split(',').map(k => k.trim()).filter(Boolean);
  if (encryptedFor.length === 0) throw new Error('--for must include at least one recipient public key');

  const result = await shareEncryptedArticle({
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
    recipientKeyId: args['recipient-key-id'],
    recipient: args.recipient,
    pageId: args['page-id'],
    subdomain: args.subdomain,
    baseUrl: args['base-url'],
    alsoPublish: args['also-publish'] === true || args['also-publish'] === 'true',
    useHyperbeam: args['use-hyperbeam'] ?? false
  });

  // Optionally publish the share page to ZenBin.
  let publishResult = null;
  if (!args.output) {
    const { resolveZenBinCredentials } = await import('./agent-api.mjs');
    const { keyId, privateJwk } = await resolveZenBinCredentials({
      keyId: args['key-id'],
      privateJwk: args['private-jwk'] ? JSON.parse(args['private-jwk']) : undefined
    });
    publishResult = await publishEncryptedShare(result.share, {
      keyId,
      privateJwk,
      pageId: args['page-id'],
      subdomain: args.subdomain,
      baseUrl: args['base-url']
    });
  }

  // Optionally write the share HTML to disk.
  if (args.output) {
    fs.writeFileSync(args.output, result.share.html, 'utf8');
  }

  if (args.json) {
    const out = {
      key: result.share.key,
      title: result.share.title,
      agentId: result.share.agentId,
      publishedAt: result.share.publishedAt,
      recipientFingerprints: result.share.recipientFingerprints,
      recipientKeyId: result.share.recipientKeyId,
      bytes: result.share.html ? Buffer.byteLength(result.share.html, 'utf8') : 0,
      output: args.output || null,
      zenbin: publishResult ? { pageId: publishResult.pageId, url: publishResult.url } : null,
      article: result.article ? { id: result.article.id, key: result.article.key, version: result.article.version } : null
    };
    printJson(out);
  } else {
    console.log(`Encrypted share prepared for ${result.share.key}`);
    console.log(`Recipients: ${result.share.recipientFingerprints.length}`);
    if (result.share.recipientKeyId) console.log(`CAP recipient: ${result.share.recipientKeyId}`);
    if (args.output) console.log(`Wrote: ${args.output}`);
    if (publishResult) console.log(`ZenBin: ${publishResult.url}`);
    if (result.article) console.log(`Also published article: ${result.article.id}`);
  }
  return { ...result, publishResult };
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

async function publishDirectoryCommand(args) {
  const dir = args._[0] || args.dir;
  if (!dir) throw new Error('publish-dir requires <dir>');
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new Error(`Not a directory: ${dir}`);
  const visibility = args.visibility || args.publish || 'public';
  if (!['public', 'encrypted', 'private'].includes(visibility)) throw new Error(`--visibility must be public, encrypted, or private (got: ${visibility})`);
  const encryptedFor = args.for ? String(args.for).split(',').map(k => k.trim()).filter(Boolean) : [];
  const result = await publishDirectory(dir, {
    home: getHome(),
    recursive: args.recursive === true || args.recursive === 'true',
    dryRun: args['dry-run'] === true || args['dry-run'] === 'true',
    topic: args.topic,
    kind: args.kind,
    title: args.title,
    sourceUrl: args['source-url'],
    sourceName: args['source-name'],
    sourceLicense: args['source-license'] || '',
    language: args.language || 'en',
    useHyperbeam: args['use-hyperbeam'] ?? false,
    useHyperbeamReference: args['use-hyperbeam-reference'] ?? (process.env.PERMABRAIN_HYPERBEAM_REFERENCES === '1' ? true : undefined),
    encryptedFor,
    visibility,
  });
  if (args.json) printJson(result);
  else if (args.markdown) console.log(publishDirectoryToMarkdown(result));
  else {
    console.log(`Publish directory ${dir}: ${result.count} files`);
    console.log(`Succeeded: ${result.succeeded}, Failed: ${result.failed}, Skipped: ${result.skipped}`);
    for (const r of result.results) {
      if (r.status === 'ok') console.log(`  ✓ ${r.key}: ${r.id}`);
      else if (r.status === 'dry-run') console.log(`  ~ ${r.key} [${r.kind}/${r.topic}]`);
      else console.log(`  ✗ ${r.key || '(no key)'}: ${r.error}`);
    }
  }
  return result;
}

async function importUnifiedCommand(args) {
  const file = args._[0] || args.file;
  if (!file) throw new Error('import requires <file>');
  const raw = fs.readFileSync(file, 'utf8');
  const bundle = JSON.parse(raw);
  const type = detectBundleType(bundle);
  const opts = {
    home: getHome(),
    dryRun: args['dry-run'] === true,
    verify: args['no-verify'] !== true,
    skipDuplicates: args['skip-duplicates'] !== false,
    finalize: args['finalize'] === true,
    seed: args.seed,
    publish: args['no-publish'] !== true,
    useHyperbeam: args['use-hyperbeam'] ?? false
  };
  const result = await importBundleAutoDetect(bundle, opts);
  if (args.json) printJson(result);
  else if (args.markdown) console.log(importReportToMarkdown(result));
  else {
    if (result.dryRun) console.log(`Dry-run import (${type}): ${result.imported || 0} to import, ${result.skipped || 0} to skip, ${result.failed || 0} to fail`);
    else {
      if (result.type === BUNDLE_TYPES.ARTICLE) console.log(`Import bundle: ${result.imported} imported, ${result.skipped} skipped, ${result.failed} failed`);
      else if (result.type === BUNDLE_TYPES.HISTORY) console.log(`Import history: ${result.importedArticles} articles, ${result.importedAttestations} attestations imported`);
      else if (result.type === BUNDLE_TYPES.THRESHOLD) console.log(`Import threshold: ${result.envelopeId} imported, finalized=${result.finalized}`);
      else if (result.type === BUNDLE_TYPES.ENCRYPTED_SHARE) console.log(`Import encrypted share: ${result.key} decrypted, published=${result.published}`);
      else console.log('Import complete');
    }
    if (result.items?.length) {
      for (const item of result.items) {
        if (!item.error && item.action !== 'error') {
          if (item.action === 'skip') console.log(`  - ${item.type} ${item.key || ''}: already present`);
          else console.log(`  ✓ ${item.type} ${item.key || ''}: ${item.id || 'new'}`);
        } else {
          console.log(`  ✗ ${item.type || ''} ${item.key || ''}: ${item.error}`);
        }
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

async function dashboardCommand(args) {
  const home = getHome();
  const opts = {
    home,
    config: args.config,
    kind: args.kind,
    topic: args.topic,
    author: args.author,
    key: args.key,
    agent: args.agent,
    after: args.after,
    before: args.before,
    sort: args.sort || 'date',
    order: args.order || 'desc',
    articleLimit: args['article-limit'] ? Number(args['article-limit']) : undefined,
    activityLimit: args['activity-limit'] ? Number(args['activity-limit']) : undefined,
    logLimit: args['log-limit'] ? Number(args['log-limit']) : undefined,
    useHyperbeam: args['use-hyperbeam'] ?? false,
    title: args.title
  };
  const data = await buildDashboard(opts);

  if (args.publish || args['publish-dashboard']) {
    const publishOpts = {
      keyId: args['key-id'],
      privateJwk: args['private-jwk'],
      pageId: args['page-id'],
      title: args.title,
      recipientKeyId: args['recipient-key-id'],
      recipient: args.recipient,
      subdomain: args.subdomain
    };
    const result = await publishDashboard(data, publishOpts);
    if (args.json) {
      printJson(result);
    } else {
      console.log(`Dashboard published to ${result.url}`);
      console.log(`Page id: ${result.pageId}`);
      console.log(`Bytes: ${result.bytes}`);
      if (result.recipientKeyId) console.log(`Recipient: ${result.recipientKeyId}`);
    }
    return result;
  }

  const output = args.output || args.file;
  if (output) {
    const written = await writeDashboard(data, { output, title: opts.title });
    if (args.json) {
      printJson({ path: written.path, bytes: written.bytes, agentId: data.agentId, generatedAt: data.generatedAt });
    } else {
      console.log(`Dashboard written to ${written.path} (${written.bytes} bytes)`);
    }
    return written;
  }
  if (args.markdown || args.format === 'markdown') {
    console.log(dashboardToMarkdown(data, { title: opts.title }));
    return { markdown: dashboardToMarkdown(data, { title: opts.title }) };
  }
  if (args.json) {
    printJson(data);
    return data;
  }
  // Default: print markdown summary and HTML path hint.
  console.log(dashboardToMarkdown(data, { title: opts.title }));
  console.log(`\nUse --output dashboard.html to write a self-contained HTML snapshot, or --publish to upload to ZenBin.`);
  return data;
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

async function templateCommand(args) {
  const filePath = args._[0];
  const source = args.source;
  if (!filePath && !source) throw new Error('template requires <template-file> or --source <source>');
  let variables = args.variables || {};
  if (typeof variables === 'string') {
    try { variables = JSON.parse(variables); } catch (e) { throw new Error(`--variables must be valid JSON: ${e.message}`); }
  }
  let recipients = args.recipients || [];
  if (typeof recipients === 'string') {
    recipients = recipients.split(',').map(s => s.trim()).filter(Boolean);
  }
  const opts = {
    home: getHome(),
    variables,
    topic: args.topic,
    kind: args.kind,
    title: args.title,
    key: args.key,
    app: args.app,
    sourceUrl: args.sourceUrl || 'template://local',
    encrypt: args.encrypt === true || args.encrypt === 'true',
    recipients,
    publishOptions: {
      useHyperbeam: args['use-hyperbeam'] ?? false,
      useHyperbeamReference: args['use-hyperbeam-reference'] ?? (process.env.PERMABRAIN_HYPERBEAM_REFERENCES === '1' ? true : undefined),
    },
  };
  if (source) opts.source = source;
  const result = await createArticleFromTemplate(filePath || source, opts);
  if (args.json) printJson(result);
  else {
    console.log(`Created article from template: ${result.key}`);
    if (result.encrypted) console.log('  encrypted: true');
  }
  return result;
}

async function logCommand(args = {}) {
  const home = getHome();
  const subcommand = (args._ || [])[0];

  if (subcommand === 'export') {
    const format = args.format === 'jsonl' || args.jsonl ? 'jsonl' : 'json';
    const bundle = exportLog({ home, format });
    if (args.output) {
      const payload = bundle.format === 'jsonl' ? bundle.raw : JSON.stringify(bundle, null, 2) + '\n';
      fs.writeFileSync(args.output, payload);
    }
    if (args.json || bundle.format === 'jsonl') {
      if (bundle.format === 'jsonl') {
        if (!args.output) process.stdout.write(bundle.raw);
      } else {
        printJson(bundle);
      }
    } else {
      console.log(`Audit log export: ${bundle.entries.length} entries`);
    }
    return bundle;
  }

  if (subcommand === 'import') {
    const file = args._[1] || args.file;
    if (!file) throw new Error('log import requires <file>');
    const raw = fs.readFileSync(file, 'utf8');
    let bundle;
    try {
      bundle = JSON.parse(raw);
    } catch {
      // Treat as JSONL.
      const entries = raw.split('\n').filter(Boolean).map((line) => JSON.parse(line));
      bundle = {
        type: 'audit-log',
        version: '1.0',
        meta: { entryCount: entries.length },
        entries
      };
    }
    const result = importLog(bundle, { home, skipDuplicates: args['skip-duplicates'] !== false });
    if (args.json) printJson(result);
    else {
      console.log(`Audit log import: ${result.imported} imported, ${result.skipped} skipped, ${result.failed} failed`);
    }
    return result;
  }

  if (args.follow) {
    const filters = {
      action: args.action,
      status: args.status,
      key: args.key,
      agentId: args.agent || args['agent-id'],
      after: args.after,
      before: args.before,
      search: args.search
    };
    const follower = followLog({ home, interval: args.interval ? Number(args.interval) : undefined, tail: args.tail ? Number(args.tail) : 10, ...filters });
    process.once('SIGINT', () => follower.cancel());
    process.once('SIGTERM', () => follower.cancel());
    for await (const entry of follower) {
      if (args.json) {
        console.log(JSON.stringify(entry));
      } else {
        const ts = entry.createdAt ? new Date(entry.createdAt).toISOString() : 'unknown';
        const keyPart = entry.key ? ` ${entry.key}` : '';
        console.log(`${ts} [${entry.status || 'ok'}] ${entry.action}${keyPart}: ${entry.message || ''}`);
      }
    }
    return { status: 'following-stopped' };
  }

  if (args.tail) {
    const limit = args.tail === true ? 10 : Number(args.tail);
    const result = tailLog({
      home,
      action: args.action,
      status: args.status,
      key: args.key,
      agentId: args.agent || args['agent-id'],
      after: args.after,
      before: args.before,
      search: args.search,
      limit
    });
    if (args.json) printJson(result);
    else console.log(logToMarkdown(result));
    return result;
  }

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

async function clientCommand(args) {
  const baseUrl = args.url || args['base-url'] || 'http://localhost:8765';
  const action = args._[0] || 'health';
  const apiKey = args['api-key'] || process.env.PERMABRAIN_API_KEY || undefined;
  const { createClient } = await import('./client.mjs');
  const client = createClient({ baseUrl, apiKey });

  if (action === 'health') {
    const result = await client.health();
    if (args.json) printJson(result);
    else console.log(`PermaBrain client → ${baseUrl}: ok=${result.ok} transport=${result.transport} agentId=${result.agentId}`);
    return result;
  }

  if (action === 'status') {
    const result = await client.status();
    if (args.json) printJson(result);
    else console.log(`PermaBrain client status → ${baseUrl}: ${result.home} (${result.transport})`);
    return result;
  }

  if (action === 'routes') {
    const result = await client.routes();
    if (args.json) printJson(result);
    else {
      console.log(`PermaBrain client routes → ${baseUrl}: ${result.routes.length} routes`);
      for (const r of result.routes) {
        const auth = r.public ? 'public' : (apiKey ? 'auth' : 'auth optional');
        console.log(`  ${r.method.padEnd(6)} ${r.route.padEnd(40)} ${auth} — ${r.description}`);
      }
    }
    return result;
  }

  if (action === 'openapi') {
    const result = await client.openapi();
    if (args.json) printJson(result);
    else {
      console.log(`PermaBrain client openapi → ${baseUrl}`);
      console.log(`  version: ${result.info?.version}`);
      console.log(`  title: ${result.info?.title}`);
      console.log(`  paths: ${Object.keys(result.paths || {}).length}`);
      if (result.components?.securitySchemes) {
        console.log(`  security: ${Object.keys(result.components.securitySchemes).join(', ')}`);
      }
    }
    return result;
  }

  if (action === 'get') {
    const key = args._[1];
    if (!key) throw new Error('client get requires <canonical-key>');
    const result = await client.get(key, { useHyperbeam: args['use-hyperbeam'] });
    if (args.json) printJson(result);
    else process.stdout.write(result.content || '');
    return result;
  }

  if (action === 'query') {
    const result = await client.query({
      topic: args.topic,
      kind: args.kind,
      key: args.key,
      'use-hyperbeam': args['use-hyperbeam']
    });
    if (args.json) printJson(result);
    else {
      for (const a of result.articles) console.log(`${a.key}\tv${a.version}\t${a.title}\t${a.topic}`);
    }
    return result;
  }

  if (action === 'publish') {
    const file = args._[1];
    if (!file) throw new Error('client publish requires <file>');
    const fs = await import('node:fs');
    const content = fs.readFileSync(file, 'utf8');
    const result = await client.publish({
      content,
      kind: args.kind,
      topic: args.topic,
      sourceUrl: args['source-url'],
      sourceName: args['source-name'],
      title: args.title,
      key: args.key,
      language: args.language || 'en'
    });
    if (args.json) printJson(result.summary);
    else console.log(`Published ${result.summary.key} (id=${result.summary.id}, v${result.summary.version})`);
    return result;
  }

  throw new Error(`Unknown client action: ${action}. Try: health, status, routes, openapi, get, query, publish`);
}

async function accessLogCommand(args = {}) {
  args._ = args._ || [];
  if (args.help || args._[0] === '--help' || args._[0] === 'help') {
    console.log(`Usage: permabrain access-log [filters] [--tail [N]] [--follow] [--url <url>] [--source disk] [--method <method>] [--status <n>] [--path <substring>] [--after <date>] [--before <date>] [--limit N] [--offset N] [--count N] [--duration <ms>] [--markdown] [--json]

Query or follow the HTTP request/access log produced by 'permabrain serve'.
By default reads from the local home directory disk log (logs/access-log.jsonl).
Use --url to query a running server instead; use --follow to stream live entries
via the server's SSE endpoint.

Filters:
  --method <method>    Filter by HTTP method (GET, POST, ...)
  --status <n>         Filter by response status code
  --path <substring>   Filter by path substring
  --after <date>       Only entries on or after this ISO date
  --before <date>      Only entries on or before this ISO date
  --source disk        Query persisted disk log on the server (default memory)

Pagination/streaming:
  --limit N            Maximum results (default 100 on disk; server default otherwise)
  --offset N           Pagination offset
  --tail [N]           Show the N most recent entries (default 10)
  --follow             Stream new entries until interrupted (uses server SSE)
  --count N            Stop following after N entries
  --duration <ms>      Stop following after N milliseconds

Connection (when not using local disk):
  --url <url>          Server base URL (default http://localhost:8765)
  --api-key <key>      API key for protected endpoints

Output:
  --markdown           Render results as markdown
  --json               Output structured JSON

Examples:
  permabrain access-log --tail 20
  permabrain access-log --method GET --status 200 --path /api/v1/articles
  permabrain access-log --url http://localhost:8765 --source disk --limit 50
  permabrain access-log --follow --count 5
`);
    return { ok: true, help: true };
  }

  const home = getHome();
  const baseUrl = args.url || args.u || process.env.PERMABRAIN_URL || 'http://localhost:8765';
  const apiKey = args['api-key'] || process.env.PERMABRAIN_API_KEY || undefined;
  const filters = {
    method: args.method,
    status: args.status !== undefined ? Number(args.status) : undefined,
    path: args.path,
    after: args.after,
    before: args.before,
    limit: args.limit ? Number(args.limit) : undefined,
    offset: args.offset ? Number(args.offset) : undefined
  };
  const tailLimit = args.tail === true ? 10 : (args.tail ? Number(args.tail) : undefined);

  // Local disk query mode when no --url is explicitly provided and a home arg exists.
  const homeForAccessLog = args.home || home;
  const hasExplicitUrl = !!args.url || !!args.u || !!process.env.PERMABRAIN_URL;
  const hasLocalDisk = fs.existsSync(path.join(homeForAccessLog, 'logs', 'access-log.jsonl'));
  if (!args.follow && !hasExplicitUrl && hasLocalDisk) {
    const logger = requestLogger({ format: 'none', home: homeForAccessLog });
    const queryOptions = { ...filters };
    if (tailLimit !== undefined) {
      queryOptions.limit = tailLimit;
      queryOptions.offset = 0;
    }
    const result = await logger.queryDisk(queryOptions);
    if (args.json) printJson(result);
    else if (args.markdown) console.log(accessLogResultToMarkdown(result));
    else {
      console.log(`Access log entries: ${result.total} matching, ${result.entries.length} shown`);
      for (const e of result.entries) {
        console.log(`${e.timestamp} [${e.requestId}] ${e.method} ${e.path} ${e.statusCode} ${e.durationMs}ms`);
      }
    }
    return result;
  }

  if (args.follow) {
    const { createClient } = await import('./client.mjs');
    const client = createClient({ baseUrl, apiKey });
    const controller = new AbortController();
    function stop() { controller.abort(); }
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
    let count = 0;
    const maxEvents = args.count ? Number(args.count) : Infinity;
    const maxMs = args.duration ? Number(args.duration) : Infinity;
    const startTime = Date.now();
    try {
      const stream = client.requestsStream({ signal: controller.signal });
      for await (const event of stream) {
        if (event.type === 'error') {
          if (args.json) console.log(JSON.stringify(event));
          else console.error(`Error: ${event.message}`);
          continue;
        }
        if (args.json) console.log(JSON.stringify(event));
        else {
          const ts = event.timestamp || 'unknown';
          console.log(`${ts} [${event.requestId}] ${event.method} ${event.path} ${event.statusCode} ${event.durationMs}ms`);
        }
        count++;
        if (count >= maxEvents || (maxMs && Date.now() - startTime >= maxMs)) {
          stop();
          break;
        }
      }
    } catch (err) {
      if (!controller.signal.aborted) throw err;
    } finally {
      process.off('SIGINT', stop);
      process.off('SIGTERM', stop);
    }
    return { count, baseUrl };
  }

  // Remote query mode via HTTP API.
  const { createClient } = await import('./client.mjs');
  const client = createClient({ baseUrl, apiKey });
  const remoteFilters = { ...filters };
  if (tailLimit !== undefined) {
    remoteFilters.limit = tailLimit;
    remoteFilters.offset = 0;
  }
  if (args.source === 'disk' || args.disk) remoteFilters.source = 'disk';
  const result = args.markdown ? await client.requestsMarkdown(remoteFilters) : await client.requests(remoteFilters);
  if (args.json && !args.markdown) printJson(result);
  else if (args.markdown) console.log(result);
  else {
    const entries = result.entries || [];
    console.log(`Access log entries: ${result.total ?? entries.length} matching, ${entries.length} shown`);
    for (const e of entries) {
      console.log(`${e.timestamp} [${e.requestId}] ${e.method} ${e.path} ${e.statusCode} ${e.durationMs}ms`);
    }
  }
  return result;
}

async function validateCommand(args) {
  const subcommand = args._[0] || 'article';
  if (subcommand === '--help' || subcommand === 'help') {
    console.log(`Usage: permabrain validate <article|attestation> [path] [--json]

Validate article or attestation metadata against the PermaBrain JSON Schema.
If [path] is omitted, validates a built-in example.

Examples:
  permabrain validate article ./tags.json
  permabrain validate attestation ./tags.json --json`);
    return { ok: true, help: true };
  }
  if (!['article', 'attestation'].includes(subcommand)) throw new Error("validate subcommand must be 'article' or 'attestation'");
  const file = args._[1];
  let tags;
  if (file) {
    const text = fs.readFileSync(file, 'utf8');
    tags = JSON.parse(text);
  } else {
    tags = subcommand === 'article' ? {
      'App-Name': 'PermaBrain',
      'App-Version': '0.2.0',
      'PermaBrain-Type': 'article',
      'Article-Key': 'subject/demo',
      'Article-Kind': 'subject',
      'Article-Title': 'Demo',
      'Article-Slug': 'demo',
      'Article-Topic': 'test',
      'Article-Language': 'en',
      'Article-Version': 1,
      'Article-Source-Name': 'Example',
      'Article-Source-Url': 'https://example.com/demo',
      'Article-Content-Hash': 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
      'Article-Published-At': new Date().toISOString(),
      'Article-Updated-At': new Date().toISOString(),
      'Author-Agent-Id': 'ed25519:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'Visibility': 'public'
    } : {
      'App-Name': 'PermaBrain',
      'App-Version': '0.2.0',
      'PermaBrain-Type': 'attestation',
      'Attestation-Target-Id': 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'Attestation-Target-Key': 'subject/demo',
      'Attestation-Opinion': 'valid',
      'Attestation-Confidence': 0.95,
      'Attestation-Reason': 'Looks good',
      'Attestation-Agent-Id': 'ed25519:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'Attestation-Created-At': new Date().toISOString()
    };
  }

  let dataItem;
  if (Array.isArray(tags.tags)) {
    dataItem = tags;
  } else if (Array.isArray(tags)) {
    dataItem = { tags };
  } else {
    dataItem = { tags: Object.entries(tags).map(([name, value]) => ({ name, value })) };
  }

  const result = validateDataItemTags(dataItem, subcommand);

  if (args.json) printJson(result);
  else {
    console.log(result.valid ? 'OK' : formatValidationErrors(result));
  }
  return result;
}

async function thresholdAttestCommand(args) {
  const subcommand = args._[0];
  if (!subcommand || subcommand === '--help' || subcommand === 'help') {
    console.log(`Usage: permabrain threshold-attest <subcommand> [args]

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

Examples:
  permabrain threshold-attest create subject/ai --valid --confidence 0.95 \\
      --reason "Cross-checked" --threshold 2 --co-signers sage,relay --output env.json
  permabrain threshold-attest finalize env.json
`);
    return { subcommand };
  }

  if (subcommand === 'create') {
    const key = args._[1];
    if (!key) throw new Error('create requires <canonical-key>');
    const opinion = opinionFromArgs(args);
    const threshold = Number(args.threshold);
    if (!Number.isInteger(threshold) || threshold < 1) throw new Error('--threshold must be a positive integer');
    const coSigners = args['co-signers'] ? String(args['co-signers']).split(',').map(s => s.trim()).filter(Boolean) : [];
    if (!coSigners.length) throw new Error('--co-signers is required');
    if (threshold > coSigners.length) throw new Error(`--threshold ${threshold} exceeds co-signer count ${coSigners.length}`);
    if (!args.reason) throw new Error('--reason is required');
    if (args.confidence === undefined) throw new Error('--confidence is required');

    const envelope = await createThresholdEnvelope({
      key,
      opinion,
      confidence: args.confidence,
      reason: args.reason,
      sourceUrl: args['source-url'],
      targetId: args['target-id'],
      policy: { threshold, coSignerAgentIds: coSigners }
    });

    const output = args.output;
    if (output) {
      fs.writeFileSync(output, JSON.stringify(envelope, null, 2) + '\n');
    }
    if (args.json || !output) {
      printJson(envelope);
    } else {
      console.log(`Created threshold envelope: ${envelope.envelopeId}`);
      console.log(`  Key: ${envelope.targetKey}`);
      console.log(`  Opinion: ${envelope.opinion} (${envelope.confidence})`);
      console.log(`  Threshold: ${envelope.policy.threshold} of ${envelope.policy.coSignerAgentIds.length}`);
      console.log(`  Signatures: ${envelope.signers.length}`);
      console.log(`  Written to: ${output}`);
    }
    return envelope;
  }

  if (subcommand === 'add-sig') {
    const filePath = args._[1] || args.file;
    if (!filePath) throw new Error('add-sig requires <envelope-file>');
    if (!args['agent-id']) throw new Error('--agent-id is required');
    if (!args.signature) throw new Error('--signature is required');
    const envelope = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    importThresholdEnvelope(envelope);
    const signer = {
      agentId: args['agent-id'],
      signatureType: args['signature-type'] || 'ed25519',
      signature: args.signature,
      publicKey: args['public-key']
    };
    const updated = addCoSigner(envelope.envelopeId, signer);
    fs.writeFileSync(filePath, JSON.stringify(updated, null, 2) + '\n');
    if (args.json) printJson(updated);
    else {
      const verified = await verifyThresholdEnvelope(updated);
      console.log(`Added signature from ${signer.agentId}`);
      console.log(`  Valid signatures: ${verified.valid}/${verified.required}`);
      console.log(`  Threshold met: ${verified.ok ? 'yes' : 'no'}`);
    }
    return updated;
  }

  if (subcommand === 'finalize') {
    const filePath = args._[1] || args.file;
    if (!filePath) throw new Error('finalize requires <envelope-file>');
    const envelope = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    importThresholdEnvelope(envelope);
    const result = await finalizeThresholdAttestation(envelope.envelopeId, { useHyperbeam: args['use-hyperbeam'] ?? false });
    fs.rmSync(filePath, { force: true });
    if (args.json) printJson({ summary: result.summary, envelopeId: result.envelope.envelopeId, itemId: result.item.id });
    else {
      console.log(`Published threshold attestation: ${result.item.id}`);
      console.log(`  Key: ${result.summary.targetKey}`);
      console.log(`  Opinion: ${result.summary.opinion} (${result.summary.confidence})`);
      console.log(`  Signatures: ${result.envelope.signers.length}/${result.envelope.policy.threshold}`);
    }
    return result;
  }

  if (subcommand === 'verify') {
    const filePath = args._[1] || args.file;
    if (!filePath) throw new Error('verify requires <envelope-file>');
    const envelope = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const result = await verifyThresholdEnvelope(envelope);
    if (args.json) printJson(result);
    else {
      console.log(`Threshold verification: ${result.ok ? 'OK' : 'NOT MET'}`);
      console.log(`  Valid signatures: ${result.valid}/${result.required}`);
      if (result.invalid.length) console.log(`  Invalid signers: ${result.invalid.join(', ')}`);
    }
    return result;
  }

  if (subcommand === 'import') {
    const filePath = args._[1] || args.file;
    if (!filePath) throw new Error('import requires <envelope-file>');
    const envelope = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const stored = importThresholdEnvelope(envelope);
    if (args.json) printJson({ envelopeId: stored.envelopeId, imported: true });
    else console.log(`Imported threshold envelope: ${stored.envelopeId}`);
    return stored;
  }

  if (subcommand === 'export-envelope') {
    const envelopeId = args._[1] || args.envelopeId;
    if (!envelopeId) throw new Error('export-envelope requires <envelopeId>');
    const output = args.output;
    const exported = exportThresholdEnvelope(envelopeId);
    if (output) {
      fs.writeFileSync(output, JSON.stringify(exported, null, 2) + '\n');
    }
    if (args.json || !output) {
      printJson(exported);
    } else {
      console.log(`Exported threshold envelope: ${exported.envelopeId}`);
      console.log(`  Key: ${exported.targetKey}`);
      console.log(`  Threshold: ${exported.policy.threshold} of ${exported.policy.coSignerAgentIds.length}`);
      console.log(`  Signatures: ${exported.signers.length}`);
      console.log(`  Written to: ${output}`);
    }
    return exported;
  }

  if (subcommand === 'import-envelope') {
    const filePath = args._[1] || args.file;
    if (!filePath) throw new Error('import-envelope requires <envelope-file>');
    const envelope = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const stored = importThresholdEnvelope(envelope);
    if (args.json) printJson({ envelopeId: stored.envelopeId, imported: true });
    else console.log(`Imported threshold envelope: ${stored.envelopeId}`);
    return stored;
  }

  throw new Error(`Unknown threshold-attest subcommand: ${subcommand}`);
}

async function queryStreamCommand(args) {
  if (args.help || args._[0] === '--help' || args._[0] === 'help') {
    console.log(`Usage: permabrain query-stream [options]

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
`);
    return { ok: true, help: true };
  }
  const url = args.url || args.u || 'http://localhost:8765';
  const transport = args.ws ? 'ws' : 'sse';
  const format = args.json ? 'json' : 'compact';
  const maxMs = args.duration ? Number(args.duration) : undefined;
  const maxEvents = args.count ? Number(args.count) : undefined;

  const path = '/api/v1/articles/stream';
  const params = new URLSearchParams();
  if (args.topic) params.set('topic', args.topic);
  if (args.kind) params.set('kind', args.kind);
  if (args.agent) params.set('agent', args.agent);
  if (args.key) params.set('key', args.key);
  if (args.events) params.set('events', args.events);
  const query = params.toString();
  const fullPath = query ? `${path}?${query}` : path;

  const { subscribeEventsOverSse } = await import('./events-client.mjs');

  let count = 0;
  const startTime = Date.now();
  const controller = new AbortController();
  function stop() { controller.abort(); }
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  try {
    const sub = subscribeEventsOverSse({ baseUrl: url, url: fullPath, signal: controller.signal });
    for await (const event of sub) {
      if (event.type === 'error') {
        if (args.json) console.log(JSON.stringify(event));
        else console.error(`Error: ${event.message}`);
        continue;
      }
      if (args.json) console.log(JSON.stringify(event));
      else console.log(formatEvent(event, format));
      count++;
      if (count >= maxEvents || (maxMs && Date.now() - startTime >= maxMs)) {
        stop();
        break;
      }
    }
  } finally {
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
  }
  return { count };
}

async function eventsCommand(args) {
  if (args.help || args._[0] === '--help' || args._[0] === 'help') {
    console.log(`Usage: permabrain events [options]

Subscribe to real-time events from a running permabrain serve instance.

Options:
  --url <url>            Server base URL (default http://localhost:8765)
  --ws                   Use WebSocket instead of SSE
  --events <names>       Comma-separated event filter (e.g. publish,attest)
  --json                 Print each event as JSON
  --compact              Print compact one-line events (default)
  --duration <ms>        Stop after N milliseconds
  --count <n>            Stop after receiving N events

Examples:
  permabrain events
  permabrain events --url http://localhost:9000 --events publish,attest
  permabrain events --ws --json --duration 30000
`);
    return { ok: true, help: true };
  }
  const url = args.url || args.u;
  const transport = args.ws ? 'ws' : 'sse';
  const events = args.events || args.e;
  const format = args.json ? 'json' : 'compact';
  const maxMs = args.duration ? Number(args.duration) : undefined;
  const maxEvents = args.count ? Number(args.count) : undefined;
  return runEventsSubscriber({ baseUrl: url, transport, events, format, maxMs, maxEvents });
}

async function subscribeRemoteCommand(args) {
  if (args.help || args._[0] === '--help' || args._[0] === 'help' || !args._[0]) {
    console.log(`Usage: permabrain subscribe <remote-url> [options]

Publish local events to a remote PermaBrain peer. This is the mirror of
'permabrain events': it listens to the local event bus and forwards audit
events to the remote POST /api/v1/events/publish endpoint.

Arguments:
  <remote-url>           Remote permabrain serve base URL

Options:
  --events <names>       Comma-separated event filter (default: all events)
  --batch-ms <ms>        Forwarding debounce (default 50)
  --auth-header <value>  Optional Authorization header value
  --count <n>            Stop after forwarding N events
  --verbose              Print forward/error events

Examples:
  permabrain subscribe http://localhost:9000
  permabrain subscribe http://peer.example.com --events publish,attest --count 10
`);
    return { ok: true, help: true };
  }
  const baseUrl = args._[0] || args.url;
  const events = args.events || args.e;
  const batchMs = args['batch-ms'] ? Number(args['batch-ms']) : undefined;
  const authHeader = args['auth-header'];
  const maxEvents = args.count ? Number(args.count) : undefined;
  const verbose = args.verbose || args.v;
  const { runEventPublisher } = await import('./subscribe.mjs');
  const result = await runEventPublisher({ baseUrl, events, batchMs, authHeader, maxEvents, verbose });
  if (args.json) printJson(result);
  else console.log(`Forwarded ${result.forwarded} events (${result.errors} errors) to ${baseUrl}`);
  return result;
}

async function peerCommand(args) {
  const subcommand = args._[0] || 'info';

  if (args.help || args._[0] === '--help' || args._[0] === 'help') {
    console.log(`Usage: permabrain peer <subcommand> [options]

Gossip-style peer-to-peer article exchange over the HTTP API.

Subcommands:
  info                    Show local peer info (public articles)
  status --url <url>     Show pull/push status for a remote peer
  diff --url <url>       Show key diff against a remote peer
  pull --url <url>      Pull missing/newer articles from a remote peer
  push --url <url>      Push local articles missing on a remote peer
  bundle --url <url>     Pull raw bundle (without importing)

Options:
  --url, -u <url>       Remote peer base URL
  --home <path>          PERMABRAIN_HOME override
  --include-attestations true|false
  --include-versions true|false
  --verify false          Skip signature verification when importing (pull/push)
  --json                  Output JSON

Examples:
  permabrain peer info
  permabrain peer status --url http://localhost:9000
  permabrain peer pull --url http://localhost:9000
  permabrain peer push --url http://localhost:9000
  permabrain peer bundle --url http://localhost:9000 --output peer-bundle.json
`);
    return { ok: true, help: true };
  }

  const home = getHome();

  if (subcommand === 'info') {
    const info = peerInfo(home, { includeAttestations: args['include-attestations'] !== false });
    if (args.json) printJson(info);
    else console.log(peerInfoToMarkdown(info, { verbose: args.verbose }));
    return info;
  }

  if (subcommand === 'status') {
    const url = args.url || args.u;
    if (!url) throw new Error('status requires --url');
    const { createClient } = await import('./client.mjs');
    const client = createClient({ baseUrl: url });
    const info = await client.peerInfo();
    const status = peerStatus([info], { home });
    // Also report pushable keys for symmetry.
    const pushDiff = diffKeysForPush(loadIndex(home), info);
    const result = { ...status, pushable: pushDiff.pushed.length, newerPushable: pushDiff.newer.length, missingPushable: pushDiff.missing.length };
    if (args.json) printJson(result);
    else {
      console.log(peerStatusToMarkdown(status));
      console.log(`Pushable to peer: ${pushDiff.pushed.length} (${pushDiff.newer.length} newer, ${pushDiff.missing.length} missing)`);
    }
    return result;
  }

  if (subcommand === 'diff') {
    const url = args.url || args.u;
    if (!url) throw new Error('diff requires --url');
    const { createClient } = await import('./client.mjs');
    const client = createClient({ baseUrl: url });
    const info = await client.peerInfo();
    const localIndex = loadIndex(home);
    const pullDiff = diffPeerKeys(localIndex, info);
    const pushDiff = diffKeysForPush(localIndex, info);
    const result = { pull: pullDiff, push: pushDiff };
    if (args.json) printJson(result);
    else {
      console.log(`Diff against ${info.agentId || url}:`);
      console.log(`  Pullable: ${pullDiff.pulled.length} (${pullDiff.newer.length} newer, ${pullDiff.missing.length} missing)`);
      console.log(`  Pushable: ${pushDiff.pushed.length} (${pushDiff.newer.length} newer, ${pushDiff.missing.length} missing)`);
      console.log(`  Divergent: ${pullDiff.divergent.length}`);
      console.log(`  Unchanged: ${pullDiff.unchanged}`);
      if (args.verbose) {
        for (const p of pullDiff.pulled) console.log(`  <- ${p.key} ${p.reason} ${p.remoteId || ''}`);
        for (const p of pushDiff.pushed) console.log(`  -> ${p.key} ${p.reason} ${p.localId || ''}`);
        for (const d of pullDiff.divergent) console.log(`  ! ${d.key} divergent local=${d.localId} remote=${d.remoteId}`);
      }
    }
    return result;
  }

  if (subcommand === 'pull') {
    const url = args.url || args.u;
    if (!url) throw new Error('pull requires --url');
    const result = await pullFromPeer(url, {
      home,
      includeAttestations: args['include-attestations'] !== false,
      verify: args.verify !== false,
      skipDuplicates: args['skip-duplicates'] !== false
    });
    if (args.json) printJson(result);
    else {
      console.log(`Pulled from ${result.peer.agentId || url}:`);
      console.log(`  Pullable: ${result.diff.pulled.length}`);
      console.log(`  Imported: ${result.imported}`);
      console.log(`  Skipped: ${result.skipped}`);
      console.log(`  Failed: ${result.failed}`);
    }
    return result;
  }

  if (subcommand === 'push') {
    const url = args.url || args.u;
    if (!url) throw new Error('push requires --url');
    const { createClient } = await import('./client.mjs');
    const client = createClient({ baseUrl: url });
    const result = await pushToPeerClient(client, {
      home,
      includeAttestations: args['include-attestations'] !== false,
      includeVersions: args['include-versions'] !== false,
      verify: args.verify !== false,
      skipDuplicates: args['skip-duplicates'] !== false
    });
    if (args.json) printJson(result);
    else {
      console.log(`Pushed to ${result.peer.agentId || url}:`);
      console.log(`  Pushable: ${result.diff.pushed.length}`);
      console.log(`  Accepted: ${result.accepted}`);
      console.log(`  Rejected: ${result.rejected}`);
      console.log(`  Failed: ${result.failed}`);
    }
    return result;
  }

  if (subcommand === 'bundle') {
    const url = args.url || args.u;
    if (!url) throw new Error('bundle requires --url');
    const { createClient } = await import('./client.mjs');
    const client = createClient({ baseUrl: url });
    const result = await pullFromPeerAsBundle(client, {
      home,
      includeAttestations: args['include-attestations'] !== false
    });
    if (args.output) {
      fs.writeFileSync(args.output, JSON.stringify(result.bundle, null, 2) + '\n');
      console.log(`Wrote bundle to ${args.output}`);
    } else if (args.json) {
      printJson(result.bundle);
    } else {
      console.log(`Bundle from ${result.peer.agentId || url}:`);
      console.log(`  Pullable: ${result.diff.pulled.length}`);
      console.log(`  Articles: ${result.bundle.articles?.length || 0}`);
      console.log(`  Attestations: ${result.bundle.attestations?.length || 0}`);
    }
    return result;
  }

  throw new Error(`Unknown peer subcommand: ${subcommand}`);
}

async function serveCommand(args) {
  const port = args.port ? Number(args.port) : (args.p ? Number(args.p) : undefined);
  const streamTransport = args['stream-transport'] || args.streamTransport || undefined;
  const apiKey = args['api-key'] || process.env.PERMABRAIN_API_KEY || undefined;
  const corsOrigin = args['cors-origin'] || process.env.PERMABRAIN_CORS_ORIGIN || undefined;
  const rateLimit = args['rate-limit'] !== undefined ? args['rate-limit'] : (process.env.PERMABRAIN_RATE_LIMIT !== undefined ? process.env.PERMABRAIN_RATE_LIMIT : undefined);
  const rateWindow = args['rate-window'] || process.env.PERMABRAIN_RATE_WINDOW || undefined;
  const rateBurst = args['rate-burst'] || process.env.PERMABRAIN_RATE_BURST || undefined;
  const trustProxy = args['trust-proxy'] === true || args['trust-proxy'] === 'true' || process.env.PERMABRAIN_TRUST_PROXY === 'true' || undefined;
  const accessLog = args['access-log'] || process.env.PERMABRAIN_ACCESS_LOG || undefined;
  const requestLogMaxEntries = args['request-log-max-entries'] || process.env.PERMABRAIN_REQUEST_LOG_MAX_ENTRIES || undefined;
  const accessLogDir = args['access-log-dir'] || process.env.PERMABRAIN_ACCESS_LOG_DIR || undefined;
  const accessLogMaxSize = args['access-log-max-size'] || process.env.PERMABRAIN_ACCESS_LOG_MAX_SIZE || undefined;
  const accessLogMaxFiles = args['access-log-max-files'] || process.env.PERMABRAIN_ACCESS_LOG_MAX_FILES || undefined;
  const accessLogRetentionDays = args['access-log-retention-days'] || process.env.PERMABRAIN_ACCESS_LOG_RETENTION_DAYS || undefined;
  const home = getHome();
  const result = await startServer({ home, port, streamTransport, apiKey, corsOrigin, rateLimit, rateWindow, rateBurst, trustProxy, accessLog, requestLogMaxEntries, accessLogDir, accessLogMaxSize, accessLogMaxFiles, accessLogRetentionDays });
  console.log(`PermaBrain HTTP API serving at http://localhost:${result.port}`);
  console.log(`Home: ${result.home}`);
  console.log(`Agent: ${result.agentId || 'unknown'}`);
  if (result.streamTransport) {
    console.log(`Default live stream transport: ${result.streamTransport.toUpperCase()}`);
  }
  if (corsOrigin && corsOrigin !== '*') {
    console.log(`CORS restricted to origin: ${corsOrigin}`);
  } else {
    console.log('CORS: open to all origins (*)');
  }
  if (rateLimit !== undefined) {
    if (rateLimit === 0 || rateLimit === '0') {
      console.log('Rate limiting: disabled');
    } else {
      console.log(`Rate limiting: ${rateLimit} req/${(rateWindow || 60000) / 1000}s window, burst ${rateBurst || 10}`);
    }
  } else {
    console.log('Rate limiting: disabled by default');
  }
  if (accessLog) {
    console.log(`Access log: ${accessLog}`);
  } else {
    console.log('Access log: none (request history kept in memory only)');
  }
  console.log(`Metrics: GET /api/v1/metrics (add ?format=prometheus for Prometheus exposition)`);


  const shutdown = async (signal) => {
    console.log(`\n${signal} received, stopping server...`);
    await stopServer(result.server);
    process.exit(0);
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));

  return new Promise(() => {}); // keep running until signal
}

async function shellCommand(args) {
  const { api } = await import('./agent-api.mjs');
  if (args.help) {
    console.log(`Usage: permabrain shell [options]

Start an interactive REPL with the agent API exposed as \`api\` (alias \`pb\`).
History is persisted to the PermaBrain home directory and tab completion
lists available \`api\` methods.

Options:
  --history-path <file>   Custom history file (default: <PERMABRAIN_HOME>/repl-history.jsonl)
  --prompt <string>       Custom REPL prompt
  --json                  Print the identity object before starting (noop for interactive mode)

Examples:
  permabrain shell
  permabrain shell --prompt "pb> "

In the shell:
  await api.query({ topic: 'ai' })
  pb.status()
  pb.metrics({ top: 10 })
  .exit
`);
    return { ok: true, help: true };
  }
  const home = getHome();
  await api.ensureInit();
  if (args.json) printJson(api.identity);
  else {
    console.log(`PermaBrain shell (${api.identity?.agentId || 'unknown'})`);
    console.log(`Home: ${home}`);
  }
  await api.repl({
    home,
    historyPath: args['history-path'],
    prompt: args.prompt
  });
  return { ok: true };
}
