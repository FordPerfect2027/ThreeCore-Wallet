# Deployment source reconstruction — November 2, 2026

The recorded runtime bytes can now be reproduced completely for **all six
registered deployments**, including compiler metadata and the expected EIP712
immutable values. This is an offline compiler reproduction of the earlier
canonical-block observations, not a new runtime read or independent audit.

| Token | Base Mainnet | Base Sepolia |
| --- | --- | --- |
| DAT | Complete runtime matches recovered published compiler input | Complete runtime matches the saved Hardhat input |
| EMA | Complete runtime matches reconstructed source paths | Complete runtime matches reconstructed source paths |
| CAWELON | Complete runtime matches reconstructed source paths | Complete runtime matches reconstructed source paths |

## What explained four metadata differences

Hardhat's saved inputs identify project files as `project/contracts/...` and
OpenZeppelin sources as `npm/@openzeppelin/contracts@5.6.1/...`, with a matching
remapping. Rebuilding EMA and CAWELON with `contracts/...` and
`@openzeppelin/contracts/...`, without that remapping, reproduces their recorded
deployed metadata and full runtime bytes. **Every Solidity source byte remains
unchanged**, including dependencies; compiler 0.8.34, optimizer and EVM settings
are retained. The compiler inputs, local compiler digest and project-source
hashes against the pinned Git commits are recorded.

The portable checker recompiles all three original inputs and their path-only
reconstructions. It discovers the immutable-variable bindings from the newly
generated AST and fills each value from the token name, version, chain ID and
contract address. It compares the complete bytes, rather than ignoring metadata
or zeroing observed immutable values. Changing an executable, immutable or
metadata byte fails comparison. A separate compile with only a source comment
added preserves the executable but changes metadata and fails full comparison.

The earlier bounded DAT root-filename and project-CRLF diagnostics did not
explain its metadata; the later recovery below closes that comparison. The original five-mismatch result
remains valid for the unchanged ordinary Hardhat build; it is not overwritten.
An attempt to retrieve the six on-chain IPFS metadata references received HTTP
429 for every response. No metadata content was obtained or authenticated, and
no alternate gateway or repeated request was used to evade that limit.

## DAT Mainnet source recovered at 11:32 JST

A separate read-only lookup using the documented
[Sourcify contract API](https://docs.sourcify.dev/blog/apiv2-lookup-endpoints/)
retrieved the published compiler input for
[`8453 / 0x6c83dd253f2f882b9884fd1ac3a7754ed6405de5`](https://sourcify.dev/server/v2/contract/8453/0x6c83dd253f2f882b9884fd1ac3a7754ed6405de5?fields=all).
The HTTP 200 response contains 614,446 bytes, SHA-256
`4f20e25432a7c2e648940b03c1cb065f97f840f3851f2b7f251cb0e7ac6fd9e1`.
No source was uploaded and no verification job was submitted.

The 21 OpenZeppelin source files are byte-identical to the saved dependency
input after mapping their paths. The root is `DATCore.sol` rather than
`project/contracts/DATCore.sol`, and the local root file has **one additional
final LF byte**: 1,272 versus 1,271 bytes. No other Solidity content difference
was found. Compiler 0.8.34 and disabled optimizer / 200 runs match the published
input. The source repositories remain unchanged.

The local checker verifies those constraints, recompiles the recovered input
with the pinned compiler, derives the seven EIP712 immutable slots itself, and
compares the entire runtime against the independently saved Base RPC observation
at block 53,394,765. Runtime bytes and compiler metadata match completely.
The entire creation bytecode also matches the separately recorded creation
transaction at block 51,281,431. This does not rely on Sourcify's `exact_match`
label, its supplied immutable values or its supplied runtime as the comparison
target. Compiled metadata is additionally compared with the retrieved metadata.

The updated offline run therefore reports **6/6 complete runtime matches and
3/3 complete Mainnet creation matches**. Nine source-provenance controls reject
altered identity, compiler, source bytes, filename, optimizer or response digest.
The eight semantic controls recompute the changed response digest before testing.
Removing the service's match labels does not make the source checker fail.
Creation replay also rejects a modified metadata byte for each token, in addition
to the existing transaction and initial-mint controls. Previous 5/6 and 2/3
results are retained as earlier evidence, not silently overwritten.

- [Retrieved response](evidence/2026-11-02-token-dependency-review/dat-mainnet-sourcify-response.json) and [retrieval receipt](evidence/2026-11-02-token-dependency-review/dat-mainnet-sourcify-receipt.json)
- [Complete runtime result](evidence/2026-11-02-token-dependency-review/source-reconstruction-complete-results.json)
- [Complete Mainnet creation replay](evidence/2026-11-02-token-dependency-review/mainnet-deployment-complete-replay.json)
- [Source-input controls](evidence/2026-11-02-token-dependency-review/dat-mainnet-source-controls.json)

## Mainnet creation and initial issuance

Fourteen read-only Base Mainnet RPC requests separately obtained the three
creation transactions, receipts and their canonical block headers, including a
second header/chain check. No wallet or account credentials were used.

| Token | Creation block | Initial minted amount, smallest units | Complete creation bytecode |
| --- | ---: | ---: | --- |
| DAT | 51,281,431 | 1000000000000000000000000000 | Exact match after published-input recovery |
| EMA | 51,542,489 | 777000000000000000000000000 | Exact match |
| CAWELON | 51,542,494 | 420000000000000000000000000000000 | Exact match |

All three transactions succeed, directly create the registered address derived
from the sender and nonce, and encode the recorded initial holder
`0xfbe494b465efe6d0daff80dc715302d0fa0ac5d9` as the constructor argument. Each
receipt contains the corresponding initial mint Transfer from the zero address
to that holder for the amount above. Transaction position, receipt/log identity,
block number/hash and removal status are checked. These facts concern issuance,
not current balances, later distribution, ownership of the address or liquidity.

The offline replay recompiles the creation code and revalidates the actual
recorded responses. Modified sender, constructor argument, receipt status,
created address, removed log, mint supply/recipient, canonical header,
transaction position, chain and creation opcode are rejected. It does not
contact a provider or create any new transaction. EMA/CAWELON Sepolia creation
transactions and initial allocations were examined in the separate follow-up
below.

## Sepolia creation follow-up

The initial search stopped because the provider reports block history before
46,500,000 as pruned. Its two successful responses and the failed-attempt method
are retained, together with a separate diagnostic response reporting the
available lower bound. The initial collector's `requests: 2` counts completed
responses; it attempted three requests. The diagnostic was one additional call.

A bounded follow-up starting at the provider's stated lower bound completed
**96 read-only requests**. Code was absent at that bound and present at the
captured head. The search found an absent/present boundary for each contract,
then required an actual direct creation transaction and a successful matching
receipt at that exact block. It did not infer a deployment merely from finding
code. The previous block was also read as empty; code at every non-empty search
point matched the earlier saved runtime. Observation and creation headers and
chain ID were rechecked.

| Token | Creation block | Creation transaction | Result |
| --- | ---: | --- | --- |
| EMA | 47,046,084 | `0x15f2353c67409fce705522945bcd0d2496e182d72cea6f8dd93b1bd5326d9f20` | Complete creation code and initial mint match |
| CAWELON | 47,045,524 | `0x4731e7ead96c674706cb6acae4de3e5574e4528a73f602bdc37b9142315d5aea` | Complete creation code and initial mint match |

Both observed Sepolia initial holders are
`0xfbe494b465efe6d0daff80dc715302d0fa0ac5d9`, with the respective EMA/CAWELON
issuance amounts shown in the Mainnet table. The constructor argument and mint
event agree, and the sender/nonce derive the registered created address. This
does not establish current balances or ownership of that address.

The offline checker consumes the exact recorded method/parameter sequence,
recompiles creation bytecode and repeats the boundary/receipt checks without a
public RPC transport. Separate process controls modify mint amount, creation
opcode, an absent-code response and the repeated canonical header. The raw-file
digest is updated in each modified copy, so rejection cannot rely solely on
that digest. The untouched copy passes and all four changed copies fail.

## Reproduce the saved checks

From the Wallet checkout, with the pinned DAT development dependencies installed:

```powershell
node docs/evidence/2026-11-02-token-dependency-review/reconstruct-runtime-source.mjs ../token-dependency-repair-DAT-20261102
node docs/evidence/2026-11-02-token-dependency-review/verify-dat-mainnet-source-controls.mjs
node docs/evidence/2026-11-02-token-dependency-review/verify-recorded-mainnet-deployments.mjs ../token-dependency-repair-DAT-20261102
node docs/evidence/2026-11-02-token-dependency-review/verify-recorded-sepolia-deployments.mjs ../token-dependency-repair-DAT-20261102
```

The runtime command requires the recorded solc binary hash and reproduces six
complete runtimes. The source-control command needs only Node.js. The Mainnet
command checks three initial mints and reproduces three complete creation inputs.
The minimal 19-package read-only profile does not
include solc and cannot compile these inputs. The Sepolia command replays the 96
recorded Sepolia requests and verifies both creation inputs and initial mints.
No dependency or Solidity change
was made to the token repositories, and the development Zod advisory remains
open. The checks depend on the saved provider observations and local compiler;
they do not authenticate the provider, establish an independent audit or close
the remaining real-wallet and release gates.

The local CI configuration now runs these four commands once in the DAT matrix job
after installing the pinned development dependencies, and retains their JSON
results as workflow artifacts. The updated runtime/Mainnet/source-control commands
passed locally; the unchanged Sepolia command retains its earlier passing run. This workflow
change has not been published or run on GitHub; the previously documented
token-before-Wallet publication order still applies.

[Inputs, raw observations, results and methods](evidence/2026-11-02-token-dependency-review/)
are in the existing checksummed evidence collection. The 23d0a35 distribution
predates this addition; retain it as its own checkpoint and include the addition
in the next combined delivery.

## Complete standalone verification kit

`ThreeCore-source-verification-complete-f7aaec1-20261102.zip` in Downloads is the
current standalone kit, pinned to `f7aaec1e7179324bb9dcb7d8efb17b6414b5dcf9`.
It includes the recovered DAT input, the four offline commands, required source
and RPC records, compiler dependency lock, source licenses and Japanese README.
It is **445,316 bytes**, SHA-256
`7c77c4abd74f8067940057c48c2175de07f9560c4bf310afabf57e11a48f0b3b`.

All four commands passed from the newly assembled folder: six complete runtimes,
three complete Mainnet creations, two Sepolia creations/initial mints and nine
source-input rejection controls. This pass reused the earlier verified compiler
installation with an identical lock and checked compiler version/binary digest;
it was not another fresh dependency installation. The resulting JSON values
match the recorded repository results. All 30 outer manifest entries matched
after fresh ZIP extraction, and local report links were checked.

The kit's dependency installation requires npm; replay itself is offline.
It does not need the full Wallet package and is not a runnable Wallet release.
It does not close the remaining real-wallet, development dependency or
independent-review gates.
[Receipt](evidence/2026-11-02-token-dependency-review/complete-source-kit-receipt.json),
[file manifest](evidence/2026-11-02-token-dependency-review/complete-source-kit-manifest.txt)
and [Japanese instructions](evidence/2026-11-02-token-dependency-review/complete-source-kit-README.txt)
are retained with the creation method.

## Earlier standalone verification kit

`ThreeCore-source-verification-9838e5b-20261102-final.zip` in Downloads contains
the required recorded inputs, observations, three offline commands and a minimal
compiler dependency lock. It is **358,656 bytes**, SHA-256
`867bef2f9a75fc3807c19c48f786d780403b4acc59ccd79e43249cb8330d7161`.
Its source checkpoint is `9838e5ba1b097fa998cb95d36f8d7fec4834143d`.
This fixed kit predates the DAT Mainnet recovery above and retains its earlier
5/6 runtime and 2/3 Mainnet creation results. The `9c8c81b` incremental review
supplement also predates that recovery. Use the newer checkout evidence and
checker files to reproduce the complete DAT comparison.

A separate newly installed 21-package compiler environment, using neither the
previous node_modules nor previous npm cache, passed all three included checks.
That profile pins solc/viem and the applicable temporary-file/redirect overrides;
it does not install Hardhat or Zod. Its dated npm audit reports zero known
findings, which does not clear the affected full development toolchain or
constitute an independent audit. Dependencies are not vendored and initial
installation requires npm access. The packaged checks themselves are offline.

The ZIP was extracted to another new folder and all 48 manifest entries matched.
The final packaging pass adjusts only standalone documentation links; verified
code and data remain byte-identical to the fresh-runtime validation. This is an
addition to the existing Wallet distribution, not a replacement or release
approval. [Receipt](evidence/2026-11-02-token-dependency-review/source-kit-receipt.json)
and [compiler profile/replays](evidence/2026-11-02-token-dependency-review/source-kit-replays.json)
are retained with the methods and package manifest.
