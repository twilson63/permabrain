---
name: permabrain
description: Publish, query, attest, and batch-work with PermaBrain knowledge articles on Arweave.
triggers:
  - publish.*article
  - import.*url.*permabrain
  - attest.*article
  - batch.*attest
  - permabrain
  - knowledge graph
  - third brain
---

Use the PermaBrain Pi Skill for all PermaBrain operations. See `/home/node/.openclaw/workspace/permabrain/skills/permabrain-pi/SKILL.md` for full API reference.

## Quick Setup
```javascript
import { api } from '/home/node/.openclaw/workspace/permabrain/src/index.mjs';
await api.init({ keyType: 'ed25519' });
```

## Key Operations
- `api.publish({ content, kind, topic, sourceUrl, title })` — publish article
- `api.query({ topic })` — query articles
- `api.get(key)` — get article content
- `api.attest(key, { opinion, confidence, reason })` — attest validity
- `api.batchAttest({ attestations: [...] })` — batch attest
- `api.autoImport({ articles: [{ url, kind, topic }] })` — import from URLs
- `api.consensus(key)` — check consensus
- `api.sync()` — refresh local cache
- `api.importWikipedia({ title, kind, topic })` — import from Wikipedia
- `api.parseGoal(text)` / `api.goalFromFile(path)` — parse a PRD into a PermaBrain plan

## CLI Fallback
```sh
cd /home/node/.openclaw/workspace/permabrain
node scripts/cli.mjs <command> [options]
node scripts/cli.mjs goal docs/prd.md --json --topic ai
node scripts/cli.mjs plan docs/prd.md --json --topic ai
```

## Safety
- Never publish private/sensitive data (Arweave is permanent)
- Always include source URLs
- Attest honestly — your attestation is signed and public