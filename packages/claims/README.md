# @headroom/claims

Versioned claims for shared state written by concurrent agents: compare-and-set, corroboration, conflict detection and idempotent retries, with a change feed. No dependencies and no domain types.

It exists because a runtime where several agent loops write to one shared state object (for example Mozaik's `RuntimeState`) gives no locking, versioning or conflict handling of its own. In a single-threaded JavaScript runtime a function with no `await` inside runs to completion, so every method here is synchronous and therefore atomic.

## API

```ts
import { createClaimStore } from '@headroom/claims';

const board = createClaimStore<number>();
board.onChange((e) => console.info(e.type, e.key, e.status));

board.propose({ key: 'invoice:7:amount', value: 100, by: 'reader-a', idempotencyKey: 'a/7/amount' });
// -> { kind: 'claimed', record }   first claim on the key, status 'proposed'
board.propose({ key: 'invoice:7:amount', value: 100, by: 'reader-b', idempotencyKey: 'b/7/amount' });
// -> { kind: 'corroborated', record }   another participant agrees; added to record.corroborators
board.propose({ key: 'invoice:7:amount', value: 120, by: 'reader-c', idempotencyKey: 'c/7/amount' });
// -> { kind: 'conflict', existing, proposed }   both versions kept, linked by proposed.conflictsWith
```

| Result         | When                                                                                                                  |
| -------------- | --------------------------------------------------------------------------------------------------------------------- |
| `claimed`      | No active claim on the key (first claim, or every earlier version was contested or superseded)                        |
| `corroborated` | Another participant proposes a value equal (by `equals`) to an active claim                                           |
| `conflict`     | A different value while an active claim exists; a new version is stored with status `proposed`                        |
| `stale`        | `expectedVersion` was given and differs from the version `get(key)` returns (0 for an unclaimed key); nothing changes |
| `duplicate`    | The `idempotencyKey` was seen before on this key, or the same participant repeats its own value; nothing changes      |

`setStatus(key, id, status, by, reason?)` moves a record to `verified`, `contested` or `needs_user`. Only one record per key can be `verified`: verifying a version supersedes the previously verified one. `supersede(key, oldId, next)` replaces an active record with a new version (superseding a contested or superseded record is refused). `get(key)` returns the verified record if any, otherwise the highest active version, otherwise the highest version. `versions(key)`, `getById(id)` and `all(filter?)` read the store. Every change is recorded in the record's `history` and sent synchronously to `onChange` listeners after the whole mutation is applied; if listeners throw, the store stays consistent and the call throws a `ListenerError` listing them. Idempotency keys are scoped per claim key.

Options: `createClaimStore({ equals, newId, now })` for value equality (default: structural JSON equality), id generation and the clock (inject both for deterministic tests and replays).

## Guarantees (tested, including a property test over random interleavings)

- No accepted proposal is lost: its value is held by some version of its key.
- At most one `verified` record per key.
- Active records on a key never hold equal values (agreement becomes corroboration).
- Each record's history equals the sequence of change events emitted for it.

## Licence

MIT
