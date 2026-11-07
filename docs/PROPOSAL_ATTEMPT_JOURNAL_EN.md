# Durable proposal-attempt journal

Implementation: `server/proposal-attempt-journal.mjs`.
Integration: optional host-owned `attemptJournal` in `createAgentProposalService`.

This extends the proposal-delivery boundary with committed attempt records that
survive service recreation and process exit. It does not enable a live model,
replace wallet history, save the user's open browser page, or authorize spending.
The normal demo still does not mount a model endpoint or expose server files.

## What is persisted

One SQLite file contains a fixed schema version, deployment scope, total attempt
limit and last accepted clock time. Each attempt contains its agent, hashed
request identity, fingerprint, random reservation credential, timestamps and
local outcome (`reserved`, `completed`, or `failed`).

Objectives, API keys, browser capability tokens, wallet addresses, model text
and observation records are not stored in plaintext in this journal. Fingerprints
are SHA-256 digests of the bound context/objective, not encryption or evidence
that a low-entropy value cannot be guessed. The host scope is stored as supplied;
it must be a non-secret identifier.

The request key binds agent plus request ID. Its fingerprint additionally binds
the host-owned policy/session snapshot and objective. Reuse under changed scope
or objective is a conflict, not permission for a new attempt. The host/client
must retain a stable request ID for the same business request: inventing another
ID does not make it a duplicate, although the global attempt cap still applies.

## Commit before external processing

`reserve()` uses a SQLite `BEGIN IMMEDIATE` transaction. It checks the existing
request and total count, records one reservation, and commits before returning.
Only then can the service call its proposal adapter. Concurrent processes sharing
the same file cannot both reserve the same request or exceed the fixed global
attempt count. All three agents share this count.

An already recorded request returns only its known local outcome, never the
original reservation credential. It does not run again. An in-memory successful
response remains available to the same live service; after restart, the service
returns `PREVIOUS_ATTEMPT_RECORDED` rather than recreating a lost response through
another potentially billable request. No model output is persisted or replayed.

`settle()` is idempotent for the same reservation and terminal outcome. A caller
cannot change a terminal outcome or settle another request. `completed` means
the proposal was generated and validated before the completion record was saved;
it does **not** prove delivery, current eligibility, wallet execution or provider
billing. Eligibility is checked again after the write before responding.

Cancellation, timeout and failure do not refund the attempt. A storage failure
after generation returns an error, never a false success. A committed reservation
left behind by a process exit remains consumed and cannot automatically retry.
Missing/corrupt/locked/unavailable storage fails closed before model invocation.

## Opening and protecting the file

- Creation requires explicit host `create: true` and exclusive `wx` creation.
  Existing files are never replaced. Ordinary open never recreates a missing
  file. A failed initial setup may leave a file that requires inspection.
- Reopen requires the same deployment scope and attempt limit. There is no quota
  reset, increase, pruning, refund or automatic repair API.
- Initial adapter requires an absolute `.sqlite` path in an existing canonical,
  owner-private POSIX directory. The file must be owner-private, regular and
  single-linked; symlinks, broad permissions and files over 4 MiB are rejected.
- Device/inode changes are rejected before subsequent transactions. Schema,
  metadata, row structure and `quick_check` are checked at open under a consistent
  snapshot. An unrelated database/configuration is rejected before changing its
  persistent journal settings. Normal SQLite hot-journal recovery may occur when
  opening a recognized storage file; no application reset is performed.
- SQLite uses rollback-journal mode and `synchronous=EXTRA`. Lock waits are bounded
  to 250 ms; the synchronous SQLite operations run on the host event loop, so this
  is suitable for this bounded prototype, not a high-throughput deployment claim.

The host OS account and configured directory are trusted. This does not defend
against that account or root modifying/deleting the database, restoring an old
backup, changing scope/file paths, or bypassing the service. Filesystem flush and
locking behavior remain platform assumptions. Power-loss, disk-full, network
filesystem and hardware corruption behavior have not been independently tested.
Do not copy a live SQLite file without a consistent backup procedure.

## Runtime and operational boundary

Tested here with Node 24.22.1 and its built-in SQLite 3.53.4. No external package
was installed. This adapter requires Node >=24.15 with `node:sqlite`. It exposes
a runtime/platform support check and dynamically loads the optional built-in;
import alone does not break the existing read-only code on older Node runtimes.
Opening fails with an explicit code when unsupported, before filesystem access.
It is server-only and is not imported by browser code. Windows ACL validation is
not implemented: unsupported platform checks fail explicitly, rather than
pretending POSIX mode bits establish Windows privacy. This addition is not a
Windows-PC installation or a change to the already open ThreeCore page.

The fixed limit counts attempts, **not currency**. Monetary budgeting, approved
model pricing, input/output/reasoning cost limits, provider usage reconciliation,
and authenticated capability bootstrap remain separate deployment requirements.
Enabling a live service without a journal preserves only its older in-memory
limits; that mode must not be represented as restart-safe.

## Verification

```sh
node --test test/proposal-attempt-journal.test.js test/agent-proposal-service.test.js
node --test integration/agent-proposal-server.test.mjs
```

Tests cover two real child processes racing for one request and for the last
global slot; abrupt process exit after a committed reservation; reopened services;
all three agents; both chain IDs; wrong file/configuration; storage locks; corrupt
files; guessed reservation credentials; clock rollback; failing/async storage;
and expiry during settlement. Synthetic provider/model data remains clearly
separate from real-chain or live-API evidence.

Primary implementation references checked 2026-11-07 JST:

- [Node 24 SQLite API](https://nodejs.org/download/release/v24.15.0/docs/api/sqlite.html)
- [SQLite atomic commit and its storage assumptions](https://www.sqlite.org/atomiccommit.html)

The latest-v24 documentation URL initially failed retrieval. The versioned
official Node reference above was available; no third-party API description was
used as the implementation authority.
