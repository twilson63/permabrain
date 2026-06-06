# Arweave ANS-104 DataItem Format

ANS-104 is the binary format used to bundle and sign data items on Arweave. Understanding it is essential for any agent or tool that creates, uploads, or verifies Arweave transactions. This article covers the format, gotchas, and practical patterns for working with ANS-104 DataItems.

## What ANS-104 Solves

Arweave transactions are expensive — each one requires an Arweave token (AR) fee. ANS-104 (also called "bundling") lets you pack thousands of signed data items into a single Arweave transaction. A bundler pays the AR fee and submits the bundle; individual data items are independently verifiable without the bundle transaction.

This is how `up.arweave.net` and other bundlers work: you POST a single DataItem, the bundler bundles it with others, and the whole bundle gets mined as one Arweave transaction.

## Binary Layout

A DataItem is a binary blob with this structure:

```
[2 bytes]   Signature type (1 = RSA-4096, 2 = Ed25519)
[sig_len]   Signature
[pub_len]   Public key / Owner
[1 byte]    Target present flag (0 or 1)
[0|32]      Target (if present)
[1 byte]    Anchor present flag (0 or 1)
[0|32]      Anchor (if present)
[8 bytes]   Tag count (Avro long)
[8 bytes]   Tag bytes length (Avro long)
[N bytes]   Tag data (Avro-encoded name/value pairs)
[rest]      Data payload
```

### Signature Types

| Type | ID | Signature Length | Public Key Length |
|------|----|-----------------|-------------------|
| RSA-4096-PSS | 1 | 512 bytes | 512 bytes |
| Ed25519 | 2 | 64 bytes | 32 bytes |

Other signature types exist in the ANS-104 spec but are rarely used. PermaBrain supports types 1 and 2.

### Tags

Tags are Avro-encoded name-value string pairs. The encoding uses variable-length longs (Avro zigzag encoding):

```
[tag count as Avro long] [total tag bytes as Avro long]
[for each tag: name_length as Avro long, name bytes, value_length as Avro long, value bytes]
[0 as Avro long terminator]
```

**Important:** Tag names and values are UTF-8 strings. Tag matching in Arweave GraphQL is case-sensitive.

### Target and Anchor

These are optional 32-byte fields:

- **Target** — the destination address for the data item (like `to` in a transaction). Most data items set this to empty (flag = 0).
- **Anchor** — a 32-byte reference to another transaction. Used for linking. Also commonly empty (flag = 0).

### Data Payload

Everything after the tag bytes is the data payload. This is the actual content — article text, file data, etc.

## Signing

The signing input is the **deep hash** of:

```
["dataitem", "1", signature_type_string, owner_bytes, target_bytes, anchor_bytes, tag_bytes, data_bytes]
```

The deep hash algorithm (SHA-384 based) recursively hashes the array structure:

1. For arrays: hash `list` + length, then hash each element, chaining
2. For byte strings: hash `blob` + length, then the bytes

**For Ed25519**, the signature is 64 bytes over the deep hash output.
**For RSA-4096-PSS**, the signature uses SHA-256 with PSS padding and salt length 32.

## Item ID

The DataItem ID is the SHA-256 hash of the raw signature bytes, encoded as base64url. This is NOT the same as the deep hash — it's a simple SHA-256 of the 64-byte (Ed25519) or 512-byte (RSA) signature.

```javascript
const id = b64url(crypto.createHash('sha256').update(rawSignature).digest());
```

## Uploading

### Via Bundler

POST the raw binary to `https://up.arweave.net/tx` with `Content-Type: application/octet-stream`. The response includes commitment signatures.

```javascript
const res = await fetch('https://up.arweave.net/tx', {
  method: 'POST',
  headers: { 'Content-Type': 'application/octet-stream' },
  body: new Uint8Array(rawBytes)
});
```

**Important:** The bundler accepts the item immediately (200 OK) but finalization on Arweave takes 5-20 minutes. Your item won't be queryable via GraphQL or fetchable via `arweave.net/{id}` until the bundler's bundle is mined.

### Via Direct Transaction

If you have AR tokens, you can create a standard Arweave transaction instead. This is more expensive but confirms faster.

## Fetching

### From Arweave Gateway

```javascript
const res = await fetch(`https://arweave.net/${encodeURIComponent(id)}`);
```

**Critical gotcha:** Arweave gateways serve the **decoded content payload**, not the raw ANS-104 binary. If you fetch `arweave.net/{id}`, you get the data payload, not the DataItem with tags and signature.

To get tags and verify signatures, you must query GraphQL:

```graphql
query($id: ID!) {
  transaction(id: $id) {
    id
    tags { name value }
  }
}
```

### From a Bundle

If you have the raw bundle bytes, parse each DataItem by walking the binary layout. Each item's length is determined by the signature type, target/anchor flags, and tag byte count.

## GraphQL Pagination

Arweave GraphQL has specific constraints that trip up newcomers:

1. **No `order` argument** on `transactions`. The `order: DESC` field does not exist and will return a 400 error.
2. **No `endCursor` in `pageInfo`**. The `pageInfo` object only has `hasNextPage`. Use the `cursor` field from each edge for pagination.
3. **Edge cursors are the pagination mechanism**. Get the cursor from the last edge, pass it as `after` in the next query.

**Working pagination query:**

```graphql
query($tags: [TagFilter!], $first: Int!, $after: String) {
  transactions(first: $first, after: $after, tags: $tags) {
    edges { cursor node { id tags { name value } } }
    pageInfo { hasNextPage }
  }
}
```

**Next page:** Use `edges[last].cursor` as the `after` value in the next query.

## Content Verification

Each DataItem's tags may include a content hash (e.g., `Article-Content-Hash: sha256:abc123`). To verify:

1. Fetch the content from `arweave.net/{id}`
2. Compute `sha256:{hex}` of the content
3. Compare with the tag value

```javascript
const content = await response.text();
const hash = 'sha256:' + crypto.createHash('sha256').update(content).digest('hex');
if (hash !== tagContentHash) throw new Error('Content hash mismatch');
```

## Common Mistakes

1. **Using `order: DESC` in GraphQL** — Arweave doesn't support it. Remove it.
2. **Using `pageInfo.endCursor`** — Doesn't exist. Use `edges[last].cursor`.
3. **Expecting raw ANS-104 from `arweave.net/{id}`** — You get decoded content, not binary.
4. **Tag case sensitivity** — `App-Name` and `app-name` are different tags in Arweave.
5. **Avro encoding errors** — Tag count and byte length use Avro zigzag encoding, not plain integers.
6. **Signature over wrong data** — Must deep-hash the entire structure including type string, not just the payload.

## Source

- ANS-104 specification: https://github.com/ArweaveTeam/arweave-standards/blob/master/ans/ANS-104.md
- Arweave GraphQL: https://gq.arweave.dev/
- Bundler API: https://up.arweave.net
- PermaBrain implementation: https://github.com/twilson63/permabrain