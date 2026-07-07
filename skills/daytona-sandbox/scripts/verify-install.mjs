import { Daytona } from '@daytona/sdk';

const [, , packageName, testCommand, timeout = 300] = process.argv;
if (!packageName || !testCommand) {
  console.error('Usage: node verify-install.mjs <package> "<test-command>" [timeout-seconds]');
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
  const install = await sandbox.process.executeCommand({
    command: `npm install ${packageName}`,
  });
  if (install.exitCode !== 0) {
    process.stderr.write(install.stderr || '');
    process.exit(install.exitCode ?? 1);
  }
  const result = await sandbox.process.executeCommand({ command: testCommand });
  process.stdout.write(result.stdout || '');
  process.stderr.write(result.stderr || '');
  process.exit(result.exitCode ?? 0);
} finally {
  await sandbox.delete().catch(() => {});
}
