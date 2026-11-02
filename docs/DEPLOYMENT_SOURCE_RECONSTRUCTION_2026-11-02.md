# Deployment source reconstruction — November 2, 2026

The recorded runtime bytes can now be reproduced completely for **five of six
registered deployments**, including compiler metadata and the expected EIP712
immutable values. This is an offline compiler reproduction of the earlier
canonical-block observations, not a new runtime read or independent audit.

| Token | Base Mainnet | Base Sepolia |
| --- | --- | --- |
| DAT | Executable and immutable values match; metadata remains different | Complete runtime matches the saved Hardhat input |
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

DAT Mainnet remains unresolved. The bounded root-filename and project-CRLF
diagnostics did not explain its metadata. The original five-mismatch result
remains valid for the unchanged ordinary Hardhat build; it is not overwritten.
An attempt to retrieve the six on-chain IPFS metadata references received HTTP
429 for every response. No metadata content was obtained or authenticated, and
no alternate gateway or repeated request was used to evade that limit.

## Mainnet creation and initial issuance

Fourteen read-only Base Mainnet RPC requests separately obtained the three
creation transactions, receipts and their canonical block headers, including a
second header/chain check. No wallet or account credentials were used.

| Token | Creation block | Initial minted amount, smallest units | Complete creation bytecode |
| --- | ---: | ---: | --- |
| DAT | 51,281,431 | 1000000000000000000000000000 | Executable matches; metadata remains different |
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
node docs/evidence/2026-11-02-token-dependency-review/verify-recorded-mainnet-deployments.mjs ../token-dependency-repair-DAT-20261102
node docs/evidence/2026-11-02-token-dependency-review/verify-recorded-sepolia-deployments.mjs ../token-dependency-repair-DAT-20261102
```

The first command requires the recorded solc binary hash and reproduces five
complete runtimes. The second checks three initial mints and reproduces two
complete creation inputs. The minimal 19-package read-only profile does not
include solc and cannot compile these inputs. The third command replays the 96
recorded Sepolia requests and verifies both creation inputs and initial mints.
No dependency or Solidity change
was made to the token repositories, and the development Zod advisory remains
open. The checks depend on the saved provider observations and local compiler;
they do not authenticate the provider, establish an independent audit or close
the remaining real-wallet and release gates.

The local CI configuration now runs all three commands once in the DAT matrix job
after installing the pinned development dependencies, and retains their JSON
results as workflow artifacts. All three commands passed locally. This workflow
change has not been published or run on GitHub; the previously documented
token-before-Wallet publication order still applies.

[Inputs, raw observations, results and methods](evidence/2026-11-02-token-dependency-review/)
are in the existing checksummed evidence collection. The 23d0a35 distribution
predates this addition; retain it as its own checkpoint and include the addition
in the next combined delivery.
