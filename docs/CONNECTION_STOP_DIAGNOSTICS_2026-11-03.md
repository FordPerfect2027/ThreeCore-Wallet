# Connection-stop diagnostics — November 3, 2026

Source: `856f670e2e813a828214dc8cffa47ba53e8222f7`, based on
`aa76dc3f075a88a52ec31798aab753ce93024f59`.

## Problem and resulting behavior

The current card shows a generic message when its wallet account or network
changes. A later idle/protection stop replaces that message. Previously the
page-local protection journal retained the idle stop but not the wallet event,
making those causes difficult to distinguish during actual acceptance work.

After closing the affected card's access, the controller now reports one of
three fixed reasons to the existing protection journal:

- `wallet-account`: account information changed or could no longer be checked.
- `wallet-network`: network information changed or could no longer be checked.
- `wallet-unavailable`: the provider connection could no longer be checked.
  This includes the existing event-rate protection; it does not assert that
  MetaMask emitted a particular disconnect message.

Unchanged account/network events, explicit disconnect and idle stops do not
produce wallet-change entries. Stale callbacks cannot add duplicate entries.
The journal contains only fixed reasons, sequence numbers and existing policy
settings, with at most 64 detailed entries. It contains no account addresses,
balances or provider payloads. Three connected cards can produce three entries
from one shared-provider event; counts describe affected card connections.

The journal survives later protection/resume actions in the same loaded page.
It is not persistent across reloads and is not an independent audit. Its export
version is now 2 because the allowed event/count vocabulary changed. There is
no protection-journal import path. Existing Wallet/history backup formats are
unchanged. No RPC method, permission scope, timeout or reconnect policy changed.

## Verification

| Check | Result |
| --- | --- |
| Controller, journal and protection cases | 207 passed; no failures, cancellations or skips |
| Provider-event, observer and callback regression | 246 passed; no failures, cancellations or skips |
| Complete synthetic browser suite | 1,024 passed in two fresh isolated profiles: 512 + 512; 261 local modules passed preflight |

The checks cover bounded reason-only reporting, unchanged/stale events, observer
failure and attempted reentrant reconnect, history preservation, and separate
recording of wallet invalidation followed by manual/idle protection. The shared
provider acceptance case verifies all three cards stop, late results are ignored,
saved token histories remain, and reconnect remains explicit.

The browser suite uses synthetic providers with no real extensions or external
RPC. These 1,477 passing checks do not constitute a live MetaMask switch pass.
The prior complete Node/HTTP regression remains pinned to `2126019`; this change
received the two targeted Node groups and the complete browser suite above.

[Source-file hashes and receipt](evidence/2026-11-03-connection-diagnostics/summary.json)
and [raw-log manifest](evidence/2026-11-03-connection-diagnostics/SHA256SUMS.txt)
are saved locally. From the repository root:

```powershell
node scripts/verify-evidence-manifest.js docs/evidence/2026-11-03-connection-diagnostics/SHA256SUMS.txt
```

## Actual browser follow-up

Before the operator's reply, the original loaded page had three Account 2 /
Base Sepolia connections and six saved history records, then visibly stopped
because of inactivity. The operator subsequently reported selecting Account 1.
The next observation timed out; rebinding the same tab reported an unattached
debugger, and the bounded DOM read also timed out. No post-switch account
response was observed. Therefore live account/chain invalidation remains open.

The old page was neither reloaded nor claimed to be running this new module.
Both existing servers were preserved: 4231/PID 2108 and 4232/PID 28252, with
their original start times. The prior fixed review ZIP is unchanged and does
not include this new implementation. GitHub publication remains deferred.
The 90% planning target is not verified by this diagnostic improvement.
