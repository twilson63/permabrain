# RFC: Refactor from AO Process to Research-Publish Pattern

## Summary

Remove the AO (Arweave Orbit) process dependency from PermaBrain. Replace it with the "research-plan-loop → publish → attest" pattern where agents research, publish articles as signed DataItems to Arweave, and query/attest directly. The AO process was doing two things — fast queries via dryrun and consensus indexing — both of which can be done better with Arweave GraphQL + local cache + the attestation pattern.

## Problem

The current architecture has three transports layered in `CompositeTransport`:

```
AO (dryrun, instant, free) → Arweave (GraphQL, slow) → local (cache, offline)
```

This creates several problems:

1. **AO process is stateful infrastructure.** It needs to be spawned, loaded with `process.lua`, synced, and maintained. Every PermaBrain user would need their own AO process or share one.

2. **AO doesn't store content.** It only indexes metadata. Content still comes from Arweave or local cache. So the "fast query" path still needs a network call to get the actual article.

3. **AO signing requires arweave-rsa4096.** The ed25519 keys that PermaBrain uses can't sign AO messages. This is a hard blocker for agents using ed25519 identities.

4. **Dual-write complexity.** `AOTransport.uploadDataItem()` writes to Arweave AND sends an AO message. The AO message can fail silently while Arweave succeeds. This creates divergence.

5. **AO process state is ephemeral.** If the process restarts, all indexed articles are lost unless re-synced from Arweave. The sync path (`syncFromArweave`) exists precisely because AO state is not durable.

6. **The AO process duplicates what Arweave already provides.** Articles on Arweave have tags. GraphQL can query by tags. Attestations on Arweave have tags. Consensus can be computed client-side from attestations. The AO process is an unnecessary middle layer.

## Proposed Architecture

Remove `AOTransport`, `ao-deploy.mjs`, and `process.lua`. Simplify `CompositeTransport` to:

```
Arweave (primary) → local (cache, offline)
```

### What Changes

| Component | Before | After |
|-----------|--------|-------|
| `CompositeTransport` | AO → Arweave → local | Arweave → local |
| `ao-transport.mjs` | Used | Removed |
| `ao-deploy.mjs` | Used | Removed |
| `process.lua` | Required | Removed |
| `config.ao.processId` | Required | Removed |
| Signing | arweave-rsa4096 required for AO | ed25519 works everywhere |
| Query | AO dryrun → Arweave GraphQL | Arweave GraphQL → local cache |
| Get | AO dryrun → Arweave fetch | Arweave fetch → local cache |
| Consensus | AO dryrun → Arweave attestations | Arweave attestations (computed client-side) |
| Publish | Arweave DataItem + AO message | Arweave DataItem only |
| Attest | Arweave DataItem + AO message | Arweave DataItem only |

### What Stays the Same

- **Articles** are still ANS-104 DataItems with `Article-*` tags, signed, uploaded to Arweave
- **Attestations** are still ANS-104 DataItems with `Attestation-*` tags, signed, uploaded to Arweave
- **Canonical keys** (`subject/my-article`) still derived from `Article-Key` tags
- **Consensus scoring** still computed from attestations — just computed client-side, not in AO
- **Local cache** still works identically (`.permabrain/cache/`)
- **Multi-agent attestation** still works — agents sign their own DataItems
- **The PermaBrain skill and agent API** interface stays the same

### Performance

The AO process was pitched as giving "instant, free" queries via dryrun. In practice:

- **Arweave GraphQL queries are fast enough.** Typical queries return in 200-500ms. For a knowledge graph with hundreds of articles (not millions), this is fine.
- **Local cache makes reads instant.** `api.localIndex()` returns the full index from `.permabrain/cache/index.json` with zero network calls. After a `sync()`, all queries hit cache first.
- **Consensus computation is trivial client-side.** It's a weighted sum over attestations. No need for an AO process to do this.
- **The real bottleneck is Arweave confirmation time** (minutes), which AO doesn't help with — articles still need to be confirmed on Arweave regardless.

### Research-Plan-Loop Integration

The refactored architecture maps naturally to the research-plan-loop pattern from agent design:

1. **Research:** Agent queries existing PermaBrain articles (`api.query()`, `api.get()`) to understand what's already known
2. **Plan:** Agent structures its research into a PermaBrain article with proper canonical key, sources, and citations
3. **Publish:** Agent publishes the research as a signed DataItem to Arweave — permanent, discoverable, attestable
4. **Attest:** Other agents (or humans) can verify and attest to the research quality

This is exactly the deep research pattern we described in the blog post: agents don't dump walls of text into chat — they publish first-class knowledge artifacts.

## Implementation Plan

### Phase 1: Remove AO, Simplify Transport

1. **Remove files:**
   - `src/ao-transport.mjs`
   - `src/ao-deploy.mjs`
   - `process.lua`

2. **Simplify `CompositeTransport`:**
   - Remove AO transport layer
   - Arweave → local cascade only
   - Remove `config.ao` section handling

3. **Update `src/transport.mjs`:**
   - Remove `getTransport()` AO branch
   - Remove AO-specific config options

4. **Update `src/config.mjs`:**
   - Remove AO config validation
   - Remove `config.ao` section

5. **Update `src/agent-api.mjs`:**
   - Remove AO-specific init options (processId, muUrl, cuUrl)
   - Remove `api.spawnAO()`, `api.loadLua()`, `api.waitForProcess()`
   - Keep `api.init()` working with just `keyType` and `transport`

### Phase 2: Enhance Arweave Transport

1. **Improve `ArweaveTransport.queryByTags()`:**
   - Add local cache as first lookup (already partially done)
   - Add cursor-based pagination for large result sets
   - Add staleness heuristic: if cache is <1h old, return cached results

2. **Add consensus computation to `ArweaveTransport`:**
   - Fetch all attestations for a given article key from Arweave
   - Compute consensus score client-side (same algorithm as `consensus.mjs`)
   - Cache consensus results locally

3. **Improve `ArweaveTransport.fetchDataItem()`:**
   - Better error handling for HTTP-SIG format (from HyperBEAM)
   - Retry logic for transient failures

### Phase 3: Update Skill and API

1. **Update `skills/permabrain/SKILL.md`:**
   - Remove all AO references
   - Update transport documentation
   - Add research-plan-loop integration guidance

2. **Update `skills/permabrain-pi/SKILL.md`:**
   - Same AO cleanup
   - Add section on using PermaBrain as a deep research output channel

3. **Update README.md:**
   - Remove AO quickstart section
   - Remove HyperBEAM/AO deployment instructions
   - Simplify to: init → publish → query → attest

### Phase 4: Research-Publish Skill

Create a new OpenClaw skill that teaches agents the research-plan-loop pattern:

```markdown
# PermaBrain Research-Publish Skill

## When to Use
- Deep research tasks (>1000 words of output)
- Multi-source synthesis
- Topics that should be discoverable by other agents
- Any research that other agents might build upon

## Flow
1. Research: Query existing PermaBrain articles (api.query, api.get)
2. Plan: Structure findings into a proper article (title, summary, sections, citations)
3. Publish: api.publish() → get Arweave link
4. Return link instead of wall of text

## When NOT to Use
- Quick factual answers (just reply in chat)
- Private/sensitive information
- Transient or time-limited information
```

This skill would be installable by any OpenClaw agent and would teach the pattern of "research → publish → return link" instead of "research → dump in chat."

## Risks and Mitigations

| Risk | Mitigation |
|------|-----------|
| Query performance without AO dryrun | Arweave GraphQL is fast enough for knowledge graph scale; local cache provides instant reads |
| Consensus computation client-side | Consensus is a weighted sum — trivial to compute client-side |
| No real-time updates without AO | Arweave GraphQL polling + cache staleness heuristic works fine for knowledge graph updates |
| Breaking change for existing AO users | AO transport was never in a stable release; no production deployments depend on it |

## Testing

- All existing tests pass (they use local or Arweave transport, not AO)
- `test:hyperbeam` tests already work without AO
- `test:arweave` tests work without AO
- Remove `test:ao` (doesn't exist yet — confirming AO was never fully tested)
- Add integration test for research-plan-loop pattern

## Timeline

- **Phase 1** (Remove AO): 1-2 hours — surgical removal, no new features
- **Phase 2** (Enhance Arweave): 2-3 hours — cache improvements, client-side consensus
- **Phase 3** (Update docs): 1 hour — remove AO references everywhere
- **Phase 4** (Research-publish skill): 1-2 hours — write the skill, test the pattern

Total: ~6-8 hours of focused work.