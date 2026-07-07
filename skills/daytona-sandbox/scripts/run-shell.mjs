import { Daytona } from '@daytona/sdk';

const [, , command, timeout = 300] = process.argv;
if (!command) {
  console.error('Usage: node run-shell.mjs "<command>" [timeout-seconds]');
  process.exit(1);
}

const apiKey = process.env.DAYTONA_API_KEY;
const serverUrl = process.env.DAYTONA_SERVER_URL;
if (!apiKey) {
  throw new Error('DAYTONA_API_KEY is required in environment');
}

const daytona = new Daytona({ apiKey, serverUrl });
const sandbox = await daytona.create({ language: 'node', target: 'us', timeout });

try {
  const result = await sandbox.process.executeCommand({ command });
  process.stdout.write(result.stdout || '');
  process.stderr.write(result.stderr || '');
  process.exit(result.exitCode ?? 0);
} finally {
  await sandbox.delete().catch(() => {});
}
