# HyperBEAM Quickstart

This is the shortest useful path for testing PermaBrain against a local HyperBEAM node.

## 1. Start HyperBEAM

From your HyperBEAM checkout:

```sh
HB_PORT=10000 rebar3 shell
```

Optional isolated store:

```sh
HB_STORE=permabrain-local HB_PORT=10000 rebar3 shell
```

PermaBrain assumes these local endpoints unless you override them:

```text
Gateway:  http://localhost:10000
GraphQL:  http://localhost:10000/graphql
Upload:   http://localhost:10000/~bundler@1.0/tx?codec-device=ans104@1.0
```

## 2. Initialize PermaBrain

From this repo:

```sh
npm install
permabrain init
permabrain probe-hyperbeam --url http://localhost:10000
```

A healthy probe should show:

```text
ok health 200
ok graphql 200
ok upload 204
```

The missing-id fetch check may return `404`. That is fine; it proves the gateway responds.

## 3. Publish an article

```sh
permabrain import-wikipedia "Ada Lovelace" --kind person --topic computing
```

Or publish a local markdown file:

```sh
cat > /tmp/ada.md <<'EOF'
# Ada Lovelace

Ada Lovelace wrote notes on Charles Babbage's Analytical Engine and is often described as the first computer programmer.
EOF

permabrain publish /tmp/ada.md \
  --kind person \
  --topic computing \
  --title "Ada Lovelace" \
  --source-url "https://en.wikipedia.org/wiki/Ada_Lovelace"
```

## 4. Query and fetch it

```sh
permabrain query --topic computing
permabrain get person/ada-lovelace
```

`get` verifies the content hash before printing the article. If the gateway returns raw ANS-104 bytes, PermaBrain parses the DataItem and extracts the payload before checking the hash.

## 5. Add an attestation

```sh
permabrain attest person/ada-lovelace \
  --valid \
  --confidence 0.95 \
  --reason "Source-backed Wikipedia import"
```

Then compute consensus:

```sh
permabrain consensus person/ada-lovelace
```

## 6. Sync local cache

```sh
permabrain sync
```

PermaBrain queries HyperBEAM by tags and merges those results with the local cache. This matters because local GraphQL indexing can lag or return partial results.

## Local test transport

If you want zero network dependency, use the local transport:

```sh
export PERMABRAIN_TRANSPORT=local
export PERMABRAIN_HOME=/tmp/permabrain-local

permabrain init
permabrain import-wikipedia "Ada Lovelace" --kind person --topic computing
permabrain query --topic computing
permabrain get person/ada-lovelace
```

The local transport writes signed DataItem JSON envelopes under `$PERMABRAIN_HOME/cache/objects`. Public upload paths still use serialized ANS-104 bytes.

## Troubleshooting

### Probe cannot reach HyperBEAM

Check that HyperBEAM is running on the same port:

```sh
curl -i http://localhost:10000
```

If you use a different port:

```sh
permabrain probe-hyperbeam --url http://localhost:10001
```

Or set:

```sh
export PERMABRAIN_HYPERBEAM_URL=http://localhost:10001
```

### Upload route fails

The expected route is:

```text
/~bundler@1.0/tx?codec-device=ans104@1.0
```

Override it if your HyperBEAM build exposes a different route:

```sh
export PERMABRAIN_UPLOAD_URL='http://localhost:10000/custom/upload/path'
```

### GraphQL returns fewer rows than expected

PermaBrain paginates GraphQL results, but the local HyperBEAM index may lag. Run:

```sh
permabrain sync
permabrain query --topic computing
```

The CLI also merges local cache entries with remote query results, so recently published local items should still show up.

### Do not accidentally publish secrets

Public upload is permanent. Do not publish private keys, secrets, private notes, customer data, or anything you would not want mirrored forever. Yes, forever means forever. Annoying word, accurate concept.
