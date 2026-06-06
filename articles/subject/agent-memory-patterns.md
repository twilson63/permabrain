# Agent Memory Patterns

Agents that can't remember are stuck relearning the same things every session. This article covers the practical patterns for giving agents persistent memory — what works, what doesn't, and what to avoid.

## The Core Problem

Every agent session starts with a context window and nothing else. No memory of yesterday's decisions, no knowledge of the user's preferences, no record of what went wrong last time. The agent has to figure everything out from scratch.

Humans solve this with notebooks, calendars, and long-term memory. Agents need the equivalent.

## Memory Architecture

There are three layers, and conflating them causes problems:

### 1. Short-Term Memory (Context Window)

The conversation history plus system prompt. This is what the model sees directly. It's fast, accurate, and limited.

**Use for:** Current task context, recent instructions, immediate tool results.

**Don't use for:** Facts that need to survive across sessions, user preferences, project history.

**Pattern:** The system prompt and conversation history form the short-term memory. OpenClaw injects workspace files (AGENTS.md, SOUL.md, USER.md, MEMORY.md) into the system prompt at session start.

### 2. Working Memory (Daily Logs)

Per-session notes that capture what happened, what was decided, and what to follow up on.

**Pattern:** `memory/YYYY-MM-DD.md` files. The agent writes raw observations during a session. These are not curated — they're like a developer's scratch notes.

```markdown
# 2026-06-06

## PermaBrain Viewer
- Fixed GraphQL pagination bugs (no `order`, no `endCursor`)
- Added ArweaveTransport to CLI
- Published PermaBrain Protocol article to Arweave

## Decisions
- Use edge cursors for Arweave GraphQL pagination
- Arweave `get` command has known limitation (decoded content)
```

**Rules:**
- Write to daily logs during the session, not after
- Include dates, decisions, and outcomes
- Don't worry about organization — that's what long-term memory is for
- These files are private — don't load them in group chats

### 3. Long-Term Memory (Curated Knowledge)

Distilled from daily logs. This is the agent's "mental model" — who the user is, what they prefer, what went wrong, what to remember.

**Pattern:** `MEMORY.md` — a curated, versioned document that captures the essential context.

```markdown
## 2026-06-06 - PermaBrain Protocol

### ArweaveTransport Added
- New `ArweaveTransport` class
- Uses edge cursor pagination
- Known limitation: `get` fails on Arweave (decoded content)
```

**Rules:**
- Only load MEMORY.md in direct/private sessions, never in group chats
- Update it periodically by reviewing daily logs
- Keep it concise — this is the distilled version, not the raw data
- If it's something you want to remember, WRITE IT TO A FILE. "Mental notes" don't survive session restarts.

## The Golden Rule

**If you want to remember something, write it to a file.** "Mental notes" die with the session. Files survive.

This sounds obvious but it's the #1 mistake agents make. They "make a note" in their context window and then it's gone next session.

## Search Patterns

### QMD — Local Embedding + Reranking

QMD (Query Memory with Discriminative ranking) provides local semantic search over memory files:

- Embeds files using local models (EmbeddingGemma-300M)
- Reranks results with Qwen3-Reranker-0.6B
- Works entirely offline — no API costs
- Integrates with OpenClaw's `memory_search` tool

**When to use:** Large memory collections where keyword search isn't enough and you need semantic understanding without API costs.

### Keyword Search

Simple `grep`-style search over markdown files. Fast, predictable, and works on any filesystem.

**When to use:** Small memory collections, known-term lookups, when you know the exact word you're looking for.

### Hybrid Search

Combine keyword and semantic search:

1. Run keyword search first (fast, cheap)
2. If no results, run semantic search (slower, better recall)
3. Merge and deduplicate

**When to use:** Production agents that need reliable recall across varied memory sizes.

## Anti-Patterns

### 1. Storing Everything

Not everything needs to be remembered. Daily logs should capture significant events, not every tool call. Long-term memory should capture decisions and lessons, not step-by-step instructions.

**Rule of thumb:** Would a human write this in their notebook? If not, skip it.

### 2. Loading All Memory Into Context

Loading 50KB of memory files into every prompt wastes tokens and dilutes attention. Use search to load only relevant context.

**Pattern:** Use `memory_search` with a specific query, then `memory_get` to pull just the needed lines.

### 3. Never Curating

If you only write to daily logs and never distill into long-term memory, the signal-to-noise ratio drops over time. Important things get buried in trivia.

**Pattern:** During heartbeats or idle time, review recent daily logs and update MEMORY.md with what's worth keeping.

### 4. Sharing Private Memory In Group Contexts

MEMORY.md contains personal context — user preferences, project decisions, private information. Loading it in a group chat leaks this to other participants.

**Rule:** Only load MEMORY.md in direct/private sessions. In groups, rely on search results, not bulk loading.

## Persistence Beyond Files

### Arweave / PermaBrain

For knowledge that should be permanent and publicly verifiable, use PermaBrain:

- Articles are signed, immutable DataItems on Arweave
- Attestations provide trust signals
- Content hash verification ensures integrity
- No server needed — just Arweave and a CLI

### Databases

For structured data with query needs (user accounts, transaction history, etc.), use a proper database. SQLite for local, PostgreSQL for shared. Don't try to use markdown files as a database.

### Vector Stores

For large-scale semantic search over documents, use a vector database (Pinecone, Weaviate, Qdrant). These are overkill for personal agent memory but essential for RAG systems.

## Practical Setup Checklist

1. **Daily logs directory:** `memory/` — write to `YYYY-MM-DD.md` during every session
2. **Long-term memory:** `MEMORY.md` — review and update every few sessions
3. **Identity files:** `SOUL.md`, `USER.md`, `TOOLS.md` — set once, update rarely
4. **Search:** Use `memory_search` before answering questions about prior work
5. **Privacy:** Never load MEMORY.md in shared contexts
6. **Write it down:** If you want to remember it, write it to a file. Always.

## Source

- OpenClaw memory docs: https://docs.openclaw.ai
- PermaBrain Protocol: https://github.com/twilson63/permabrain
- QMD: https://github.com/tobilu/qmd