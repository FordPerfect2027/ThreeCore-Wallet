# Deployed runtime and current builds — November 2, 2026

Follow-up: [source-path reconstruction](DEPLOYMENT_SOURCE_RECONSTRUCTION_2026-11-02.md)
now reproduces complete runtime bytes for five of six deployments. The path-only
reconstruction explains EMA/CAWELON metadata on both networks; DAT Mainnet remains
different. The ordinary-build comparison below remains unchanged evidence.

Read-only observations at **09:21 JST** compared the current DAT, EMA and
CAWELON build artifacts with the six registered ERC-20 deployments. All six
have matching executable bytes when compiler metadata is excluded and the
compiler-declared immutable slots are populated with the expected domain,
network and contract values. This extends the earlier metadata/name checks;
it is not a complete source, deployment-transaction or storage verification.

| Network | Block | Executable bytes and expected immutable values | Complete runtime, including compiler metadata |
| --- | --- | --- | --- |
| Base Mainnet (8453) | 53,394,765 | DAT, EMA and CAWELON match | All three differ in the metadata IPFS digest |
| Base Sepolia (84532) | 53,285,052 | DAT, EMA and CAWELON match | DAT matches; EMA and CAWELON differ in the metadata IPFS digest |

Exact block hashes, registered contract addresses, public runtime bytes,
artifact hashes and fixed source revisions are in the
[public comparison](evidence/2026-11-02-token-dependency-review/runtime-public-comparison.json).
Each network used one captured block hash with `requireCanonical: true`, then
rechecked its header and chain. Only `eth_chainId`, `eth_getBlockByNumber` and
`eth_getCode` were dispatched: fourteen public requests total. No wallet,
signature, transaction, approval or private account material was used.

## What was compared

The artifacts are the actual LF-normalized builds already retained in the
[source portability evidence](SOURCE_PORTABILITY_2026-11-02.md), at token pins
`502944c` (DAT), `9cad39a` (EMA) and `e3a5fbb` (CAWELON). Their SHA-256 hashes
were checked against that earlier receipt before reading public code.

The first diagnostic masks compiler-declared immutable slots and compares
the remainder. A second offline check closes that masking gap: it traces all
seven immutable variables through the compiler AST, derives their expected
values from the EIP712 constructor in the installed OpenZeppelin source, and
compares every byte of those slots. The fields are the cached domain separator,
chain ID, contract address, name/version hashes and packed short strings.
All **42 slot observations** match. Those are components of the six runtime
comparisons, not 42 additional deployments or acceptance gates.

The stored metadata trailers all encode compiler 0.8.34. For the five full-code
differences, the changed trailer bytes are confined to the IPFS digest. That
digest difference remains a real mismatch. The preceding CRLF artifacts also
do not match those five digests, so the difference is **not explained merely
by the recent newline normalization**. Original metadata/source reconstruction
is still required before claiming exact source identity for those deployments.

[Immutable results](evidence/2026-11-02-token-dependency-review/runtime-immutables.json)
and [compiler field bindings](evidence/2026-11-02-token-dependency-review/runtime-immutable-bindings.json)
retain the values and compiler-output hashes. The binding map records this
developer's compiler output; a reviewer can rebuild the pinned token sources
to independently check the AST associations.

## Offline replay

Use the existing evidence folder and one restored token checkout with its
minimal `viem` runtime installed. From the Wallet checkout, for example:

```powershell
node docs/evidence/2026-11-02-token-dependency-review/verify-runtime-comparison.mjs ../token-dependency-repair-DAT-20261102
```

The checker reads the three retained artifacts and public observations. It
does not compile, contact RPC, inspect a wallet or update a file. It reproduces
six executable/immutable matches, one complete-runtime match and five metadata
differences. Forty-eight mutation controls confirm that changing an executable
byte or any immutable slot breaks the comparison. These controls are synthetic
copies, not modifications of the original files or public contracts.

The checker was also run as a separate process against copied evidence:
the unaltered copy succeeds; modified opcode, modified domain immutable and
modified compiler-binding copies each exit with failure. The public record's
outer digest was updated in the first two negative controls so failure could
not rely solely on its checksum.
[Control results](evidence/2026-11-02-token-dependency-review/runtime-evidence-controls.json)
and the historical local method scripts are checksummed in the same folder.

Offline consistency is not authentication of the RPC provider or compiler.
This comparison does not prove the initial holder, current storage, balances,
constructor transaction, independent audit or real-wallet acceptance. The
existing distribution predates this evidence; include it with the next combined
delivery. Contract sources and token repository pins were unchanged here.
