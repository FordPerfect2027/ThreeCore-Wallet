# DAT historical verifier correction — November 2, 2026

The former negative simulations treated any exception as an expected rejection.
A real command with a fictional loopback provider printed PASS even when both
probes received transport/rate-limit errors. The corrected command fails that
case and requires the exact ABI revert reason at one canonical historical block.
This does not establish which responses the original September run received.

DAT commit: `ebaa8d923a5b88ab61e7c1626aca372c841f569a` (parent `355fb9322bbfeafc8e008bf7f7aa1db057099750`).
EMA and CAWELON have no corresponding legacy verifier and are unchanged here.
The mainnet response-body correction remains separate in its dated record.

The new verifier pins code, state and eth_call simulations to the block hash,
validates recorded receipts and deployment input, then rechecks headers/network.
The complete local read-only run passed 251 TAP entries; after the final default
artifact-path change, all 24 dedicated cases passed. These counts overlap and
are not feature totals or a completion percentage.

The current CRLF developer build differed from the old deployment record.
An isolated compile changing only DATCore.sol CRLF to LF, with the same compiler,
dependency sources and settings, exactly reproduced the recorded source,
creation-bytecode and normalized-runtime hashes. That reference is included in
DAT and checked before RPC. The original expected hashes were not changed.
The CLI no longer implicitly compiles; it uses that reference by default and
accepts an explicit matching artifact. Ordinary build newline portability remains
separate work. No Solidity, deployment record or dependency lock changed here.

The corrected verifier also passed on public Base Sepolia at block 46,922,886,
hash `0x0c5a5320dd2539b09e36e44944fbb562cfad3b36d85402c29412313f4ba4363b`.
It checked deployment plus five successful receipts, checkpoint state and the
exact ERC2612InvalidSigner / ERC20InvalidReceiver rejection reasons. These are
historical observations, not current balances or real-wallet acceptance.
Only public reads and eth_call simulations were sent; no signature was created
and no transaction was submitted.

The public explorer's deployed code and creation input match. Its displayed
source text differs and its verification remains partial, not full. The compact
observation preserves those distinctions and the original response hash.

[Evidence index](evidence/2026-11-02-token-dependency-review/SEPOLIA_VERIFIER.md)
contains the failed baseline, exact before/after receipt, full regression output,
source patch, reproduction methods and public checkpoint receipt. Method files
are snapshots with local paths, not general-purpose installers. The verified
d904442 delivery predates this correction. Real-wallet acceptance, the compatible
Zod remediation/exposure review, independent review and release approval remain open.
