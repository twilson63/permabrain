# PermaBrain Protocol

PermaBrain is a protocol for publishing public knowledge records and signed evaluations of those records.

The protocol does not require a specific client, database, gateway, chain, or programming language. Any implementation can participate if it can publish immutable signed records, attach queryable metadata, retrieve records by id, and verify record signatures.

## Goals

PermaBrain exists to make public knowledge easier to inspect over time.

It tracks:

- the content of a knowledge article
- who published it
- when it was published
- what sources it cites
- how later versions relate to earlier versions
- who evaluated the article
- what those evaluations claimed

PermaBrain does not decide final truth. It keeps the evidence trail and lets clients compute their own view of trust.

## Core concepts

### Agent

An agent is any person, program, organization, or autonomous system that can sign records.

Each agent has a stable public identifier. The identifier should be derived from, or clearly linked to, the public key used to verify that agent's signatures.

Examples:

```text
arweave:<address>
ed25519:<public-key>
did:<method>:<identifier>
```

The protocol does not require one identity system. Implementations must document which signature and identity schemes they support.

### Record

A record is an immutable signed object.

A record has:

- a unique id
- a payload
- metadata fields
- a signature
- enough public key or owner information to verify the signature

Records are append-only. A record is never edited in place. Corrections, updates, and disputes are published as new records.

### Article

An article is a public knowledge record. It contains human-readable or machine-readable content about a subject.

An article belongs to a canonical key, such as:

```text
person/ada-lovelace
organization/arweave
subject/artificial-intelligence
event/2026-example-event
news/2026/example-story
```

The key identifies the topic across versions. It does not identify one immutable version.

### Attestation

An attestation is a signed evaluation of an article version.

An attestation points to:

- the immutable id of the article version being evaluated
- the canonical article key

It then states an opinion, confidence, reason, and optional supporting source.

Attestations are separate records. They do not modify the article they evaluate.

## Record types

Every PermaBrain record must declare its protocol name and record type.

Minimum shared attributes:

```text
permabrain-app-name: PermaBrain
permabrain-app-version: <version>
permabrain-record-type: article | attestation
permabrain-visibility: public
```

## Attribute and HTTP header conventions

PermaBrain canonical attribute names are lowercase kebab-case identifiers prefixed with `permabrain-`. Implementations should use these compatible attribute names by default across storage tags, JSON keys, database columns, event attributes, and HTTP headers unless a host system requires a different encoding.

This convention is intentionally compatible with HTTP/2 and HTTP/3, where header field names are lowercase on the wire. It also works with HTTP/1.1, ANS-104 tags, signed HTTP transactions, and simple indexers.

Field matching is case-insensitive for compatibility, but implementations must not define two attributes that differ only by case. Clients should normalize attribute names before validation, indexing, and query matching.

Examples:

```text
permabrain-app-name
permabrain-app-version
permabrain-record-type
permabrain-visibility
permabrain-article-key
permabrain-article-version
permabrain-content-hash
permabrain-target-article-id
permabrain-opinion
permabrain-confidence
```

When a record is submitted as an HTTP signed transaction, the PermaBrain headers should be included in the signed component set along with the method, target path, content digest, and timestamp. A reader that fetches the record with `GET` should be able to inspect the returned `permabrain-*` headers and verify that they match the signed record body or stored metadata.

Recommended HTTP signed submission headers:

```text
content-digest: sha-256=:BASE64_DIGEST:
permabrain-app-name: PermaBrain
permabrain-app-version: <version>
permabrain-record-type: article | attestation
permabrain-visibility: public
permabrain-article-key: <kind>/<slug>
permabrain-content-hash: sha256:<hex>
signature-input: ...
signature: ...
```

HTTP responses should return the same `permabrain-*` headers when practical, so clients can discover and filter records without parsing the full payload first.

## Article record

An article record should include these fields:

```text
permabrain-record-type: article
permabrain-article-key: <kind>/<slug>
permabrain-article-kind: person | subject | event | organization | source | news
permabrain-article-title: <title>
permabrain-article-slug: <slug>
permabrain-article-topic: <topic>
permabrain-article-language: <language code>
permabrain-article-version: <positive integer>
permabrain-previous-article-id: <previous immutable article id, optional>
permabrain-root-article-id: <first immutable article id, optional>
permabrain-source-name: <source name>
permabrain-source-url: <source URL>
permabrain-source-license: <license, optional>
permabrain-content-hash: sha256:<hex>
permabrain-published-at: <timestamp>
permabrain-updated-at: <timestamp>
permabrain-author-agent-id: <agent id>
permabrain-visibility: public
```

The payload is the article content. Markdown is a common format, but the protocol does not require Markdown.

### Article key rules

An article key has this shape:

```text
<kind>/<slug>
```

The kind describes the broad category. The slug is a lowercase URL-safe name.

Nested keys are allowed when useful:

```text
news/2026/example-story
```

Clients should reject empty keys, unknown kinds, and keys with unsafe characters.

### Article versioning

Each update creates a new article record with:

- the same article key
- an incremented version number
- `Previous Article Id` pointing to the prior version, when known
- `Root Article Id` pointing to the first version, when known

Clients resolve the latest version by sorting all article records with the same key:

1. highest article version wins
2. if tied, newest update timestamp wins
3. if still tied, clients may use deterministic id ordering

## Attestation record

An attestation record should include these fields:

```text
permabrain-record-type: attestation
permabrain-target-article-id: <immutable article record id>
permabrain-target-article-key: <article key>
permabrain-opinion: valid | invalid | partially-valid | outdated | disputed
permabrain-confidence: <number from 0 to 1>
permabrain-reason: <short explanation>
permabrain-attesting-agent-id: <agent id>
permabrain-source-url: <optional supporting source URL>
permabrain-created-at: <timestamp>
```

The payload may repeat these fields as structured data. The metadata fields are the query surface; the payload is the fuller body if an implementation needs one.

### Opinion meanings

```text
valid            The article is substantially accurate.
partially-valid  The article is partly accurate but incomplete or flawed.
outdated         The article may have been accurate, but newer information changes it.
disputed         The article is contested or needs competing evidence.
invalid          The article is substantially wrong.
```

### Confidence

Confidence is a number from `0` to `1`.

It is not a universal truth score. It only says how strongly the attesting agent stands behind its own opinion.

## Validation

A client should validate records before using them.

For every record:

1. Verify the signature.
2. Verify that the record id matches the signed bytes or signed content.
3. Verify that required fields are present.
4. Verify that the declared author or attesting agent matches the signing identity, or is bound to it by a documented identity rule.
5. Verify timestamps are parseable.
6. Verify hashes match the payload.

For article records:

1. Validate the article key.
2. Validate the article kind.
3. Validate that the version is a positive integer.
4. Verify `Content Hash` against the article payload.
5. If `Previous Article Id` is present, clients may fetch it and check that it has the same article key.

For attestation records:

1. Validate the target article key.
2. Validate the opinion.
3. Validate that confidence is between `0` and `1`.
4. Fetch the target article id when possible.
5. Check that the target article's key matches `Target Article Key`.

Clients may show unverified records, but they should label them clearly. Consensus calculations should use verified records only.

## Query model

The protocol assumes records can be queried by metadata.

Common queries:

### Articles by topic

```text
permabrain-app-name = PermaBrain
permabrain-record-type = article
permabrain-article-topic = <topic>
```

### Article versions by key

```text
permabrain-app-name = PermaBrain
permabrain-record-type = article
permabrain-article-key = <kind>/<slug>
```

### Attestations for an article

```text
permabrain-app-name = PermaBrain
permabrain-record-type = attestation
permabrain-target-article-key = <kind>/<slug>
```

### Attestations for a specific version

```text
permabrain-app-name = PermaBrain
permabrain-record-type = attestation
permabrain-target-article-id = <record id>
```

A storage system that cannot query by metadata can still participate, but it will need an indexer.

## Consensus

Consensus is not part of storage. It is a client-side calculation over attestations.

A basic scoring model:

```text
valid:           +1.0
partially-valid: +0.5
outdated:        -0.5
disputed:        -0.75
invalid:         -1.0
```

For each attestation:

```text
contribution = opinion_weight * confidence
```

A simple score is:

```text
score = sum(contribution) / number_of_attestations
```

Clients may use richer scoring. For example, they may:

- count only the latest attestation from each agent for each target version
- reduce the weight of attestations on older article versions
- reduce the weight of old attestations
- weight agents by reputation or trust lists
- show separate scores by community or source set

Any client that publishes a consensus score should explain how it calculated that score.

## Storage requirements

PermaBrain can run on any storage layer that supports these properties:

1. Records are immutable after publication.
2. Records are signed.
3. Records can be fetched by id.
4. Metadata can be queried directly or through an indexer.
5. Payload integrity can be checked with a content hash.

ANS-104 DataItems on Arweave-compatible infrastructure are one implementation. They are not the protocol itself.

## Interoperability mapping for ANS-104

In the ANS-104 implementation, PermaBrain fields are encoded as tags.

Common tag names use the same compatible attribute names:

```text
permabrain-app-name: PermaBrain
permabrain-app-version: <version>
permabrain-record-type: article | attestation
permabrain-visibility: public
```

Article attributes use names such as `permabrain-article-key` and `permabrain-article-version`. Attestation attributes use names such as `permabrain-target-article-id` and `permabrain-opinion`.

Implementations on other systems should preserve these compatible attribute names whenever possible.

## Privacy and safety

PermaBrain is for public records. Do not publish secrets, private personal data, credentials, or anything that should be deleted later.

Deletion is not a protocol assumption. A client can hide, filter, or supersede a record, but the underlying record may remain available forever.

## Compatibility

A PermaBrain-compatible implementation should be able to:

1. Publish signed article records.
2. Publish signed attestation records.
3. Query article records by key, topic, and kind.
4. Query attestation records by target key and target id.
5. Resolve the latest article version for a key.
6. Verify record signatures and content hashes.
7. Compute or expose attestations so clients can compute consensus.