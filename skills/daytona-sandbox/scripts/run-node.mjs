import { Daytona } from '@daytona/sdk';
import fs from 'node:fs/promises';

const [, , filePath, timeout = 300] = process.argv;
if (!filePath) {
  console.error('Usage: node run-node.mjs <path-to-js-file> [timeout-seconds]');
  process.exit(1);
}

const apiKey = process.env.DAYTONA_API_KEY;
const serverUrl = process.env.DAYTONA_SERVER_URL;
if (!apiKey) {
  throw new Error('DAYTONA_API_KEY is required in environment');
}

const code = await fs.readFile(filePath, 'utf8');
const daytona = new Daytona({ apiKey, serverUrl });
const sandbox = await daytona.create({ language: 'node', target: 'us', timeout });

try {
  const remotePath = '/workspace/' + filePath.split('/').pop();
  await sandbox.fs.uploadFile(remotePath, code);
  const result = await sandbox.process.executeCommand({
    command: `node ${remotePath}`,
  });
  process.stdout.write(result.stdout || '');
  process.stderr.write(result.stderr || '');
  process.exit(result.exitCode ?? 0);
} finally {
  await sandbox.delete().catch(() => {});
}
