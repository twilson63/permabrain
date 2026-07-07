---
name: daytona-sandbox
description: Test and verify code in isolated Daytona sandboxes. Use when the user wants to run code safely, check behavior across environments, reproduce bugs, execute untrusted scripts, validate installations, or verify outputs before applying changes to the main workspace. Works with the Daytona TypeScript SDK and API client.
---

# Daytona Sandbox Skill

Use Daytona sandboxes to execute code in isolated, reproducible environments before trusting it in the main workspace.

## When to use this skill

- Run user-provided or generated code safely.
- Reproduce a bug in a clean environment.
- Verify a package install, build, or test result.
- Compare behavior across Node, Python, or shell contexts.
- Inspect files or outputs from untrusted code without exposing the host.

## Requirements

- `DAYTONA_API_KEY` environment variable (provided by the host/runtime, never stored in the skill).
- Daytona SDK or API client available in the workspace (`@daytona/sdk` or `@daytona/api-client`).

## Core workflow

1. **Create a sandbox** with the target image and timeout.
2. **Upload or write the code** into the sandbox.
3. **Run the command** and stream logs.
4. **Capture the result** (exit code, stdout, stderr, files).
5. **Destroy the sandbox** unless it needs to be inspected again.

## Quick example

```js
import { Daytona } from '@daytona/sdk';

const daytona = new Daytona({
  apiKey: process.env.DAYTONA_API_KEY,
  serverUrl: process.env.DAYTONA_SERVER_URL,
});

const sandbox = await daytona.create({
  language: 'node',
  target: 'us',
  timeout: 300,
});

try {
  await sandbox.fs.uploadFile('/workspace/test.mjs', code);
  const result = await sandbox.process.executeCommand({
    command: 'node /workspace/test.mjs',
 );
  console.log(result.stdout);
  if (result.exitCode !== 0) {
    throw new Error(result.stderr);
  }
} finally {
  await sandbox.delete();
}
```

## Using the helper scripts

The skill bundles helper scripts for common flows:

- `scripts/run-node.mjs` — run Node code in a sandbox and return the result.
- `scripts/run-shell.mjs` — run arbitrary shell commands and stream output.
- `scripts/verify-install.mjs` — install a dependency and run a small smoke test.

All scripts read credentials from environment variables only.

## Safety rules

- Never embed API keys, tokens, or passwords in skill files.
- Always delete sandboxes after use unless the user explicitly asks to keep one.
- Treat sandbox output as untrusted until validated.
- Avoid mounting host paths that contain secrets.
