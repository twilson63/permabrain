# Phase 1 Plan — Flat PermaBrain

## Objective

Build a working PermaBrain CLI and pi skill that stores agent memory pages as signed ANS-104 DataItems, queryable by GraphQL tags, using local HyperBEAM where possible.

## Non-goals

- No AO process yet.
- No custom HyperBEAM device yet.
- No semantic/vector search in the MVP.
- No complex multi-agent key rotation in the MVP.

## MVP Commands

```sh
permabrain init
permabrain put <file> --topic <topic> --slug <slug>
permabrain query [--topic <topic>] [--slug <slug>] [--json]
permabrain get <topic>/<slug>
permabrain sync
```

## Implementation Order

1. Project scaffold and CLI entrypoint
2. Config loading/writing
3. Key/wallet handling
4. Tag schema encode/decode/validation
5. ANS-104 DataItem creation and signing
6. HyperBEAM upload/query/fetch adapter
7. `init`
8. `put` unencrypted
9. `query`
10. `get`
11. `sync` local index/cache
12. Local symmetric encryption
13. Recipient encryption
14. `relate` and `inbox`
15. pi skill wrapper

## End-to-end Test

1. Start local HyperBEAM node from `~/code/hyperbeam`.
2. Configure PermaBrain to point to local HyperBEAM gateway/GraphQL/upload endpoints.
3. Run `permabrain init`.
4. Put a markdown page.
5. Query by tags.
6. Fetch by ID and by `topic/slug`.
7. Update same page and verify version chain.
8. Run sync and verify local cache index.

## Success Criteria

- A page can be uploaded to local HyperBEAM as a signed DataItem.
- The page is queryable by `App-Name=PermaBrain` and `Brain-Key=<topic>/<slug>`.
- The page content can be fetched and displayed.
- Version tags link new writes to previous writes.
- `sync` builds a local latest-version index.
