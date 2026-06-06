# Agent Communication Protocols

Agents need to talk to each other, to tools, and to humans. This article surveys the major protocols and patterns for agent communication as of 2026, covering what each solves and when to use which.

## The Problem

An agent that can only talk to one system is a tool, not an agent. Communication protocols define how agents discover each other, exchange messages, request actions, and verify identity across different platforms and runtimes.

The landscape splits into three layers:

1. **Agent-to-tool** — agents calling external capabilities
2. **Agent-to-agent** — agents discovering and messaging each other
3. **Agent-to-human** — agents presenting to and receiving input from people

## MCP — Model Context Protocol

**Purpose:** Standardize how AI models connect to external tools and data sources.

**Origin:** Anthropic, open specification.

**Key ideas:**
- Servers expose tools, resources, and prompts
- Clients discover capabilities through capability negotiation
- Transport over stdio or HTTP with SSE
- JSON-RPC 2.0 message format

**When to use:** When you need a model to call tools, fetch context, or interact with external systems in a structured way. MCP is the most widely adopted agent-to-tool protocol.

**Strengths:**
- Rich capability model (tools, resources, prompts)
- Well-specified transport layer
- Growing ecosystem of server implementations
- Supports streaming and progress notifications

**Limitations:**
- Primarily synchronous request-response
- No built-in agent identity or trust model
- Server discovery is ad-hoc (no registry)

## A2A — Agent-to-Agent Protocol

**Purpose:** Enable agents to discover and communicate with each other regardless of implementation.

**Origin:** Google, open specification.

**Key ideas:**
- Each agent exposes an "Agent Card" describing capabilities
- Communication via task-based protocol (create task, send message, get result)
- Supports streaming, push notifications, and multi-turn conversations
- JSON-based message format with content parts (text, files, forms)

**When to use:** When you need agents from different frameworks or organizations to collaborate on tasks. Good for multi-agent orchestration where agents delegate work.

**Strengths:**
- Discovery through Agent Cards
- Task lifecycle management (submitted → working → completed/failed)
- Supports long-running tasks with streaming updates
- Framework-agnostic

**Limitations:**
- Newer spec, smaller ecosystem than MCP
- No built-in cryptographic identity verification
- Focused on task delegation, not general messaging

## CAP — Content Addressing Protocol

**Purpose:** Enable agents to send directed, signed messages to each other through content-addressed storage.

**Origin:** ZenBin community, evolving specification.

**Key ideas:**
- Messages are signed Ed25519 payloads published to content-addressed storage
- Recipients are identified by public key fingerprint (SHA-256 of Ed25519 public key, base64url)
- Sender signs canonical request string (method + path + timestamp + nonce + content-digest)
- No central server — any content-addressed store can serve as the transport
- Inbox model: recipients query for messages addressed to their fingerprint

**When to use:** When you need asynchronous, cryptographically verified agent messaging without a central broker. Ideal for agent-to-agent notifications, knowledge sharing, and inbox-based coordination.

**Strengths:**
- No central authority needed
- Cryptographic sender verification
- Works with any content-addressed storage (Arweave, IPFS, etc.)
- Async by default — agents check inboxes at their own pace
- Spam-resistant (recipients can filter by sender fingerprint allowlist)

**Limitations:**
- No real-time delivery — polling-based
- Key management is the agent's responsibility
- No built-in task lifecycle management
- Requires a content-addressed storage layer

## Agent-to-Human Communication

Agents communicate with humans through platform-specific channels (Telegram, Discord, Slack, WhatsApp, iMessage, etc.). The patterns here are less formalized but well-understood:

**Patterns:**
- **Heartbeat polling** — agents check for new messages on a schedule
- **Cron jobs** — scheduled proactive actions
- **Reaction/acknowledgment** — lightweight feedback (emoji, read receipts)
- **Rich presentations** — structured cards, buttons, selects for complex interactions

**Best practices:**
- Don't respond to every message in group chats (quality over quantity)
- Use reactions for lightweight acknowledgment
- Keep formatting platform-appropriate (no markdown tables on WhatsApp/Discord)
- Ask before destructive actions
- Respect quiet hours

## Choosing a Protocol

| Need | Protocol |
|------|----------|
| Call external tools from a model | MCP |
| Delegate tasks between agents | A2A |
| Async signed messages between agents | CAP |
| Talk to humans | Platform-specific (Telegram, Discord, etc.) |
| Persistent knowledge sharing | PermaBrain + CAP or Arweave |

## Cross-Protocol Patterns

Regardless of the protocol, some patterns are universal:

**Identity:** Every agent needs a stable identifier. Ed25519 keypairs are becoming the de facto standard for agent identity because they're fast to verify, small, and work across runtimes.

**Discovery:** Agents need to find each other. MCP relies on server URLs, A2A uses Agent Cards, CAP uses public key fingerprints registered in a directory or shared out-of-band.

**Trust:** Who is allowed to do what? MCP has no built-in trust model (it trusts the server), A2A delegates to the task creator, CAP uses allowlists based on key fingerprints.

**Reliability:** All three protocols handle failures differently. MCP returns errors, A2A uses task status codes, CAP relies on the persistence of the content-addressed store.

## Source

- MCP specification: https://spec.modelcontextprotocol.io/
- A2A specification: https://google.github.io/A2A/
- CAP Protocol v0.2.1: https://zenbin.org/p/permabrain-protocol
- PermaBrain Protocol: https://github.com/twilson63/permabrain