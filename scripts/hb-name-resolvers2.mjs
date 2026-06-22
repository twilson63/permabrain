import { Daytona } from '@daytona/sdk';
const daytona = new Daytona();
const sb = await daytona.get('b8625c83-5123-4265-93e6-b80894973f20');
try { await sb.start(); } catch {}
const expr = `{ok, Msg} = hb_opts:default_message_with_env(),\n` +
  `Resolvers = maps:get(\u003c\u003c"name-resolvers"\u003e\u003e, Msg, []),\n` +
  `io:format('~p~n', [Resolvers]).`;
await sb.process.executeCommand(`cat \u003e /tmp/resolvers.erl \u003c\u003c'EOF'\n${expr}\nEOF`, undefined, undefined, 30);
const r = await sb.process.executeCommand('cd /tmp/HyperBEAM/_build/default/rel/hb && ./bin/hb eval "$(cat /tmp/resolvers.erl)" 2>&1 | tail -20', undefined, undefined, 60);
console.log(r.result);
