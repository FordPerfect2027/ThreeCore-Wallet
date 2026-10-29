# Canonical public observations — items 154–161

Source: `d7f7009` (local only). Public Aerodrome holdings and Classic-pool inspections previously pinned only the block number. They now follow the existing wallet identity reader's hash-pinning pattern and recheck the canonical header before returning a report.

## Completed work

154. Add bounded explicit-height header reads, rejecting missing/malformed headers and returned heights that differ from the request.
155. Capture diagnostic parameter data without invoking accessors; support exact hash selectors that require canonicality.
156. Pin all holdings inspection code, balance and existing-allowance reads to one observed canonical hash.
157. Pin pool discovery, code, token-identity and reserve reads to that same hash.
158. Re-read the explicit-height header after inspection and reject a changed hash, discarding all accumulated observations.
159. Preserve the hash and completed-recheck flag in holdings, pool and liquidity outputs, including the human-readable liquidity command.
160. Fail when a provider rejects the hash selector, without retrying latest, a block number or another provider.
161. Verify malformed headers, canonicality changes, unsupported selectors, parameter capture and command-output propagation with saved evidence.

## Verification

**116 tests passed, zero failed**, including eleven added tests. [Test log](evidence/2026-10-30-public-canonical/canonical-tests.log), [checksums](evidence/2026-10-30-public-canonical/SHA256SUMS.txt).

```powershell
node --test --test-concurrency=2 test/aerodrome-readonly.test.js test/aerodrome-pools.test.js test/aerodrome-rpc-security.test.js test/public-base-rpc.test.js test/base-rpc-probe*.test.js test/public-diagnostic-cli.test.js test/liquidity-target.test.js
```

All RPC replies are controlled fixtures; command-process tests replace fetch without forwarding. No live public endpoint, real wallet or balance was queried.

Both inspectors read the chain and height, resolve that height's header, use `{blockHash, requireCanonical:true}` for every state call, then resolve the same height again. A null header, wrong height, malformed hash, RPC rejection or changed final hash produces failure. An end-of-inspection hash change reports `BLOCK_CHANGED`; it never returns partial readings.

The shared transport accepts `eth_getBlockByNumber` only with an explicit canonical height and `false` for full transactions. Header fields are reduced to normalized number/hash after the bounded parser. Existing standalone connectivity probing keeps its previous number-pinned optional code check; it does not gain a canonicality claim from this change.

## Output and compatibility

- Holdings add `blockHash` and `canonicalBlockRechecked:true`.
- Pools add `checkedBlockHash` and `canonicalBlockRechecked:true`.
- Liquidity output adds `observedBlockHash` and `canonicalBlockRechecked:true`; it now rejects reports missing these prerequisites. Older or hand-constructed unanchored inputs need a fresh observation, not an invented hash.
- The liquidity text command prints the checked hash alongside the height.

These are endpoint-reported observations, not cryptographic verification of the provider or guarantees against later reorganizations. Recheck means the header matched at the end of this operation; it does not claim permanent finality. Live support/rate limits of the configured public endpoint were not tested here. Unsupported hash selectors fail explicitly.

The local demo does not import these public diagnostic modules; this batch changes the diagnostic/library/CLI path. No signing, transfers, approvals, private-key retrieval, publishing or deployment occurred.
