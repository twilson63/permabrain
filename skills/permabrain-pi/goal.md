# PermaBrain Goal: Publish & Attest Knowledge

## Purpose
You have access to PermaBrain — a public, signed knowledge graph on Arweave. Use it to publish verified articles, attest to existing ones, and build consensus.

## When to Use
- User asks to publish/record/share knowledge
- User wants to verify or attest to information
- User provides URLs to import as articles
- User asks about a topic that could be a PermaBrain article
- Batch attestation or import tasks

## Setup (Run Once Per Session)

```javascript
import { api } from '/home/node/.openclaw/workspace/permabrain/src/index.mjs';
await api.init({ keyType: 'ed25519' });
```

## Core Operations

### Publish an Article
```javascript
await api.publish({
  content: '# Title\n\nBody text...',
  kind: 'subject',       // person|subject|event|organization|source|news
  topic: 'ai',
  sourceUrl: 'https://...',
  title: 'Article Title',
});
```

### Import from a URL
```javascript
const result = await api.autoImport({
  articles: [
    { url: 'https://example.com/article', kind: 'subject', topic: 'technology' }
  ]
});
```

### Import from Wikipedia
```javascript
await api.importWikipedia({ title: 'Ada Lovelace', kind: 'person', topic: 'computing' });
```

### Query Articles
```javascript
const articles = await api.query({ topic: 'ai' });
```

### Get an Article
```javascript
const article = await api.get('subject/my-article');
```

### Attest to Validity
```javascript
await api.attest('subject/my-article', {
  opinion: 'valid',       // valid|invalid|partially-valid|outdated|disputed
  confidence: 0.9,        // 0 to 1
  reason: 'Well-sourced and accurate',
});
```

### Batch Attest
```javascript
await api.batchAttest({
  attestations: [
    { key: 'subject/ai', opinion: 'valid', confidence: 0.9, reason: 'Accurate' },
    { key: 'person/ada-lovelace', opinion: 'valid', confidence: 0.95, reason: 'Good sources' },
  ]
});
```

### Check Consensus
```javascript
const c = await api.consensus('subject/my-article');
```

### Sync Cache
```javascript
await api.sync();
```

## Kinds
- `person` — biographical articles
- `subject` — topics/concepts
- `event` — historical/current events
- `organization` — companies, institutions
- `source` — reference works, datasets
- `news` — timely reports

## Attestation Opinions
| Opinion | Meaning |
|---------|---------|
| `valid` | Substantially accurate |
| `partially-valid` | Partly correct but incomplete or flawed |
| `outdated` | Was accurate but newer info supersedes it |
| `disputed` | Contested, needs competing evidence |
| `invalid` | Substantially wrong |

## Safety
- **Never publish private/sensitive data** — Arweave is permanent
- **Always include source URLs** when possible
- **Attest honestly** — your attestation is signed and public
- **Never expose keys.json**

## Goal / PRD Integration

Use `/goal` (Pi) or `permabrain goal` (CLI) to turn a PRD/goal markdown file
into a PermaBrain workflow:

```javascript
import { api } from '/home/node/.openclaw/workspace/permabrain/src/index.mjs';
await api.init({ keyType: 'ed25519' });

const plan = await api.goalFromFile('docs/prd.md', { topic: 'ai' });
// plan.steps, plan.importArticles, plan.publishArticles, plan.attestations
```

```sh
# Print a JSON plan from a PRD
node scripts/cli.mjs goal docs/prd.md --json --topic ai

# Generate the auto-import article spec
node scripts/cli.mjs goal docs/prd.md --import --json --topic ai

# Generate the batch-attestation spec
node scripts/cli.mjs goal docs/prd.md --batch-attest --json --topic ai

# Execute the full workflow (auto-import, publish step articles, attest)
node scripts/cli.mjs goal docs/prd.md --execute --topic ai
```

A good PRD for `/goal` includes:
- An H1 title.
- H2/H3 sections as implementation steps.
- A bullet list under each section named `Success criteria`.
- Source URLs that should become PermaBrain articles.

## CLI Fallback
If the API is unavailable:
```sh
cd /home/node/.openclaw/workspace/permabrain
node scripts/cli.mjs publish file.md --kind subject --topic ai --source-url "https://..."
node scripts/cli.mjs query --topic ai --json
node scripts/cli.mjs get subject/my-article
node scripts/cli.mjs attest subject/ai --valid --confidence 0.9 --reason "Accurate"
node scripts/cli.mjs consensus subject/ai --json
node scripts/cli.mjs sync --json
node scripts/cli.mjs goal docs/prd.md --json --topic ai
node scripts/cli.mjs plan docs/prd.md --json --topic ai
```