# Daytona SDK Reference

This file contains common Daytona SDK patterns for quick reference while using the skill.

## Creating a sandbox

```js
import { Daytona } from '@daytona/sdk';

const daytona = new Daytona({
  apiKey: process.env.DAYTONA_API_KEY,
  serverUrl: process.env.DAYTONA_SERVER_URL,
});

const sandbox = await daytona.create({
  language: 'node', // or 'python'
  target: 'us',
  timeout: 300,
});
```

## Running commands

```js
const result = await sandbox.process.executeCommand({
  command: 'npm test',
});

console.log(result.stdout);
console.log(result.exitCode);
```

## Working with files

```js
await sandbox.fs.uploadFile('/workspace/script.mjs', code);
const files = await sandbox.fs.listFiles('/workspace');
const content = await sandbox.fs.downloadFile('/workspace/result.json');
```

## Cleanup

Always delete sandboxes after use:

```js
await sandbox.delete();
```

For shared inspection, keep the sandbox alive and print its ID:

```js
console.log(sandbox.id);
```
