/**
 * Test: Template-driven article creation
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  renderTemplate,
  parseFrontmatter,
  serializeFrontmatter,
  buildArticleTags,
  createArticleFromTemplate,
} from '../src/template.mjs';
import { api } from '../src/index.mjs';
import { deriveKey } from '../src/tags.mjs';
import * as pbcrypto from '../src/crypto.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-template-'));
process.env.PERMABRAIN_HOME = tmp;

await api.init({ keyType: 'ed25519', transport: 'local' });

// --- 1. parseFrontmatter handles YAML frontmatter ---
console.log('1. parseFrontmatter handles YAML frontmatter');
const parsed = parseFrontmatter('---\ntitle: Hello\ntopic: ai\nkind: subject\n---\nBody text');
assert.deepEqual(parsed.frontmatter, { title: 'Hello', topic: 'ai', kind: 'subject' });
assert.equal(parsed.body, 'Body text');
console.log('   ✓ Frontmatter parsed');

// --- 2. parseFrontmatter returns body only when no frontmatter ---
console.log('2. parseFrontmatter returns body only when no frontmatter');
const noFm = parseFrontmatter('Just body');
assert.deepEqual(noFm.frontmatter, {});
assert.equal(noFm.body, 'Just body');
console.log('   ✓ No-frontmatter case handled');

// --- 3. serializeFrontmatter round-trips ---
console.log('3. serializeFrontmatter round-trips');
const serialized = serializeFrontmatter({ title: 'T' }, 'body');
const reparsed = parseFrontmatter(serialized);
assert.equal(reparsed.frontmatter.title, 'T');
assert.equal(reparsed.body, 'body');
console.log('   ✓ Frontmatter serialization round-trips');

// --- 4. renderTemplate substitutes variables ---
console.log('4. renderTemplate substitutes variables');
const rendered = renderTemplate('# {{title}}\n\n{{name}} is {{age}} years old.', { name: 'Alice', age: 42 });
assert.equal(rendered.rendered, '# {{title}}\n\nAlice is 42 years old.');
assert.equal(rendered.variables.name, 'Alice');
console.log('   ✓ Template variables substituted');

// --- 5. renderTemplate uses frontmatter defaults ---
console.log('5. renderTemplate uses frontmatter defaults');
const withFm = renderTemplate('---\ntitle: Front\n---\n# {{title}}\n\n{{extra}}', { extra: 'X' });
assert.equal(withFm.rendered, '---\ntitle: Front\n---\n# Front\n\nX');
assert.equal(withFm.frontmatter.title, 'Front');
console.log('   ✓ Frontmatter variables used as defaults');

// --- 6. renderTemplate preserves unknown placeholders ---
console.log('6. renderTemplate preserves unknown placeholders');
const missing = renderTemplate('{{known}} {{unknown}}', { known: 'yes' });
assert.equal(missing.rendered, 'yes {{unknown}}');
console.log('   ✓ Unknown placeholders preserved');

// --- 7. buildArticleTags derives tags from frontmatter and options ---
console.log('7. buildArticleTags derives tags from frontmatter and options');
const tags = buildArticleTags({ title: 'Note', topic: 'tech', kind: 'subject', app: 'TestApp' }, { author: 'me' });
assert.equal(tags.Title, 'Note');
assert.equal(tags.Topic, 'tech');
assert.equal(tags.Kind, 'subject');
assert.equal(tags.App, 'TestApp');
assert.equal(tags.Author, 'me');
console.log('   ✓ Article tags built');

// --- 8. createArticleFromTemplate publishes from inline source ---
console.log('8. createArticleFromTemplate publishes from inline source');
const result = await createArticleFromTemplate(null, {
  home: tmp,
  source: '# {{title}}\n\nContent here.',
  variables: { title: 'Inline Template' },
  topic: 'test',
  kind: 'subject',
  sourceUrl: 'template://inline',
  publishOptions: { useHyperbeam: false },
});
assert.ok(result.key, 'result has key');
assert.equal(result.key, 'subject/inline-template');
// assert.equal(result.summary?.key || result.key, 'subject/inline-template');
assert.ok(result.item, 'result has item');
assert.equal(result.encrypted, false);
console.log('   ✓ Published article from inline template');

// --- 9. Template file path publishing ---
console.log('9. Template file path publishing');
const templateFile = path.join(tmp, 'tmpl.md');
fs.writeFileSync(templateFile, '---\ntitle: File Template\ntopic: file-test\nkind: subject\n---\n{{greeting}} world.\n');
const fileResult = await createArticleFromTemplate(templateFile, {
  home: tmp,
  variables: { greeting: 'Hello' },
  publishOptions: { useHyperbeam: false },
});
assert.ok(fileResult.key);
assert.equal(fileResult.encrypted, false);
console.log('   ✓ Published article from template file');

// --- 10. Encryption path ---
console.log('10. Encryption path');
const recipient = api.generateEncryptionKeypair();
const encResult = await createArticleFromTemplate(null, {
  home: tmp,
  source: '---\ntitle: Secret Template\nkind: subject\ntopic: secrets\n---\n{{msg}}',
  variables: { msg: 'shh' },
  encrypt: true,
  recipients: [recipient.publicKey],
  publishOptions: { useHyperbeam: false },
});
assert.equal(encResult.encrypted, true);
assert.ok(encResult.envelope, 'has encryption envelope');
assert.ok(encResult.recipients.includes(recipient.publicKey), 'recipients include provided key');
const authorKeypair = pbcrypto.deriveEncryptionKeyFromEd25519(Buffer.from(api._identity.secretKey, 'base64url').subarray(0, 32));
const decrypted = await pbcrypto.decrypt(encResult.envelope, Buffer.from(authorKeypair.seed, 'base64url'));
assert.ok(decrypted.content.includes('shh'), 'author can decrypt');
console.log('   ✓ Encrypted template article published and decryptable');

// --- 11. api.template wrapper validates input ---
console.log('11. api.template wrapper validates input');
try {
  await api.template({});
  assert.fail('should throw for missing file/source');
} catch (e) {
  assert.match(e.message, /file or source is required/);
}
console.log('   ✓ api.template validates input');

// --- 12. api.template publishes via wrapper ---
console.log('12. api.template publishes via wrapper');
const apiResult = await api.template({
  source: '---\ntitle: API Template\nkind: subject\ntopic: api\n---\n{{body}}',
  variables: { body: 'via api' },
});
assert.ok(apiResult.key);
assert.equal(apiResult.encrypted, false);
console.log('   ✓ api.template publishes article');

// Cleanup
fs.rmSync(tmp, { recursive: true, force: true });

console.log('\n✅ All template tests passed');
