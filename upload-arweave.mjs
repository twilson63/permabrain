import fs from 'node:fs';
import path from 'node:path';

const BUNDLER_URL = 'https://up.arweave.net';

async function uploadDataItem(itemId, objectsDir) {
  const filePath = path.join(objectsDir, `${itemId}.json`);
  const item = JSON.parse(fs.readFileSync(filePath, 'utf8'));

  if (!item.ans104Base64) {
    throw new Error(`Item ${itemId} has no ANS-104 bytes`);
  }

  const rawBytes = Buffer.from(item.ans104Base64, 'base64url');
  console.log(`Uploading ${itemId} (${rawBytes.length} bytes) to ${BUNDLER_URL}...`);

  const res = await fetch(`${BUNDLER_URL}/tx`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: new Uint8Array(rawBytes)
  });

  const text = await res.text();
  console.log(`  Status: ${res.status}`);
  console.log(`  Response: ${text}`);

  if (res.ok) {
    console.log(`  ✅ Published to Arweave: https://arweave.net/${itemId}`);
  } else {
    console.log(`  ❌ Upload failed`);
  }
  return res;
}

async function main() {
  const args = process.argv.slice(2);
  const ids = args.length > 0 ? args : ['GPHDnqQOdwCX51fkdry8oeeOLkCso27_pIR5WsuEsic', 'F3cZyr68kNmkJy7I9GyaXMohuO_CB1BCeoHHYx22Kfg'];

  const objectsDir = path.resolve('.permabrain/cache/objects');

  for (const id of ids) {
    try {
      await uploadDataItem(id, objectsDir);
    } catch (err) {
      console.error(`Error uploading ${id}: ${err.message}`);
    }
  }
}

main().catch(err => console.error(err));