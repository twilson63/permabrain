# PermaBrain Phase 1 Architecture

```text
Agent / pi skill / CLI
  ↓
PermaBrain command layer
  ↓
config + Arweave-compatible keys + tags + ANS-104 data item builder
  ↓
optional encryption
  ↓
serialized signed ANS-104 DataItem bytes
  ↓
transport adapter
  ├─ HyperBEAM local gateway/bundler/graphql
  └─ public Arweave/Turbo/Irys fallback later
  ↓
Arweave permanent storage
```

## Core Modules

- `config.mjs` — load/write project and user config
- `keys.mjs` — Arweave-compatible wallet and encryption key management
- `tags.mjs` — encode/decode/validate public `Article-*` and `Attestation-*` tags
- `dataitem.mjs` — create/sign/serialize ANS-104 DataItems for bundler upload
- `crypto.mjs` — optional content encryption/decryption
- `hyperbeam.mjs` — local HyperBEAM upload/query/fetch adapter
- `arweave.mjs` — generic gateway/bundler fallback adapter
- `cache.mjs` — local sync index and cached pages

## Local State

Suggested local state under project or user config:

```text
.permabrain/
├── config.json
├── keys.json        # private; chmod 600
├── cache/
│   ├── index.json
│   └── pages/
└── logs/
```

## ANS-104 Upload Model

All public/bundler uploads must be serialized ANS-104 DataItem bytes. Development JSON envelopes may be used only for local unit tests and caches. HyperBEAM, `up.arweave.net`, and other bundler-compatible endpoints should receive the same ANS-104 byte representation.

## Immutability Model

Each edit creates a new ANS-104 DataItem. Latest version is resolved by querying all items for an `Article-Key` and choosing the highest `Article-Version` or latest `Article-Updated-At`.

## Migration Path

Phase 2 AO process can index the same DataItems by reading tags and content hashes. Phase 3 HyperBEAM device can use the same tag schema as its import/export compatibility layer.
