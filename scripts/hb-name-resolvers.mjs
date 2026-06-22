import { Daytona } from '@daytona/sdk';
const daytona = new Daytona();
const sb = await daytona.get('b8625c83-5123-4265-93e6-b80894973f20');
try { await sb.start(); } catch {}
const expr = `{ok, Msg} = hb_opts:default_message_with_env(), io:format('~p~n', [maps:get(<<\"name-resolvers\">>, Msg, [])]).`;
const r = await sb.process.executeCommand(`cd /tmp/HyperBEAM/_build/default/rel/hb && ./bin/hb eval '${expr}' 2>&1 | tail -20`, undefined, undefined, 60);
console.log(r.result);
