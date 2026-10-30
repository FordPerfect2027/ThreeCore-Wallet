# Identity and allowance panel observers and handoffs

Continuation items **301–306**, source `324eab2`.

301. Capture the identity catalog's context once from own data fields and recheck panel ownership before adopting its preview. Clearing or disposing during capture cannot restore an old preview; diagnostic getters are not evaluated.
302. Consume the reviewed local address insertion once and require a synchronous accepted adapter receipt. An asynchronous or false result cannot report that an address was inserted; callback invalidation or disposal wins over old status.
303. Isolate identity summary observers, consume asynchronous failures and recheck the live controller state before rendering. A summary callback cannot dispose the panel and then receive stale rendering.
304. Require an accepted synchronous identity-file download handoff and preserve the prepared file/generation ownership through delivery. Failures, newer actions or disposed panels cannot display late success.
305. Apply the same observer isolation and live-state check to the allowance panel, including own diagnostic capture for local filtering errors.
306. Require accepted synchronous handoffs for both allowance target and observation files. A rejected, false or still-pending asynchronous receipt cannot claim success or hold the UI handler open waiting for an unsupported receipt.

The 29 new cases reproduced **25 failures** and four existing controls against the committed item-300 source. After correction, **65 focused tests** passed. Identity, catalog, allowance and adapter integration passed **1,133 tests**, zero failures, cancellations or skips (13224.1034 ms).

Evidence: [before](evidence/2026-10-31-identity-allowance-panels/before.log), [focused](evidence/2026-10-31-identity-allowance-panels/fixed.log), [integration](evidence/2026-10-31-identity-allowance-panels/integration.log), [SHA-256](evidence/2026-10-31-identity-allowance-panels/SHA256SUMS.txt).

The preceding full-wallet pass was 13,597 tests at `23eb408`, through item 300. This later patch has the related integration evidence above. Tests use fictional public addresses, synthetic DOM elements and local adapters. A download handoff does not prove disk completion; address insertion does not establish contract safety. No real signature, transfer, approval, key retrieval, publication or deployment occurred.
