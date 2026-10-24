# Encrypted backup library — local security update

This update adds an optional browser-local library for ThreeCore's existing
passphrase-encrypted workspace backups. Development and verification are local
to this PC. No GitHub publication or production deployment is included.

## User workflow

The new controls appear inside **合言葉付きバックアップ** in the wallet screen.

1. Prepare an encrypted workspace using the existing password and confirmation
   fields. Credentials are cleared before asynchronous encryption starts.
2. Choose **準備した暗号化ファイルの保管を確認**.
3. Review the ciphertext size, acknowledge the operation and explicitly confirm.
4. The UI reports success only after the database transaction completes.
5. After reopening the same browser origin, explicitly load the inventory.
6. Select an entry and hand it to the password input workflow.
7. Enter its original passphrase, then stage the decrypted workspace.
8. Review the existing workspace-change preview before applying any settings.

Selecting an entry does not connect a wallet, decrypt anything, or change the
current workspace. A library does not remember the passphrase.

## What is retained

Each entry has exactly four fields:

| Field | Meaning |
| --- | --- |
| `id` | SHA-256 of the canonical encrypted envelope |
| `savedAt` | Local save time, descriptive metadata only |
| `bytes` | Length of the canonical ASCII envelope |
| `text` | The existing AES-GCM encrypted workspace envelope |

The inventory displays timestamps, ciphertext sizes and short identifiers.
Ciphertext, wallet addresses, balances and passwords are not placed in inventory
DOM or controller notification state. Encryption size and timestamps are not
secret and remain visible in browser storage.

The exact accepted envelope is the existing fixed PBKDF2-SHA-256 / AES-GCM
format. This update does not introduce another cipher, cost parameter, key store
or password-recovery scheme. Secrets are never accepted as entry labels or
free-form metadata. Additional fields are rejected, rather than silently saved.

The library uses a new IndexedDB database:

    threecore-encrypted-backups-v1

It does not open, migrate, replace or erase existing plaintext history,
checkpoint, period-library, report-history or transfer-vault databases.

## Storage isolation and limits

The database is scoped to the browser profile and exact origin. In particular,
`http://127.0.0.1:4199` and `http://127.0.0.1:4200` have separate databases.
Changing a development port does not migrate saved data automatically.

There are at most 10 entries and 24 MiB of canonical ciphertext envelopes.
Individual envelopes retain the existing format's smaller effective limit.
Oversized additions are refused without automatically evicting older entries.
Duplicate ciphertext is retained once; its original timestamp and order remain.

The storage adapter is lazy. Opening the wallet screen does not read or write
the library. Inventory loading, saving, exporting and deletion require explicit
actions. A failed operation is not automatically retried.

Browser storage can be unavailable, full, cleared or evicted. Keep a separate
downloaded backup. A transaction-complete event is not a guarantee against a
later disk failure or browser storage removal.

## Atomic mutations and competing tabs

Save, merge and delete previews retain an immutable expected inventory. At
commit time, the adapter reads the current inventory inside a read/write
transaction and compares both its revision and exact contents to the preview.

This comparison includes identifiers, timestamps, sizes, ciphertext and order.
A content change with an unchanged revision is still a conflict. Conflicting
actions abort and require loading the inventory and reviewing again.

A successful batch import adds every validated new entry in one transaction.
It does not partially import the valid prefix of a damaged archive. The complete
batch is rejected if an entry is malformed, the capacity would be exceeded, or
the expected inventory is stale.

The confirmation ticket is consumed once. Confirmation requires the boolean
acknowledgement and expires after one minute. Clock rollback, delayed operations,
selection changes and cancellation invalidate the review. The deadline is
checked again inside the transaction before a write is queued.

## Cancellation and resource handling

Controller operations have a bounded deadline. Cancellation passes an abort
signal to both file reads and database operations. Late reads and digest results
cannot repopulate an inventory or preview after cancellation or disposal.

The shared IndexedDB adapter now supports cancellable reads and a separate
transaction timeout, in addition to its existing open timeout. A hung queued
read/write transaction is aborted. Completed transactions release their timers
and abort listeners. Closing or a database version change releases the handle.

Page hiding, page exit, the existing protection stop and secure-panel
invalidation clear the displayed inventory and pending library operations.
The stored encrypted entries remain in the database.

Validated objects are immutable snapshots. A module-private WeakSet recognizes
only snapshots constructed by the validator, avoiding repeated large JSON
parses. Caller-frozen objects and values copied back from IndexedDB are still
fully checked. Weak references do not retain canceled ciphertext snapshots.

This is not a JavaScript sandbox against malicious code already executing in
the page or a compromised browser extension. Synchronous parsing is bounded but
is not interruptible in the middle of a native JavaScript task.

## Portable whole-library archive

**保管箱全体の暗号化ファイルを準備** prepares a download containing all encrypted
entries. A separate download action is required. The filename is:

    ThreeCore-encrypted-library.json

The archive has its own versioned schema and a 32 MiB file-read bound. Its
outer metadata is readable; each workspace payload remains encrypted with the
passphrase used when that individual backup was created.

The import file picker accepts one file. File reads check declared and actual
size, valid UTF-8, cancellation and deadlines. The JSON scanner refuses duplicate
keys, forbidden prototype-related names, unknown fields and excessive structure.
Every entry's envelope and digest are checked before a merge preview is shown.

The preview reports additions, duplicates, added bytes and resulting count.
Import only adds absent entries. Existing entries are not overwritten, renamed
or deleted. An empty archive therefore cannot clear a destination library.

For an offline, read-only structural check:

    node scripts/check-encrypted-library.js path/to/ThreeCore-encrypted-library.json

The command never asks for a password, decrypts, imports or changes the input.
It prints counts and flags, without echoing ciphertext, account information or
the supplied file path. Failure returns a nonzero status and a static code.
This check cannot prove knowledge of the passphrase or authenticate a workspace.

## Integrity versus authentication

The inventory digest detects accidental local corruption and unchanged-ID
modification. It is not a signature. Someone able to replace both an envelope
and its digest can make a different structurally valid entry.

The existing AES-GCM authentication is still required when the user enters a
passphrase. The browser tests deliberately replace ciphertext and recompute its
digest: inventory validation succeeds, but password decryption rejects the
modified payload before it can be staged for restoration.

Timestamps, revisions, digests and local history do not prove authorship,
current balances, token authenticity or account ownership.

## Deletion scope

Deletion has a preview naming exactly one entry and requires a new confirmation.
It does not remove downloaded files, other databases, other origins, wallet
permissions, extension accounts or blockchain assets. Deletion does not promise
physical secure erasure from disk, OS backups or browser caches.

## Verification strategy

Unit tests cover strict schema and resource bounds, mutation conservation,
duplicate handling, snapshot isolation, concurrency, review expiration, aborts,
timeouts, native error mapping, DOM cleanup, archive transfer and offline checks.

Controlled IndexedDB requests exercise quota errors, blocked opens, queued
transactions, late events and cancellation. Separate browser tests use actual
IndexedDB, File/DataTransfer and Web Crypto; they do not consult a real wallet.
Synthetic accounts are used for encryption/restore checks.

HTTP tests check the explicit module allowlist and the existing same-origin,
no-store, CSP, framing and MIME protections. There are no server endpoints for
library data, password processing or import/export uploads.

Run the unit and HTTP suites from this repository root:

    node --test --test-timeout=60000 --test-concurrency=2 test/*.test.js
    node --test --test-timeout=60000 --test-concurrency=2 integration/*server.test.mjs

For actual browser tests, start the local server with `--ui-test` and open
`/test/browser/`. The focused route is `/test/browser/?suite=encrypted-library`.
Final counts, logs, source backups and line statistics are recorded in the
sibling `wallet-encrypted-library-verification-20261024` directory.

The work is local engineering verification, not an independent security audit.

Implementation references:

- [IndexedDB transactions](https://developer.mozilla.org/en-US/docs/Web/API/IDBTransaction)
- [Database version changes](https://developer.mozilla.org/en-US/docs/Web/API/IDBDatabase/versionchange_event)
