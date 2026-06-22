import { Daytona } from '@daytona/sdk';
const daytona = new Daytona();
const sb = await daytona.get('b8625c83-5123-4265-93e6-b80894973f20');
try { await sb.start(); } catch {}
const expr = `add_code_paths = fun() ->\n` +
  `    [code:add_patha(filename:join([\u0022_build\u0022, \u0022default\u0022, \u0022lib\u0022, App, \u0022ebin\u0022])) || App <- filelib:wildcard(\u0022_build/default/lib/*\u0022)],\n` +
  `    ok\n` +
  `end,\n` +
  `add_code_paths(),\n` +
  `application:ensure_all_started(crypto),\n` +
  `application:ensure_all_started(asn1),\n` +
  `application:ensure_all_started(public_key),\n` +
  `{ok, Bin} = file:read_file(\u0022src/preloaded/arweave/dev_bundler.erl\u0022),\n` +
  `Res = compile:forms(erl_scan:string(Bin), [return_errors, {i, \u0022src/core/include\u0022}]),\n` +
  `io:format('~p~n', [Res]).`;
await sb.process.executeCommand(`cat > /tmp/compile_bundler.erl <<'EOF'\n${expr}\nEOF`, undefined, undefined, 30);
const r = await sb.process.executeCommand('cd /tmp/HyperBEAM/_build/default/rel/hb && ./bin/hb eval "$(cat /tmp/compile_bundler.erl)" 2>&1 | tail -20', undefined, undefined, 60);
console.log(r.result);
