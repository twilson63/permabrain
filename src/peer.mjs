/**
 * PermaBrain Peer Sync
 *
 * Gossip-style peer-to-peer article exchange over the existing HTTP API.
 *
 * Protocol:
 *   1. Peer A asks Peer B for its public node info (GET /api/v1/peer/info).
 *      Response includes agentId, transport, a map of { key -> version,id }
 *      for locally-known articles, and optionally attestations.
 *   2. Peer A diffs its own local key set with Peer B's key set. For keys
 *      where Peer B has a newer version, Peer A requests a pull
 *      (POST /api/v1/peer/pull) carrying the list of { key, sinceVersion }
 *      requests.
 *   3. Peer B responds with a bundle containing raw ANS-104 DataItems for
 *      the requested articles (and optionally their attestations). Peer A
 *      imports the bundle, optionally verifying DataItem signatures.
 *
 * Security notes:
 *   - The protocol is intentionally simple and runs over the existing serve
 *     HTTP endpoint. No authentication is assumed; every pull is a unilateral
 *     gossip pull of public articles.
 *   - Encrypted/private articles are skipped from peer info and pull unless
 *     explicit access tokens are provided in the future.
 */

import { getHome, loadConfig, initState } from './config.mjs';
import { loadIdentity, ensureIdentity } from './keys.mjs';
import { getTransport } from './transport.mjs';
import { latestByArticleKey, loadIndex, summarizeArticle, summarizeAttestation } from './cache.mjs';
import { tagsToObject } from './tags.mjs';
import { exportBundle, importBundle, buildBundle } from './bundle.mjs';
import { createClient } from './client.mjs';

export function peerInfo(home, opts = {}) {
  const h = home || getHome();
  const config = loadConfig(h);
  const identity = loadIdentity(h);
  const index = loadIndex(h);
  const includeAttestations = opts.includeAttestations !== false;

  const articles = {};
  for (const [key, article] of Object.entries(index.articles || {})) {
    if (article.visibility === 'private' || article.visibility === 'encrypted') continue;
    articles[key] = {
      key,
      version: article.version,
      id: article.id,
      updatedAt: article.updatedAt,
      authorAgentId: article.authorAgentId
    };
  }

  const attestations = includeAttestations ? {} : undefined;
  if (includeAttestations) {
    for (const [key, list] of Object.entries(index.attestations || {})) {
      attestations[key] = list
        .filter((a) => !a.encrypted)
        .map((a) => ({
          id: a.id,
          targetKey: a.targetKey,
          opinion: a.opinion,
          confidence: a.confidence,
          agentId: a.agentId,
          createdAt: a.createdAt
        }));
    }
  }

  return {
    agentId: identity.agentId,
    transport: config.transport,
    home: h,
    version: config.version,
    peerProtocol: 'permabrain-peer/1.0',
    articles,
    attestationCount: Object.values(attestations || {}).reduce((n, xs) => n + xs.length, 0),
    attestations
  };
}

export function diffPeerKeys(localIndex, peerInfo) {
  const remoteArticles = peerInfo?.articles || {};
  const localArticles = localIndex?.articles || {};
  const pulled = [];
  const newer = [];
  const missing = [];
  const divergent = [];

  for (const [key, remote] of Object.entries(remoteArticles)) {
    const local = localArticles[key];
    if (!local) {
      missing.push({ key, remoteVersion: remote.version, remoteId: remote.id, reason: 'missing' });
    } else if (remote.id !== local.id) {
      if (remote.version > local.version) {
        newer.push({ key, localVersion: local.version, remoteVersion: remote.version, remoteId: remote.id, reason: 'newer' });
      } else if (remote.version === local.version) {
        divergent.push({ key, localVersion: local.version, localId: local.id, remoteId: remote.id, remoteVersion: remote.version, reason: 'divergent-same-version' });
      } else {
        // remote is older; nothing to pull
      }
    }
  }

  pulled.push(...newer, ...missing);

  return {
    pulled,
    newer,
    missing,
    divergent,
    unchanged: Object.keys(localArticles).filter((key) => {
      const remote = remoteArticles[key];
      return remote && remote.id === localArticles[key].id;
    }).length
  };
}

export async function buildPeerPullBundle(requests, home, opts = {}) {
  const h = home || getHome();
  const includeAttestations = opts.includeAttestations !== false;
  const includeVersions = opts.includeVersions !== false;

  const articles = [];
  const attestations = [];

  for (const req of requests) {
    if (!req.key && !req.id) continue;
    try {
      const bundle = await exportBundle({
        key: req.key,
        id: req.id,
        includeAttestations,
        includeVersions,
        home: h
      });
      for (const e of bundle.entries || []) {
        if (e.type === 'article') articles.push(Buffer.from(e.data, 'base64'));
        else if (e.type === 'attestation') attestations.push(Buffer.from(e.data, 'base64'));
      }
    } catch (err) {
      // Skip unavailable/invalid keys but preserve request order intent.
      // No per-key error surface for the peer protocol v1.
    }
  }

  return buildBundle({ articles, attestations, meta: { pulled: requests.length } });
}

export async function pullFromPeer(peerBaseUrl, opts = {}) {
  const home = opts.home || getHome();
  const client = createClient({ baseUrl: peerBaseUrl });
  return pullFromPeerClient(client, { ...opts, home });
}

export async function pullFromPeerAsBundle(peerBaseUrl, opts = {}) {
  const home = opts.home || getHome();
  const client = createClient({ baseUrl: peerBaseUrl });
  return pullFromPeerClientAsBundle(client, { ...opts, home });
}

export async function pullFromPeerClient(client, opts = {}) {
  const home = opts.home || getHome();
  const verify = opts.verify !== false;
  const skipDuplicates = opts.skipDuplicates !== false;

  // Ensure target home has state directories and index so importBundle
  // can load config and write objects.
  initState({ env: { ...process.env, PERMABRAIN_HOME: home } });
  ensureIdentity(home, { keyType: process.env.PERMABRAIN_KEY_TYPE || 'ed25519' });

  const info = await client.peerInfo();
  const localIndex = loadIndex(home);
  const diff = diffPeerKeys(localIndex, info);

  if (!diff.pulled.length) {
    return {
      peer: info,
      pulled: [],
      imported: 0,
      skipped: 0,
      failed: 0,
      diff
    };
  }

  const pullRequests = diff.pulled.map((p) => ({ key: p.key, sinceVersion: p.localVersion || 0 }));
  const { requests: _, ...remoteBundle } = await client.peerPull(pullRequests, { includeAttestations: opts.includeAttestations });

  const results = await importBundle(remoteBundle, { home, verify, skipDuplicates });
  const imported = results.filter((r) => r.imported && r.ok).length;
  const skipped = results.filter((r) => !r.imported && r.ok).length;
  const failed = results.filter((r) => !r.ok).length;

  return {
    peer: info,
    pulled: diff.pulled,
    imported,
    skipped,
    failed,
    results,
    diff
  };
}

export async function pullFromPeerClientAsBundle(client, opts = {}) {
  const home = opts.home || getHome();

  // Ensure target home has state directories and index.
  initState({ env: { ...process.env, PERMABRAIN_HOME: home } });

  const info = await client.peerInfo();
  const localIndex = loadIndex(home);
  const diff = diffPeerKeys(localIndex, info);

  if (!diff.pulled.length) {
    return { peer: info, bundle: buildBundle({ articles: [], attestations: [], meta: { pulled: 0 } }), diff };
  }

  const pullRequests = diff.pulled.map((p) => ({ key: p.key, sinceVersion: p.localVersion || 0 }));
  const bundle = await client.peerPull(pullRequests, { includeAttestations: opts.includeAttestations });

  return { peer: info, bundle, diff };
}

export function peerStatus(peers, opts = {}) {
  const results = (peers || []).map((peer) => {
    const localIndex = loadIndex(opts.home || getHome());
    const diff = diffPeerKeys(localIndex, peer);
    return {
      agentId: peer.agentId,
      transport: peer.transport,
      pullable: diff.pulled.length,
      newer: diff.newer.length,
      missing: diff.missing.length,
      divergent: diff.divergent.length
    };
  });

  return {
    peers: results,
    totalPullable: results.reduce((n, r) => n + r.pullable, 0),
    uniquePeers: results.length
  };
}

export function peerInfoToMarkdown(info, opts = {}) {
  const lines = [];
  lines.push(`# Peer: ${info.agentId || 'unknown'}`);
  lines.push(`Transport: ${info.transport}`);
  lines.push(`Protocol: ${info.peerProtocol || 'n/a'}`);
  lines.push(`Articles: ${Object.keys(info.articles || {}).length}`);
  lines.push(`Attestations: ${info.attestationCount || 0}`);
  if (opts.verbose) {
    lines.push('');
    lines.push('Keys:');
    for (const [key, a] of Object.entries(info.articles || {})) {
      lines.push(`  ${key} v${a.version} ${a.id}`);
    }
  }
  return lines.join('\n') + '\n';
}

export function peerStatusToMarkdown(status) {
  const lines = [];
  lines.push(`# Peer Status`);
  lines.push(`Unique peers: ${status.uniquePeers}`);
  lines.push(`Total pullable: ${status.totalPullable}`);
  for (const p of status.peers || []) {
    lines.push(`  ${p.agentId}: ${p.pullable} pullable (${p.newer} newer, ${p.missing} missing, ${p.divergent} divergent)`);
  }
  return lines.join('\n') + '\n';
}
