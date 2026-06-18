# PermaBrain Pi Skill

Use this skill when the user wants to publish, query, attest, import, or batch-work with PermaBrain knowledge articles — especially via the agent API or batch/auto-import commands.

PermaBrain is a public, signed knowledge graph on Arweave. Articles are immutable DataItems; attestations are separate signed records. This skill provides **direct agent API access** — no CLI shelling required.

## Setup

```javascript
import { api } from '/home/node/.openclaw/workspace/permabrain/src/index.mjs';
await api.init({ keyType: 'ed25519' });
```

Call `api.init()` once per session. Subsequent calls are no-ops if already initialized. `api.ensureInit()` is also available — it loads existing state without creating new keys.

## Quick Reference

### Publish
```javascript
const result = await api.publish({
  content: '# Article Title\n\nBody...',
  kind: 'subject',       // person|subject|event|organization|source|news
  topic: 'ai',
  sourceUrl: 'https://example.com/source',
  title: 'Article Title', // optional, derived if omitted
  key: 'subject/article-title', // optional, derived from kind+title
});
// → { id, key, kind, title, version, contentHash }
```

### Query
```javascript
const articles = await api.query({ topic: 'ai' });
const byKind = await api.query({ kind: 'person' });
const byKey = await api.query({ key: 'subject/my-article' });
```

### Get
```javascript
const article = await api.get('subject/my-article');
// → { key, title, content, contentHash, version, sourceName, sourceUrl }
```

### Attest
```javascript
await api.attest('subject/my-article', {
  opinion: 'valid',       // valid|invalid|partially-valid|outdated|disputed
  confidence: 0.95,       // 0 to 1
  reason: 'Well-sourced and accurate',
});
```

### Consensus
```javascript
const consensus = await api.consensus('subject/my-article');
// → { key, status, score, totalAttestations, opinionCounts, topReasons }
```

### Sync
```javascript
const result = await api.sync();
// → { articleCount, attestationCount, updatedAt }
```

### Local Index (no network)
```javascript
const index = await api.localIndex();
```

## HTTP Client SDK

When talking to a running `permabrain serve` instance, use the typed HTTP client instead of shelling out to the CLI.

```javascript
import { createClient } from '/home/node/.openclaw/workspace/permabrain/src/index.mjs';

const client = createClient({
  baseUrl: 'http://localhost:8765',
  apiKey: process.env.PERMABRAIN_API_KEY // optional, required if server uses --api-key
});

await client.health();
const article = await client.get('subject/my-article');
const consensus = await client.consensus('subject/my-article');

// Bundle / history import/export
const bundle = await client.exportBundle({ key: 'subject/my-article' });
const all = await client.exportAll();
const history = await client.exportHistory('subject/my-article');
await client.importBundle(bundle);              // accepts { bundle, verify?, skipDuplicates? }
await client.importHistory(history);            // accepts { bundle, verify?, skipDuplicates? }

// Generate a shell completion script
const { script } = await client.completion({ shell: 'bash' });

// Discover routes and OpenAPI spec
const { routes } = await client.routes();
const spec = await client.openapi();
```

Authentication methods supported by the server:

- `Authorization: Bearer <api-key>`
- `X-Api-Key: <api-key>`
- `?api-key=<api-key>`
- JSON body `apiKey` field

Public endpoints that never require a key: `/health`, `/api/v1/events/stream`, `/api/v1/events/ws`, `/api/v1/articles/stream`.

## Batch Operations

### Batch Attest — attest to multiple articles in one call

Each attestation is independent; failures don't block others.

```javascript
const batch = await api.batchAttest({
  attestations: [
    { key: 'subject/ai', opinion: 'valid', confidence: 0.9, reason: 'Accurate overview' },
    { key: 'person/ada-lovelace', opinion: 'valid', confidence: 0.95, reason: 'Well-sourced biography' },
    { key: 'subject/quantum-computing', opinion: 'partially-valid', confidence: 0.7, reason: 'Needs update on 2026 advances' },
  ],
});
// → { results: [{key, status, summary?}], succeeded: 2, failed: 1 }
```

### Auto Import — fetch URLs and publish as articles

Fetches each URL, strips HTML to text, and publishes to PermaBrain. Title is derived from content or URL if not provided.

```javascript
const imported = await api.autoImport({
  articles: [
    { url: 'https://en.wikipedia.org/wiki/Artificial_intelligence', kind: 'subject', topic: 'ai' },
    { url: 'https://example.com/quantum-basics', kind: 'subject', topic: 'physics', title: 'Quantum Basics' },
  ],
});
// → { results: [{key, status, summary?}], succeeded: 1, failed: 1 }
```

### Import from Wikipedia

```javascript
const wiki = await api.importWikipedia({
  title: 'Ada Lovelace',
  kind: 'person',
  topic: 'computing',
});
```

## Multi-Agent Attestation

### Attest on behalf of another agent (with their signing key)

```javascript
const result = await api.attestForAgent({
  agentIdentity: { type: 'ed25519', agentId: '...', publicKey: '...', secretKey: '...' },
  key: 'subject/ai',
  opinion: 'valid',
  confidence: 0.9,
  reason: 'Verified against primary sources',
});
```

### List known agents

```javascript
const agents = api.listKnownAgents();
// → [{ id, name, keyId, publicKeyFingerprint }]
```

## Private Articles (Encryption)

PermaBrain supports encrypted articles readable only by listed X25519 recipients. The author is always included as a recipient so they can read their own articles later.

```javascript
const keypair = api.generateEncryptionKeypair();
const { envelope, encryptedPayload } = await api.encrypt('Secret content', [keypair.publicKey]);

// Decrypt with seed
const seed = Buffer.from(keypair.seed, 'base64url');
const { content } = await api.decrypt(encryptedPayload, seed);
```

### Publish an encrypted article

```javascript
const result = await api.publish({
  content: '# Confidential\n\nPrivate notes.',
  kind: 'subject',
  topic: 'internal',
  sourceUrl: 'https://example.com/private',
  encryptedFor: [keypair.publicKey]
});
// → { summary, reference, encrypted: true, encryptionEnvelope }
```

### Read an encrypted article

```javascript
// Auto-derive the author's X25519 seed from the current ed25519 identity
const article = await api.getAndDecrypt('subject/confidential');

// Or decrypt with an explicit recipient seed
const article = await api.getAndDecrypt('subject/confidential', {
  decryptSeed: Buffer.from(keypair.seed, 'base64url')
});
```

## CLI Commands (Fallback)

If the API is unavailable, use the CLI:

```sh
cd /home/node/.openclaw/workspace/permabrain
PERMABRAIN_KEY_TYPE=ed25519 node scripts/cli.mjs init
node scripts/cli.mjs publish article.md --kind subject --topic ai --source-url "https://..."
node scripts/cli.mjs query --topic ai --json
node scripts/cli.mjs get subject/my-article
node scripts/cli.mjs attest subject/my-article --valid --confidence 0.95 --reason "Accurate"
node scripts/cli.mjs consensus subject/my-article --json
node scripts/cli.mjs sync --json
```

Encrypted article commands:

```sh
# Publish an encrypted article for one or more recipients
node scripts/cli.mjs publish-encrypted article.md \
  --kind subject \
  --topic internal \
  --source-url "https://example.com/private" \
  --for "<recipient-x25519-public-key>"

# Read it back (author seed auto-derived for ed25519 identities)
node scripts/cli.mjs get-encrypted subject/confidential

# Read with an explicit seed file
node scripts/cli.mjs get-encrypted subject/confidential --seed-file seed.txt
```

New batch/auto-import commands:

```sh
# Batch attest (one key per line in the attestation spec file)
node scripts/cli.mjs batch-attest --file attestations.json --json

# Auto-import from URLs
node scripts/cli.mjs auto-import --file urls.json --json
```

## Fork / Merge / Sync / Diff / Status Workflows

When a PRD changes direction, fork the original article instead of overwriting it, then merge back when ready.

```javascript
// Fork current article to explore a new angle
const fork = await api.fork('subject/ai-roadmap', {
  slug: 'agents-first',
  title: 'AI Roadmap (Agents-First Fork)',
  content: '# AI Roadmap\n\nAgents first, models second...',
  topic: 'ai',
  kind: 'subject'
});

// Diff before merging
const d = await api.diff('subject/ai-roadmap', fork.forkKey);
console.log(d.text);
console.log(d.conflictPreview);

// Merge the fork back into the main key
const merge = await api.merge('subject/ai-roadmap', fork.forkKey);
if (merge.hasConflicts) {
  // Resolve conflict markers in merge.mergedContent before considering clean
}
```

Before publishing new work, sync so you are building on the latest remote versions:

```javascript
const preview = await api.sync({ dryRun: true });
if (preview.divergences.length > 0) console.log('Divergences:', preview.divergences);
await api.sync(); // auto-merge where possible
```

Inspect working state at any time:

```javascript
const s = await api.status();
console.log(s.summary);
console.log(s.divergences);
console.log(s.forkHeads);
console.log(s.mergeStatus);
```

CLI equivalents:

```sh
permabrain fork subject/ai-roadmap --slug agents-first --title "AI Roadmap (Agents-First Fork)" --topic ai --kind subject
permabrain diff subject/ai-roadmap subject/ai-roadmap-agents-first
permabrain merge subject/ai-roadmap subject/ai-roadmap-agents-first
permabrain sync --dry-run
permabrain status --json
```

Encrypted/private divergences and divergences with no common ancestor are reported but not auto-merged. Merge conflicts are embedded as `<<<<<<< target ... ======= ... >>>>>>> source` markers in the merged content.

### Goal / PRD Integration

Parse a PRD or goal markdown file into a PermaBrain execution plan.

```javascript
const parsed = await api.parseGoal(text);
const plan = await api.planFromGoal(parsed);
// or in one call:
const plan = await api.goalFromFile('docs/prd.md', { topic: 'ai' });
```

`plan` contains:
- `steps` — ordered implementation steps with success criteria
- `importArticles` — URLs found in the PRD, ready for `api.autoImport`
- `publishArticles` — step articles that can be published as PermaBrain subjects
- `attestations` — ready-to-run batch attestation spec

CLI:
```sh
node scripts/cli.mjs goal docs/prd.md --json --topic ai
node scripts/cli.mjs plan docs/prd.md --json --topic ai
node scripts/cli.mjs goal docs/prd.md --import --json --topic ai
node scripts/cli.mjs goal docs/prd.md --batch-attest --json --topic ai
# Execute the full workflow:
node scripts/cli.mjs goal docs/prd.md --execute --topic ai
```

### Pi / Build Agent Workflow Checklist

1. **Plan** — parse the PRD into articles, imports, and attestations.
2. **Sync** — `api.sync()` to get the latest remote state.
3. **Fork if uncertain** — when changing an existing article significantly, fork it first.
4. **Publish / import** — run `autoImport()` and `publish()` for plan items.
5. **Diff** — compare fork/source or local/remote before merging.
6. **Merge** — integrate forks back to canonical keys when ready.
7. **Attest** — `batchAttest()` to the final published keys.
8. **Status** — run `api.status()` and report summary/conflicts/divergences.

## Safety

- PermaBrain publishing is **public and permanent** — never publish private/sensitive data
- Never expose private keys (`keys.json`)
- Always include source URLs when possible
- Attest honestly — your attestation is signed and permanent
- Forks always get a new canonical key; the source article is never mutated
- Merge conflicts must be resolved before a merged version is considered clean
