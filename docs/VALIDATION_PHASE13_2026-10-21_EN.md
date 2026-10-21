# Phase 13 — EIP-6963 announcement isolation and selected-provider integrity

Date: October 21, 2026 (JST)

## Outcome and scope

ThreeCore's discovery registry now retains the same provider object and text metadata that it validated. Inaccessible announcement properties are ignored, equivalent UUID casing cannot create a second chooser entry, and disposal during metadata access cannot repopulate the registry.

This fixes ThreeCore's own discovery handling. It does not change the official Aerodrome website or resolve the external EIP-6963-only route documented in [Phase 12](VALIDATION_PHASE12_2026-10-21.md). The official-site probe was not rerun in this phase. The original Aerodrome mock lineage `4848c39b60bac2c63fc38f685cdef12cd96290a8` is retained.

## Starting state

GitHub main and the local HEAD matched for all four repositories, with no uncommitted changes. The previous publication's CI runs were successful.

| Repository | Starting main |
| --- | --- |
| DAT | `cfc48e4edcaf1976095d72096195c22bf546daf9` |
| EMA-Draft | `0ce141c74f22b23bcc0c8c36d6f9ea85dee1505e` |
| CAWELON-Draft | `ebcd31e70767fc11fed12f7068f4baf7e87b9065` |
| ThreeCore-Wallet | `82c7872c315ca40c026002b0ee93de5aaf1a775d` |

## Reproduced failures

The previous registry inspected an announcement and then read its properties again when storing the entry. A provider getter could return one object during validation and another during registration. Metadata getters could similarly return values different from those checked.

Throwing accessors or revoked proxies escaped the discovery handler. UUIDs differing only by hex letter case were stored as separate entries. A metadata getter that disposed the registry could also cause an entry to be added after disposal.

A new 16-case regression file was run against the old implementation: **13 failed and 3 passed**. After the correction, all 16 passed. The three pre-existing behaviors protected by the passing cases are copied metadata, ignored icon/extra properties, and independent providers with matching names/rdns.

## Changes

- Capture event detail, info, provider reference, and each retained text field once.
- Validate that snapshot, rather than reading untrusted properties a second time.
- Catch property-access failures at the announcement boundary, reject that announcement, and continue accepting later valid providers.
- Normalize UUID keys to lowercase for registration and lookup. Preserve the first accepted provider for that UUID and emit no duplicate change notification.
- Recheck disposal after parsing, because a getter can reenter the registry.
- Preserve the original provider object's identity. Do not freeze, wrap, or modify extension-owned objects.
- Continue ignoring icons and unknown properties. Render retained metadata as text and make no account/RPC request during discovery.

The existing basic UUID/name/rdns syntax and length policy remains in place; this is not a new complete metadata-conformance validator. The registry does not authenticate a wallet from its UUID, name, or rdns. Exception handling cannot sandbox arbitrary code running in the same page or stop a non-returning getter. Callers' own rendering-callback exceptions are not silently swallowed.

## Validation

| Check | Result |
| --- | --- |
| New announcement boundary cases before the fix | 16 cases: 13 failed, 3 passed |
| Same boundary cases after the fix | 16 passed |
| Full local Wallet regression suite | 377 passed; 0 failed, 0 skipped |
| Local DAT EVM integration | 44 passed |
| Local EMA EVM integration | 44 passed |
| Local CAWELON EVM integration | 44 passed |
| Browser UI suite | 24 passed, including 3 new discovery cases; candidate CI logs verified |
| HTTP isolation suite | 2 passed; candidate CI logs verified |

Each token has one new integration case on each simulated chain ID, 8453 and 84532: **44 per token, 132 total**. A getter attempts to substitute another provider, followed by a case-equivalent duplicate UUID. The selected provider still returns the actual local token balance and allowance; the alternate provider receives no RPC. The inspection also checks that EVM state remains unchanged.

The three new Chrome cases exercise a throwing announcement followed by a valid wallet, a changing provider getter, and a case-equivalent duplicate while connected. They use an isolated profile and synthetic providers, never an installed wallet.

The candidate source is [`8a373a12a5684a7e14f92d9144546bc0c3acc44b`](https://github.com/FordPrefect2026/ThreeCore-Wallet/commit/8a373a12a5684a7e14f92d9144546bc0c3acc44b). [Candidate CI run](https://github.com/FordPrefect2026/ThreeCore-Wallet/actions/runs/39507449598) executes offline tests, HTTP isolation, actual Chrome UI interactions, and the token EVM matrix. Before main publication, the six tested implementation/test/workflow files are compared exactly with the release contents; only README, this report, and evidence are added.

The normal CI now accepts dedicated `validation/provider-discovery-*` branches so these checks can run before main is updated. Wallet CI pins the three starting token commits above. Each token's subsequent CI update pins the published Phase 13 Wallet commit. Token contract, supply, deployment, and history implementation remain unchanged.

Do not add repeated local/CI executions or overlapping token runners into a count of independent cases. [Machine-readable results](phase13-validation-evidence.json) record the candidate checks and local log excerpts. Final main CI results remain available in each repository's Actions history.

## Reproduction and limits

```sh
# ThreeCore-Wallet
npm test
npm run test:demo-server
npm run test:browser-ui # Linux with Chrome; synthetic provider only

# From each compiled sibling token repository, with its locked dependencies
node --test ../ThreeCore-Wallet/integration/token-compatibility.test.mjs
```

No real-wallet signatures, trades, transfers, approvals, LP additions, production deployments, or game development were performed. Existing local-EVM tests may create simulated contracts and change simulated state; they do not write to a public chain.

Real extension compatibility, WalletConnect, completed external-site signed login, and third-party security audits remain unverified. The historical [English development report](DEVELOPMENT_REPORT_2026-10-20_21_EN.md) and its counts describe the earlier snapshot and are not retroactively changed by this phase.

Specification reference: [EIP-6963 provider discovery and security considerations](https://eips.ethereum.org/EIPS/eip-6963).
