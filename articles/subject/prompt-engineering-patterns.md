# Prompt Engineering Patterns for Agents

Prompt engineering for autonomous agents is different from prompt engineering for chat. Agents operate in loops, manage tools, and persist across sessions. This article covers the patterns that matter most for building reliable, capable AI agents.

## The Fundamental Shift

Chat prompts are one-shot: ask, answer, done. Agent prompts are **operating systems** — they define behavior, constraints, priorities, and recovery strategies across potentially thousands of tool calls and message turns.

A good agent prompt is not clever wording. It's a behavioral specification.

## Pattern 1: Tool-First Design

**Bad:** "When you need to search the web, search the web."
**Good:** "Before answering factual questions about current events, prices, or anything that changes: use `web_search`. Do not guess."

The agent should know *when* to use each tool, not just *that* a tool exists. Explicit trigger conditions prevent both under-use (guessing instead of searching) and over-use (searching for things you already know).

**Template:**
```
- Use `web_search` for: current events, prices, dates, anything that changes
- Use `web_fetch` for: reading specific URLs the user provides
- Use `memory_search` for: prior decisions, preferences, project history
- Use `file_read` for: checking current state before modifying files
```

## Pattern 2: Read-Before-Write

Agents must never overwrite a file without reading it first. This prevents accidental data loss and ensures edits are based on reality, not assumptions.

**Implementation:**
```
Before editing any file, read it first. Never assume file contents.
If you need to write a new file, confirm the path is correct.
```

This is so important it should be a hard rule in the system prompt, not a suggestion.

## Pattern 3: Memory Separation

Agents need three kinds of memory, and conflating them causes problems:

1. **Short-term** — the current conversation context (handled by the model)
2. **Working memory** — daily logs, recent events (`memory/YYYY-MM-DD.md`)
3. **Long-term** — curated decisions, preferences, identity (`MEMORY.md`)

**Pattern:** Write to daily logs during sessions. Periodically distill daily logs into long-term memory. Never load long-term memory in shared/group contexts — it may contain private information.

```
- Daily notes: memory/YYYY-MM-DD.md — raw logs of what happened
- Long-term: MEMORY.md — curated memories, like a human's long-term memory
- Capture what matters. Skip the secrets unless asked to keep them.
```

## Pattern 4: Act-Then-Report, Not Plan-Then-Ask

Agents should act on actionable requests in the current turn. Do not finish with a plan or promise when you have the tools to make progress.

**Bad:** "I'll search for that information and get back to you."
**Good:** [uses web_search tool, then reports findings]

The exception is when you're genuinely blocked — need a decision, lack access, or face a safety concern. Then ask clearly and stop.

## Pattern 5: Safety as Behavior, Not Just Warnings

Safety in agent prompts should be behavioral rules, not abstract warnings.

**Bad:** "Be safe."
**Good:**
```
- Don't exfiltrate private data. Ever.
- Don't run destructive commands without asking.
- Use `trash` instead of `rm` when available.
- When in doubt, ask.
- Never send half-baked replies to messaging surfaces.
```

Specific rules are enforceable. Abstract values are ignorable.

## Pattern 6: Heartbeat vs Cron

Agents that receive periodic wake-up signals need clear rules about what to do:

**Heartbeat:** Periodic check-in with full conversation context. Good for batching related checks (inbox + calendar + notifications). Timing can drift.

**Cron:** Scheduled isolated task. Good for exact timing, isolated context, different model/thinking level. No conversation history by default.

**Pattern:** Batch periodic checks into heartbeats. Use cron for exact schedules and one-shot reminders.

## Pattern 7: Output Format Awareness

Agents that send messages to different platforms need format rules:

```
- Telegram/WhatsApp: no markdown tables, no headers — use bold or CAPS
- Discord: wrap multiple links in <> to suppress embeds
- Slack: use mrkdwn format, not raw markdown
- iMessage: keep it short, no formatting at all
```

Sending markdown tables to WhatsApp is worse than no formatting at all.

## Pattern 8: Error Recovery

Agents will encounter errors. The prompt should define recovery behavior:

```
- If a tool call fails, try a different approach before giving up
- If web_search returns nothing, try different query terms
- If a file doesn't exist, check if the path is wrong before assuming it's missing
- If you can't do something, say what you tried and what blocked you
```

## Pattern 9: Personality Without Sycophancy

Agents with personality are more useful than neutral ones, but the line between personality and sycophancy is real:

**Good personality:** "That approach has a race condition. Consider using a mutex instead."
**Sycophancy:** "Great idea! You might want to consider maybe adding a mutex if you feel like it."

**Pattern:**
```
Have opinions. Strong ones. Stop hedging with "it depends" — commit to a take.
Never open with "Great question" or "I'd be happy to help."
Call things out. If they're about to do something dumb, say so.
```

## Pattern 10: The Pre-Flight Check

Before taking any external action (sending a message, making an API call, writing to a file), the agent should verify:

1. Is this the right action?
2. Do I have the right target/recipient?
3. Am I authorized to do this?
4. Is this idempotent / reversible if it fails?

This is especially important for irreversible actions like sending messages to group chats or deleting data.

## Anti-Patterns to Avoid

1. **Over-prompting** — Too many rules makes the agent rigid. Prefer 10 clear rules over 50 vague ones.
2. **Vague authority** — "You are a helpful assistant" tells the model nothing about what makes it different from any other assistant.
3. **Forgetting the platform** — An agent that writes markdown tables to WhatsApp is broken, regardless of how good the content is.
4. **Assuming memory** — Every session starts fresh. If you want the agent to remember something, write it to a file.
5. **Saying "I'll do that"** — If you have the tools, do it now. If you don't, say what you need.

## Source

- OpenAI best practices for agent prompts: https://platform.openai.com/docs/guides/prompt-engineering
- Anthropic prompt engineering guide: https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/overview
- PermaBrain Protocol: https://github.com/twilson63/permabrain
- OpenClaw agent configuration: https://docs.openclaw.ai