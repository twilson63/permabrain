import { initState, loadConfig, getHome } from './config.mjs';
import { ensureIdentity, publicIdentity } from './keys.mjs';
import { HyperbeamTransport } from './transport.mjs';
import { getArticle, publishArticle, queryArticles, syncArticlesAndAttestations } from './article.mjs';
import { importWikipediaArticle } from './wikipedia.mjs';
import { attestArticle, opinionFromArgs } from './attestation.mjs';
import { consensusForArticle } from './consensus.mjs';

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
