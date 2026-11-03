# Fresh proposal-state review — November 3, 2026

`/proposals/state/` completes the next link after proposal, quote, allowance and
fee review: a saved fixed proposal can be checked against a newly selected Base
block. Users can import the source, explicitly acquire public information,
save the result, reopen it and recheck its age without a Wallet connection.
The fee screen links to this screen without replacing the existing page.

## Completed behavior

- The reader selects the public head once and pins code, token balance,
  allowance, native balance, fee-oracle reads and optional simulation to that
  canonical block hash. It rechecks both the new and original headers and the
  chain before saving. Later advancing blocks are not represented as checked.
- Source bytes, recipient, input amount, route, minimum output, deadline, gas
  and fee caps remain unchanged. The source is replayed at its recorded time
  and re-evaluated at completion. Expiry during RPC prevents a passing result.
- Expired or previously blocked sources still support read-only diagnostics.
  They cannot become eligible just because balances later change. No swap
  simulation runs if preconditions fail. RPC simulation/estimate rejection is
  saved as a blocked result; malformed output or a changed canonical head is
  a read error rather than false evidence.
- The same original call may have different output at the new block, but it
  must retain the exact input and meet the original minimum output. No nonce,
  signature, transaction broadcast, new approval or state override is used.
- Affordability preserves token reserves/floors, every same-asset spend in a
  shared budget, and every plan's full ETH budget. The current proposal uses
  the larger of its original reserved fee budget and the new full-gas-limit
  fee ceiling. Other agents' token balances are not newly verified; the scope
  is this proposal with shared ETH/USDC reservations, not all plans' execution.
- Unknown L1/operator costs remain unknown. Oracle upper bounds are practical
  provider estimates, not a guarantee of future costs. Observations/header
  timestamps have a fixed 60-second freshness window, which never extends
  any original expiry.
- The existing bounded local HTTP handler is reused with the state reader.
  Same-origin JSON, 512 KiB source input, two concurrent requests, body/read
  deadlines, strict encoding and cancellation apply. The reader is server-only.
- Saved archives contain the complete original plan, observation, evaluation
  time and result. Offline inspection recomputes the result. Imported claims
  and timestamps are not authenticated; a passing comparison grants no
  execution authority. The screen distinguishes saved-time and new checks.

## Validation

The final related model/CLI/HTTP/UI regression run passed **183 tests**. The
ordinary server regression passed **2 tests** separately. The earlier 55-test
focused run overlaps and is not added to those totals. Coverage includes all
three USDC buy routes, DAT sell, shared reservations, allowance removal,
missing code, fee caps/unknown costs, changed output, RPC rejection, gas caps,
source/new-block reorg, network changes, source forgery, recorded-result
tampering, expiry during reads, cancellation, 512 KiB envelope round trips,
and delayed browser results after replacement/navigation.

Actual public Account 2 diagnostics were saved at block **53,463,194**, hash
`0x24cfbd3667d48c7420bc44194995c10826136ce1778376ce389a351ec52d2129`.
The 16 recorded RPCs read USDC balance 0, allowance 0 and **0.0007 ETH**.
The original EMA-buy example was expired and its reserve-inclusive requirement
was 3 USDC / 0.00304 ETH. It correctly remained blocked with no swap simulation.

Actual browser operation on port **4260** acquired a second public snapshot at
block **53,463,239**. It downloaded a 29,528-byte record, reopened it and
reexported identical bytes:
`f53ba1a4911c326520024497dafdce4a3e5e2ed410689c6b58cf0647070732d2`.
A later local-time check added the stale reason, preserved the source and
observation, and saved a separate 29,549-byte record. Both were replayed on disk.
The real public run is a blocked diagnostic; successful swaps in these new
reader tests use a controlled RPC fixture, not a funded public account.

Evidence, trace, screenshot, test logs and checksums are in
[`evidence/2026-11-03-proposal-current-state/`](evidence/2026-11-03-proposal-current-state/).
The raw saved files can be opened in the screen or checked without network:

```text
node scripts/read-proposal-state.js verify docs/evidence/2026-11-03-proposal-current-state/browser-review.json
```

Exit 2 means a structurally verified blocked result; exit 1 means validation
or acquisition failed. `read PLAN_FILE` explicitly makes new public reads and
prints a complete archive. Capture scripts use exclusive creation to protect
the sealed evidence. They are records of this capture, not overwrite commands.

## Remaining whole-project work

Policy-author authentication, persistent replay prevention, final public
contract/source/permission configuration, product transaction execution and
deferred product AI integration remain open. This check does not reserve funds
on chain or prevent another application spending them afterward. It is not a
public-chain swap success or a mainnet release certificate.

The earlier integrated ZIP remains pinned at `288efc3`; this new feature is
saved in the local checkout and evidence, pending the next consolidated build.
