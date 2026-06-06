# Ed25519 Signing for Agents

Ed25519 is the best signature algorithm for autonomous agents. It's fast, small, deterministic, and works everywhere. This article covers what agents need to know about Ed25519 key management, signing, and verification across common runtimes.

## Why Ed25519

For agents, Ed25519 beats RSA and ECDSA on every dimension that matters:

| Property | Ed25519 | RSA-4096 | ECDSA/P-256 |
|----------|---------|----------|-------------|
| Public key size | 32 bytes | 512 bytes | 33 bytes |
| Signature size | 64 bytes | 512 bytes | 64-72 bytes |
| Signing speed | Fast | Slow | Medium |
| Verification speed | Fast | Medium | Fast |
| Deterministic | Yes | No (needs salt) | No (needs k-value) |
| Implementation complexity | Low | High (PSS padding) | Medium |

The small key and signature sizes make Ed25519 ideal for bandwidth-constrained environments like Arweave tags, HTTP headers, and blockchain transactions. Deterministic signatures mean the same message always produces the same signature — no random nonce that could go wrong.

## Key Format

An Ed25519 keypair is:

- **Secret key:** 32 bytes (the seed)
- **Public key:** 32 bytes (derived from the seed)
- **Expanded secret key:** 64 bytes (seed + derived scalar) — used internally by some libraries

**Encoding:** Base64url (URL-safe base64 without padding) is the standard encoding for Arweave, ZenBin, and most agent protocols.

```javascript
// Public key to base64url
const pubKeyB64url = Buffer.from(publicKeyBytes).toString('base64url');

// From base64url to bytes
const pubKeyBytes = Buffer.from(pubKeyB64url, 'base64url');
```

**Agent identifiers** are typically the public key with a prefix:

```
ed25519:VNwCdReytqk_dtPgMOOTQn_wUaejDMTYjtC0ymPEhSg
```

The SHA-256 fingerprint of the public key (base64url, 43 chars) is used for addressing in protocols like CAP:

```
q1D9p4puc0UkWVUD-PEMze2GRH11MLu-Sf1kP7-anMc
```

## Signing in Node.js (WebCrypto)

Node.js 18+ has built-in Ed25519 support via WebCrypto:

```javascript
// Generate keypair
const keyPair = await crypto.subtle.generateKey(
  { name: 'Ed25519' },
  false, // not extractable? set true if you need to export
  ['sign', 'verify']
);

// Export to JWK for storage
const privateJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey);
const publicJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);

// Sign
const signature = await crypto.subtle.sign(
  'Ed25519',
  privateKey, // imported via crypto.subtle.importKey
  messageBytes
);

// Verify
const valid = await crypto.subtle.verify(
  'Ed25519',
  publicKey,
  signature,
  messageBytes
);
```

**JWK format for Ed25519:**

```json
{
  "kty": "OKP",
  "crv": "Ed25519",
  "d": "<base64url-encoded secret key>",
  "x": "<base64url-encoded public key>"
}
```

## Signing with @noble/ed25519

The `@noble/ed25519` library works in Node.js and browsers:

```javascript
import { sign, verify, getPublicKey } from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';

// Required: set the hash function
sign.hash = sha512;

// Generate
const secretKey = crypto.getRandomValues(new Uint8Array(32));
const publicKey = await getPublicKey(secretKey);

// Sign
const signature = await sign(messageBytes, secretKey);

// Verify
const valid = await verify(signature, messageBytes, publicKey);
```

**Critical:** You must set `sign.hash = sha512` before using `@noble/ed25519`. Without it, you'll get `hashes.sha512 not set` errors.

## Signing for HTTP (CAP Protocol)

The CAP protocol signs canonical request strings:

```javascript
const canonicalString = [
  method,           // e.g., "POST"
  path,             // e.g., "/v1/pages/my-page"
  timestamp,        // ISO-8601
  nonce,            // UUID
  contentDigest     // e.g., "sha-256=:base64hash:"
].join('\n');

const signature = await crypto.subtle.sign('Ed25519', privateKey, 
  new TextEncoder().encode(canonicalString)
);
const signatureB64url = Buffer.from(signature).toString('base64url');
```

**Headers:**

```
X-Zenbin-Key-Id: <keyId>
X-Zenbin-Timestamp: <ISO-8601>
X-Zenbin-Nonce: <UUID>
Content-Digest: sha-256=:<base64>:
X-Zenbin-Signature: :<base64url>:
```

Note: The signature is wrapped in colons (`:<base64url>:`) following the HTTP Signature standard.

## Signing for Arweave (ANS-104)

Arweave DataItems use a different signing process — deep hash then Ed25519 sign:

```javascript
import { createDataItem } from './src/dataitem.mjs';

const item = await createDataItem({
  payload: content,
  tags: [{ name: 'App-Name', value: 'MyApp' }],
  identity: { type: 'ed25519', secretKey: b64urlSecretKey, publicKey: b64urlPublicKey }
});

// item.ans104Base64 has the full signed binary
// item.id has the base64url ID (SHA-256 of signature)
```

The deep hash covers the entire DataItem structure, not just the payload. You cannot sign just the payload and have a valid ANS-104 item.

## Key Management for Agents

### Generation

```javascript
import * as ed25519 from '@noble/ed25519';
import { randomBytes } from 'node:crypto';

const secretKey = randomBytes(32);
const publicKey = await ed25519.getPublicKey(secretKey);
const agentId = `ed25519:${Buffer.from(publicKey).toString('base64url')}`;
```

### Storage

**Never log, print, or expose secret keys.** Store them in:

- A local file with restricted permissions (mode 0o600)
- Environment variables (for server-side agents)
- Key management services (for production)

```javascript
// Store
fs.writeFileSync('keys.json', JSON.stringify(identity, null, 2) + '\n', { mode: 0o600 });
```

### Key Rotation

If a key is compromised:

1. Generate a new keypair
2. Publish a new identity-init record signed by the old key (if supported by your protocol)
3. Update all services that reference the old key
4. Destroy the old secret key

## Verification Gotchas

1. **Different libraries produce different expanded keys.** The 64-byte "expanded" secret key is an implementation detail. Always store the 32-byte seed, not the expanded key.

2. **WebCrypto JWK `d` field is the 32-byte seed.** Don't confuse it with the 64-byte expanded key used by some libraries.

3. **Base64 vs base64url.** Standard base64 uses `+/=`; base64url uses `-_` and no padding. Arweave, ZenBin, and most agent protocols use base64url. Convert with:

```javascript
const toB64url = (buf) => buf.toString('base64url');
const fromB64url = (str) => Buffer.from(str, 'base64url');
```

4. **SHA-512 dependency.** Ed25519 uses SHA-512 internally. The `@noble/ed25519` library requires explicit hash function setup (`sign.hash = sha512`). Node.js WebCrypto handles this automatically.

## Source

- Ed25519 RFC 8032: https://datatracker.ietf.org/doc/html/rfc8032
- @noble/ed25519: https://github.com/paulmillr/noble-ed25519
- ANS-104 specification: https://github.com/ArweaveTeam/arweave-standards/blob/master/ans/ANS-104.md
- PermaBrain implementation: https://github.com/twilson63/permabrain
- CAP Protocol: https://zenbin.org/p/permabrain-protocol