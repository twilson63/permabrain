import { Daytona } from '@daytona/sdk';
const daytona = new Daytona();
const sb = await daytona.get('b8625c83-5123-4265-93e6-b80894973f20');
try { await sb.start(); } catch {}

const expr = `{ok, Msg} = hb_opts:default_message_with_env(),\n` +
  `StoreSpec = maps:get(<<"preloaded-store">>, Msg, #{}),\n` +
  `StoreMod = maps:get(<<"store-module">>, StoreSpec, hb_store_lmdb),\n` +
  `StoreName = maps:get(<<"name">>, StoreSpec, <<"_build/preloaded-store">>),\n` +
  `{ok, Store} = StoreMod:new(StoreSpec#{<<"name">> => StoreName}),\n` +
  `{ok, Index} = StoreMod:read(Store, maps:get(<<"preloaded-devices-index">>, Msg)),\n` +
  `io:format('keys: ~p~n', [maps:keys(Index)]).`;

const write = await sb.process.executeCommand(`cat > /tmp/list_devices.erl <<'EOF'\n${expr}\nEOF`, undefined, undefined, 30);
console.log('write exit', write.exitCode);
const r = await sb.process.executeCommand('cd /tmp/HyperBEAM/_build/default/rel/hb && ./bin/hb eval "$(cat /tmp/list_devices.erl)" 2>&1 | tail -30', undefined, undefined, 60);
console.log(r.result);
