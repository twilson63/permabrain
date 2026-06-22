import { Daytona } from '@daytona/sdk';
const daytona = new Daytona();
const sb = await daytona.get('b8625c83-5123-4265-93e6-b80894973f20');
try { await sb.start(); } catch {}

const cmd = `
echo "=== reference@1.0 GET with Accept JSON ===";
curl -s -H 'Accept: application/json' -o /tmp/body -w "status=%{http_code} ct=%{content_type}\\n" http://localhost:8734/~reference@1.0
head -c 300 /tmp/body; echo
echo "=== reference@1.0 POST create ===";
curl -s -H 'Accept: application/json' -H 'Content-Type: application/json' -X POST -d '{"key":"value"}' -o /tmp/body -w "status=%{http_code} ct=%{content_type}\\n" http://localhost:8734/~reference@1.0
head -c 300 /tmp/body; echo
echo "=== bundler OPTIONS ===";
curl -s -H 'Accept: application/json' -o /tmp/body -w "status=%{http_code} ct=%{content_type}\\n" -X OPTIONS "http://localhost:8734/~bundler@1.0/tx?codec-device=ans104@1.0"
head -c 300 /tmp/body; echo
echo "=== query ===";
curl -s -H 'Accept: application/json' -o /tmp/body -w "status=%{http_code} ct=%{content_type}\\n" "http://localhost:8734/~query@1.0?App-Name=PermaBrain&return=boolean"
head -c 300 /tmp/body; echo
echo "=== match ===";
curl -s -H 'Accept: application/json' -o /tmp/body -w "status=%{http_code} ct=%{content_type}\\n" "http://localhost:8734/~match@1.0/App-Name=PermaBrain"
head -c 300 /tmp/body; echo
`;
const r = await sb.process.executeCommand(cmd, undefined, undefined, 60);
console.log(r.result);
