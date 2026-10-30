# Captured HTTP packets and bounded byte accounting

Continuation items 369–371. Source revision `7f3c8cd`.

369. Read-only HTTP response limits use the intrinsic Uint8Array byte length and a detached bounded copy before decoding. A shadowing length getter cannot understate an oversized response or reject an otherwise valid small chunk. Non-byte chunks are refused.

370. Stream packets are captured from their own data fields. Accessor-based done/value packets are refused without invoking their getters, and cancellation is rechecked after capture. A stop during packet capture cannot continue to the next read. Split multibyte UTF-8 remains supported.

371. A response may contain at most 100,000 nonterminal chunks. Empty chunks count toward that finite budget, preventing a stream of immediately resolved empty reads from bypassing the byte limit and starving the event loop indefinitely. The boundary test accepts 99,999 empty chunks plus one data chunk and rejects one additional empty chunk.

## Validation

- Original regression set: 11 cases, 9 failed and 2 passing controls. Draft fix: all 11 passed.
- Final state/public RPC, transport cleanup, byte source and demo/allowance/identity/transfer server integration: **226 passed**, zero failed/skipped/cancelled; **8,722.3185 ms**.
- Evidence and SHA-256 checksums are in `evidence/2026-10-31-state-rpc-bytes/`. Source/tests were fixed during integration.

Latest full-wallet checkpoint remains 14,181 tests at `a4d6952` through item 360. Latest native Chrome checkpoint remains 836 at `4515f64` through item 368. No new full/browser run is claimed here. All response bodies and providers were synthetic; there were no external RPC calls, signatures, transfers, approvals, secret retrieval, publication, deployment or server restart.
