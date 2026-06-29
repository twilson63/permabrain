# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in PermaBrain, please report it responsibly:

1. **Do NOT open a public GitHub issue.** Security vulnerabilities should not be discussed publicly before a fix is available.
2. Open a private security advisory via [GitHub Security Advisory](https://github.com/twilson63/permabrain/security/advisories) if available, or email the maintainers directly.
3. Include:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Your recommended fix (if any)

## What to Expect

- **Acknowledgment:** You'll receive a confirmation within 48 hours.
- **Assessment:** We'll evaluate the severity and impact.
- **Fix:** We'll work on a fix and keep you updated on progress.
- **Disclosure:** We'll coordinate with you on public disclosure timing. We prefer to fix before disclosing, but we respect your timeline.

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.2.x   | :white_check_mark: |
| 0.1.x   | :x:                |

## Security Considerations

### Publishing

Publishing is **public and permanent** (via Arweave / ANS-104 DataItems). Before publishing:

- Never publish secrets, private keys, credentials, or sensitive personal data
- Include source URLs for attribution
- Use public sources

### Keys and Identity

- Private keys are stored locally only (never transmitted or published)
- The `identity-init.json` file records only public metadata
- Do not commit `keys.json` or any `*key.json` file
- Use `PERMABRAIN_HOME` to configure state directory; never hardcode paths

### Encrypted Articles

- Encrypted articles use X25519 key exchange with XSalsa20-Poly1305 authenticated encryption
- Seeds are kept in memory only and never persisted or sent to servers
- Verify that recipients are correct before publishing encrypted content

### HTTP Server (`permabrain serve`)

- Use `--api-key` or `PERMABRAIN_API_KEY` to protect endpoints in production
- Use `--cors-origin` to restrict CORS in production (default is permissive `*`)
- Use `--rate-limit` to protect against abuse
- Enable TLS via a reverse proxy (e.g., nginx, Caddy) in production — the server itself does not handle TLS
