import { Daytona } from '@daytona/sdk';
const daytona = new Daytona();
const sb = await daytona.get('b8625c83-5123-4265-93e6-b80894973f20');
try { await sb.start(); } catch {}
const expr = `{ok, Msg} = hb_opts:default_message_with_env(),\n` +
  `Req = #{\n` +
  `    <<"path">> => <<"/~bundler@1.0/tx">>,\n` +
  `    <<"method">> => <<"POST">>,\n` +
  `    <<"headers">> => #{<<"content-type">> => <<"application/octet-stream">>}\n` +
  `},\n` +
  `Res = hb_singleton:from_path(Req, Msg),\n` +
  `io:format('~p~n', [Res]).`;
await sb.process.executeCommand(`cat > /tmp/resolve_bundler.erl <<'EOF'\n${expr}\nEOF`, undefined, undefined, 30);
const r = await sb.process.executeCommand('cd /tmp/HyperBEAM/_build/default/rel/hb && ./bin/hb eval "$(cat /tmp/resolve_bundler.erl)" 2>&1 | tail -20', undefined, undefined, 60);
console.log(r.result);
