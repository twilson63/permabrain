import assert from 'node:assert';
import { getEventBus, emitEvent, subscribeEvents } from '../src/events.mjs';

console.log('1. getEventBus returns a singleton EventEmitter');
const bus1 = getEventBus();
const bus2 = getEventBus();
assert.strictEqual(bus1, bus2, 'same singleton emitter');
console.log('   ✓ singleton event bus');

console.log('2. emitEvent broadcasts on the bus');
const received = [];
const handler = (e) => received.push(e);
bus1.on('event', handler);
const ev = emitEvent('publish', { key: 'subject/demo', id: 'tx-123' });
assert.equal(ev.name, 'publish');
assert.equal(ev.key, 'subject/demo');
assert.ok(ev.timestamp);
assert.equal(received.length, 1);
assert.equal(received[0].name, 'publish');
bus1.off('event', handler);
console.log('   ✓ emitEvent works');

console.log('3. subscribeEvents yields matching events');
const sub = subscribeEvents({ events: ['attest', 'fork'] });
const collected = [];
const reader = (async () => {
  for await (const e of sub) {
    collected.push(e);
    if (collected.length >= 2) break;
  }
})();
emitEvent('attest', { key: 'subject/a' });
emitEvent('publish', { key: 'subject/b' }); // should be filtered out
emitEvent('fork', { key: 'subject/c' });
await reader;
assert.equal(collected.length, 2);
assert.equal(collected[0].name, 'attest');
assert.equal(collected[1].name, 'fork');
sub.cancel();
console.log('   ✓ filtered subscription works');

console.log('4. subscribeEvents can be cancelled');
const sub2 = subscribeEvents({});
let count = 0;
const p = (async () => {
  for await (const e of sub2) {
    count++;
    if (e.type === 'heartbeat') break;
  }
})();
sub2.cancel();
await p;
assert.ok(count >= 0, 'subscription ends cleanly');
console.log('   ✓ cancellation works');

console.log('\n✅ All events tests passed');
