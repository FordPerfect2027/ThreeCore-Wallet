# Public USDC acquisition screen

`/usdc/read/` now obtains Base Mainnet native USDC and ETH through the previously
verified canonical reader. A user can enter a public account and optional block,
read, cancel, save the source, then use that file in the budget and saved-source
comparison screens. Links from the token-reader and budget screens expose the flow.

The same-origin endpoint `/rpc/public-usdc` accepts only the public account and
optional block. It fixes the network, RPC and USDC contract, rejects extra fields,
limits bodies to 1 KiB, stops slow request bodies after 5 seconds, and admits at
most two concurrent jobs. A disconnect aborts the reader. The reader has a
120-second total deadline and the client a 125-second deadline. There is no
generic RPC forwarding, wallet invocation or transaction endpoint.

The screen performs no automatic read. Changing input, cancelling, leaving the
page or disposing the screen invalidates pending work and saved results. Response
account and explicit block must match; late reads and late checksum work cannot
restore a cancelled result. A changed input cannot export an earlier result.

## Evidence

- Ten feature/UI/HTTP checks passed. The related 55-case regression also passed;
  the ten cases are included in that 55, not additional unique cases.
- Ordinary browser acquisition at block **53,457,078** returned Account 2's
  **0 USDC** and **0.0007 ETH**. Its saved file independently decoded and matched
  every earlier command observation field except the acquisition timestamp.
- The actual downloaded file was selected in the budget screen, previewed,
  applied and recalculated. Source comparison passes and example budget
  sufficiency still fails, as expected from its explicit assumptions.
- The original download, screenshots and verification program are retained in
  `docs/evidence/2026-11-03-usdc-ui/` with checksums and a source inventory.

This completes on-screen USDC acquisition and its existing budget handoff.
It does not complete AI integration, fee/allowance execution preflight or
isolated execution. The next short task is the user-facing proposal/conditions
input and file flow, using the validation already implemented. AI connection
remains deferred by the user, and GitHub publication remains consolidated later.

Existing servers remain intact; the fresh ordinary screen was checked on 4252.
The sealed cd7f7ed distribution has not been replaced and excludes this change.
