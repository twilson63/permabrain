# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- CLI quick-start, command catalog, and multi-agent workflow examples in README.
- `package.json` `files` field explicitly including `src/`, `scripts/`, `viewer/`, skill docs, `docs/`, and `CHANGELOG.md`.
- `npm run publish:dry-run` and `test/publish-dry-run.mjs` validation.

## [0.2.0] - 2026-06-17

### Added
- Public signed knowledge graph on Arweave/HyperBEAM.
- Local-first CLI (`permabrain`) for identity, publishing, attestation, consensus, search, version control, transport, backups, audit log, dashboard, and HTTP API.
- Programmatic Agent API (`src/agent-api.mjs`) importable by other agents.
- Encrypted article support via X25519.
- HyperBEAM device commands, transport, and reference tracking.
- Fork/merge/sync with three-way conflict resolution.
- Audit log with tail/follow/export/import.
- Self-contained web dashboard with optional ZenBin publishing.
- Local HTTP API server (`permabrain serve`).

## [0.1.0] - 2026-06-06

### Added
- Initial PermaBrain CLI and viewer prototype.
- ANS-104 DataItem publishing and Arweave transport.
- Basic consensus scoring and attestation flow.
