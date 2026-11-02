# Applied helper: decoder and configuration compatibility

The installed private Zod 4 helper was compared with upstream helper 3.0.8
using 68 inert input cases. DAT, EMA and CAWELON each passed the same cases:
acceptance/rejection, decoded values and error paths matched. These are 68
distinct fixtures exercised in three installations, not 204 features.

The comparison covers empty and nonempty RPC data, exact large quantities,
address/hash lengths, parity encodings, nested access-list/request data,
parameter arity, configuration-variable shapes, sensitive-string/URL schemas
and the custom incompatible-field error. It does not execute requests or
transactions. Configuration functions remained uncalled. No provider, wallet,
keystore, signature or external RPC was used.

## Version and interpretation boundaries

The isolated reference installation uses upstream helper 3.0.8 and Zod
3.25.76, with hardhat-utils 5.1.1 and hardhat-errors 3.1.4 matching the installed
candidate. Only the reference uses the old Zod. It is a compatibility fixture,
not a recommended development installation or a dependency-security clearance.
The three candidates use helper 3.0.8-threecore-zod4.1 and Zod 4.6.6 at the
commits recorded in [the applied-repair report](ZOD_APPLIED_2026-11-03.md).

Three ordinary Zod error messages changed: an invalid configuration-variable
name, an invalid variable marker, and a nonfunction resolved-variable field.
Their rejection outcomes and error paths matched. Custom incompatible-field
messages matched exactly. The receipt retains both messages so review does not
hide this presentation difference.

The fixtures check the existing helper contract, not complete Ethereum protocol
validity. In particular, parity decoding is not authorization verification, and
access-list decoding is not an audit of every length constraint. No claim is
made about arbitrary schemas or every upstream plugin.

The first preparation attempt had a generated-script syntax error before it
started npm. A second attempt used the same file for npm's user and global
configuration and failed before installation. Separate empty configuration
files resolved this; the final isolated installation succeeded with lifecycle
scripts disabled. No existing dependency directory was reinstalled.

## Reproduction and evidence

The [comparison program](evidence/2026-11-03-helper-decoder-compatibility/compare-helper.mjs)
takes three positional arguments: the reference installation root, the
candidate installation root, and an output JSON path. It validates the expected
versions before declaring success. Reference dependency files and installation
receipts are retained with the results.

- [DAT results](evidence/2026-11-03-helper-decoder-compatibility/comparison-DAT.json)
- [EMA results](evidence/2026-11-03-helper-decoder-compatibility/comparison-EMA.json)
- [CAWELON results](evidence/2026-11-03-helper-decoder-compatibility/comparison-CAWELON.json)
- [Evidence checksums](evidence/2026-11-03-helper-decoder-compatibility/SHA256SUMS.txt)

This extends developer verification of the applied repair. It neither replaces
independent review nor establishes a 90% release score.
