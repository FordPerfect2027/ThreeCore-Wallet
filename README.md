# ThreeCore Wallet

**October 24, 2026 source publication:** [Development, security changes and verification](docs/WALLET_SECURITY_UPDATE_2026-10-24_EN.md). Includes the accumulated transfer/report workflows, optional encrypted workspace backups, connection protection, bounded file processing and shared export cleanup. The verified local suite passed 10,373 cases. GitHub Actions results belong to the published commit; source publication does not deploy a website or contract.

Security design: [Wallet response protection and verification scope](docs/RPC_PROTECTION_LOCAL_20261024.md).
操作説明: [Walletの応答保護](docs/RPC_PROTECTION_JA.md)。

**October 24, 2026 encrypted backup update:** [Design and security limits](docs/ENCRYPTED_WORKSPACE_BACKUP.md) · [日本語の使い方](docs/ENCRYPTED_WORKSPACE_BACKUP_JA.md). Adds optional passphrase-protected workspace files, authenticated decryption, explicit restore preview, cancellation and expiry. Existing plaintext files and separate report collections are not automatically encrypted. The linked design documents preserve the scope of the local development iteration.

**October 24, 2026 security update:** [Protection controls, input boundaries and verification](docs/SECURITY_LOCAL_20261024.md). Adds a three-token stop control, idle/page-exit protection, a private page-local protection history, bounded JSON/File processing, read-only RPC enforcement and hardened local HTTP responses. Independent security auditing has not been performed.


**October 23, 2026 publication:** [Wallet history, backup, identity and allowance update](docs/WALLET_UPDATE_2026-10-23_EN.md). The source now includes reviewed history imports, three-card backup/restore, opt-in saved checkpoints, block-pinned token identity and exact balances, and read-only allowance observations. These are development features; no public website or deployed contract is changed by this source release.

**[October 20–21, 2026: English development and validation report](docs/DEVELOPMENT_REPORT_2026-10-20_21_EN.md)** — Per-token line counts, implemented changes, mock-wallet experiments, verified CI results, and remaining compatibility limits. Figures are tied to the recorded development snapshot.

**Ford Prefect / DAT • EMA • CAWELON**

**October 22, 2026 update:** [Portfolio features and validation](docs/VALIDATION_PORTFOLIO_2026-10-22_EN.md) adds hash-pinned multi-token reads, historical JSON reports/comparison, explicit token-list preview/application, progress reporting, cancellation and stale-response protection. Local validation: **1,078 unit tests, 84 synthetic browser UI cases and 2 HTTP tests passed**. GitHub Actions for the published commit is a separate check; see the commit's checks. Real-wallet signing, transactions and production/external-dApp compatibility remain unverified.


**Previous published validation (historical snapshot):** [Phase 20 — Duplicate-wallet review and explicit reconnection](docs/VALIDATION_PHASE20_2026-10-21_EN.md) implements a visible recovery panel in the isolated Aerodrome proposal. It preserves distinct same-name/blank-name wallets, supports cancellation, rejects stale reviews and removes only explicitly selected duplicates without connecting automatically. Twelve diagnostic conditions include both recovery UI scenarios. Verified: 492 offline cases, the existing 27 Chrome UI cases in each of 3 consecutive runs, 2 error-detection controls and 138 token integration cases. Official EIP-6963-only connectivity and production deployment remain unresolved. Historical reports retain their original snapshots.

**Development-only connector. Not a deployed autonomous wallet, bridge, custody service, dApp integration or trading system.** No production funds are touched.

This repository develops a narrowly scoped browser-wallet connection interface for **ThreeCore's own three token agents**. It is separate from CAW's game platform. **No game development is included or proposed in this phase.**

## Agreed liquidity target: 5,000 USDC per pool

The ThreeCore project's current liquidity-depth objective is **5,000 USDC held on the USDC side of each DAT/USDC, EMA/USDC and CAWELON/USDC Aerodrome Classic volatile pool** (15,000 USDC across the three). This is a target for monitoring, **not** an authorization to contribute funds. The [target specification and safeguards](docs/LIQUIDITY_TARGET_5000_USDC.md) distinguish observed pool reserves from actual LP deposit costs.

Run `npm run liquidity:progress` (or `npm run liquidity:progress -- --json`) for a fresh, read-only on-chain progress report. The displayed block number anchors each observation. The target calculator reports an unverified pool as unknown, never as zero. No wallet authorization, LP deposit, swap or token transfer is performed.
## Current engineering focus

1. Bind each DAT, EMA or CAWELON session to a separately assigned EVM account.
2. Recognize the connected decentralized application's HTTPS origin and explicitly approved destinations.
3. Request wallet connection only after a user presses Connect Wallet.
4. Reject the wrong wallet account and the wrong chain, rather than silently switching.
5. Read EVM native balances and ERC-20 balances through `eth_getBalance` and `eth_call`.
6. Invalidate the session after account changes, chain changes, disconnects or an unexpected provider response.
7. Keep all signing, transactions, swaps, bridging, grants and autonomous spending **disabled** in this initial phase.

### What is already implemented

- `src/wallet-session.js`: a dependency-free EIP-1193 connector, scoped to one agent/account/site/network
- **Read-only decentralized-site preflight:** check existing ERC-20 `allowance(owner, spender)` via `eth_call` and whether an explicitly entered contract address currently has bytecode via `eth_getCode`. These checks cannot grant approvals, establish protocol safety, or execute a swap.
- `test/wallet-session.test.js`: deterministic tests using a mock wallet provider; no actual chains or transactions
- `examples/index.html`: browser demonstration for connecting an explicitly selected wallet to this example origin; not a live decentralized service
- `examples/dev-server.js`: localhost-only test server for the demonstration

## Run locally

Requirements: Node.js 22 or newer.

```bash
npm test
npm run demo
```

For the demo open `http://127.0.0.1:4173` in a browser with a compatible injected EIP-1193 wallet (e.g. MetaMask). **Never enter a seed phrase or private key.** Set a distinct expected public address for the chosen agent. The demo asks the wallet extension for account permission; any wallet prompt must be confirmed by the actual user. No transaction-signing methods are used.

## Architecture

```text
ThreeCore app / user-approved decentralized site
    |
    | User clicks Connect Wallet
    v
EIP-1193 injected wallet provider (non-custodial)
    |
    v
Agent-scoped session (DAT / EMA / CAWELON)
    |- trusted site origin allowlist
    |- expected EVM account check
    |- Base / Base Sepolia chain-ID check
    |- local events for chain/account/disconnect
    |
    +--> eth_chainId          (read)
    +--> eth_accounts         (read)
    +--> eth_getBalance       (read)
    +--> eth_call             (ERC-20 balanceOf; read)
    X    eth_sendTransaction  (not implemented)
    X    personal_sign        (not implemented)
    X    wallet_switchEthereumChain (not implemented)
```

Base Mainnet chain ID is `8453`, Base Sepolia is `84532`. Network support here is **connection validation**, not compatibility proof for arbitrary decentralized sites or bridges.

### Scope limits / current status

| Capability | Status |
| --- | --- |
| Three named agent identities, each bound to an expected account | Mock-tested connector |
| Explicit site origin and network validation | Mock-tested connector |
| EIP-1193 account request, chain/account/disconnect handling | Mock-tested connector |
| Read-only native/ERC-20 balance, existing allowance, and contract-code requests | Mock-tested connector |
| Wallet interaction on a third-party live decentralized site | Synthetic Aerodrome connection flow only; real-wallet login unverified |
| User-approved transaction signatures and token allowances | Not implemented |
| Autonomous trade execution, bridges and cross-chain settlements | Not implemented |
| Distinct custody for three agents | To be designed; **not** provided by this connector |
| Production smart-contract changes | None |

## What comes next (not a claim of delivery)

- Agree on the permitted decentralized-site domains and their wallet connection methods.
- Connect to a user-selected public test environment; verify chain, account, balances and error handling end-to-end.
- Define permission limits separately for DAT, EMA and CAWELON before any signature or asset movement.
- Design robust limits for transaction simulation, explicit approvals, gas, price impact, nonces, replay prevention, and failure recovery if future transaction execution is authorized.
- Any bridge or cross-chain movement requires separate risk assessment and explicit authorization.

### Security boundaries

**Never provide private keys, seed phrases, or secrets to this module, a public website or an AI agent.** This code neither receives nor stores them. A website-controlled `siteOrigin` value is not sufficient proof of origin; a host application must obtain the origin from its trusted browser context (`window.location.origin`). Only explicitly trusted domains should be added to `approvedOrigins`.

All on-chain calls in this version are read-only. The mock tests demonstrate code behavior only and **do not establish real-world safety or independent security-audit certification**.

Related token repositories: [DAT](https://github.com/FordPerfect2027/DAT) · [EMA](https://github.com/FordPerfect2027/EMA-Draft) · [CAWELON](https://github.com/FordPerfect2027/CAWELON-Draft).

**DON'T PANIC. JUST CODE.**


## Multiple browser-wallet discovery (EIP-6963)

The browser demonstration now provides a wallet-provider selector for each DAT, EMA and CAWELON session. The new `src/provider-registry.js` adapter listens for EIP-6963 announcements, keeps a stable registry of announced EIP-1193 providers and allows an explicit provider selection. The legacy injected `window.ethereum` route remains available when present.

**Provider discovery does not request account access, signatures, approvals or transactions.** A user must still press Connect Wallet to request access for the selected ThreeCore agent. Each agent also validates its expected account, chain and current origin independently. Wallet-provider names and reverse-domain metadata are self-reported by browser extensions, **not identity verification**. No external decentralized service is claimed to be integrated or verified by this local demonstration.

The local demo server also serves the EIP-6963 module. Test it with `npm test` and `npm run demo`. A compatible installed browser wallet is required to test a real provider-selection interaction.

## External dApp spender preflight (read-only)

`src/dapp-preflight.js` adds a combined inspection action to the local demo. Once a ThreeCore DAT, EMA or CAWELON wallet has **already been connected by its user**, enter a verified ERC-20 token contract and a verified decentralized-app spender contract, then press the dApp preflight button. The inspection reads contract-code presence, the agent's token balance, and **existing** allowance in raw base units; it does not grant or revoke allowances.

The code compares the connected wallet's agent/account/chain/origin before and after each asynchronous read and refuses to present a complete report after a wallet change. Missing token bytecode is reported as *unknown balance/allowance*, never zero. Missing spender bytecode is a warning, not proof of maliciousness. Contract bytecode present, or a nonzero allowance, is **not a security audit or proof that the dApp is trusted**.

All checks use an EIP-1193 browser wallet already selected in the local demo, and do not establish connectivity to any external dApp website. No transactions, token transfers, approvals, signing prompts or autonomous spending are implemented.


## Public Base RPC live diagnostics (read-only)

`src/base-rpc-probe.js` and `scripts/probe-base.js` provide a repeatable **live-chain connectivity check** through the Base team's rate-limited public JSON-RPC endpoints. This is a separate diagnostic from the browser-Wallet connector and does not request accounts or connect to an external dApp.

```bash
node scripts/probe-base.js sepolia
node scripts/probe-base.js mainnet
node scripts/probe-base.js mainnet <public ERC-20 contract address>
```

The diagnostic checks `eth_chainId` and `eth_blockNumber`; with a public address, it also checks deployed bytecode via `eth_getCode`. It refuses a wrong network and never calls a signing, transaction, approval, or wallet-account method. **Bytecode presence is not evidence that a contract is verified, safe or usable in a particular dApp.** Public RPCs are rate limited and unsuitable as a production backend; use a properly configured node provider for production.

During the 2026-10-20 local check, both Base Mainnet (chain ID 8453) and Base Sepolia (chain ID 84532) responded successfully. A read-only `eth_getCode` check also returned nonempty bytecode at DAT's recorded Base Mainnet contract address. These observations are point-in-time connectivity checks, not continuous service monitoring, token custody evidence, or proof of real third-party dApp / browser-wallet integration.

Base documentation: https://basehub.org/api-reference/rpc-overview/


## Aerodrome Classic Router inspection (Base Mainnet, read-only)

`src/aerodrome-readonly.js` and `scripts/inspect-aerodrome.js` provide reproducible checks of the published Aerodrome **Classic Router**, PoolFactory and FactoryRegistry along with the deployed DAT, EMA and CAWELON token contracts on Base Mainnet. Contract addresses were compared against [Aerodrome's official security/addresses page](https://aerodrome.finance/security) and the respective ThreeCore token repository deployment records. These references should be rechecked when services upgrade or migrate.

```bash
node scripts/inspect-aerodrome.js
# Optional: public EVM wallet address only, NEVER private key/seed phrase
node scripts/inspect-aerodrome.js 0xYOUR_PUBLIC_EVM_ADDRESS
```

Without a wallet address, the inspector confirms chain ID, block number and `eth_getCode` presence at six preselected addresses. With a **public** wallet address it also reads each ThreeCore token's ERC-20 `balanceOf` and `allowance(wallet, Aerodrome Classic Router)`, expressed in raw base units. It does not grant approvals or use a browser-wallet provider.

**Limits:** Classic Router allowance does not cover UniversalRouter, Slipstream or other spender addresses. Nonzero allowance is not an endorsement or a proposed swap. Bytecode at an address is not a safety audit, pool existence, swap execution, wallet connection, or liquidity confirmation. Public RPC providers may impose rate limits. No transaction, signature, custody, withdrawal or bridge action is implemented.


## Aerodrome Classic DAT / EMA / CAWELON liquidity-pool discovery

`src/aerodrome-pools.js` and `scripts/inspect-aerodrome-pools.js` query the published Aerodrome **Classic v2 PoolFactory** on Base Mainnet for the volatile and stable variants of DAT/USDC, EMA/USDC and CAWELON/USDC. This uses `getPool(address,address,bool)` and verifies each returned pool's bytecode, `token0`/`token1` membership and `getReserves()` at a single observed block. Reserve amounts are mapped to the correct token and returned as raw base-unit strings. No wallet, transaction, signature, swap, or approval is required.

```bash
node scripts/inspect-aerodrome-pools.js
npm test
```

Sources: [Aerodrome PoolFactory interface](https://github.com/aerodrome-finance/contracts/blob/main/contracts/interfaces/factories/IPoolFactory.sol), [Pool getReserves implementation](https://github.com/aerodrome-finance/contracts/blob/main/contracts/Pool.sol), [Aerodrome published factory address](https://aerodrome.finance/security), [Circle's native Base USDC address](https://www.circle.com/blog/usdc-now-available-natively-on-base). The inspected ThreeCore contract addresses are from the corresponding FordPrefect2026 token repository deployment records, not assumptions about their supply.

**Example verified result (2026-10-20, Base Mainnet block 52852584):** All three *volatile* Classic pairs existed and their USDC reserves read 100000000 base units (100 USDC using the standard six-decimal USDC); the *stable* Classic factory pairs returned no pool address. These observations are point-in-time, may change, and are not proof of adequate liquidity, fair pricing, route availability, or executed trades. Slipstream concentrated-liquidity pools, UniversalRouter, other factories and other DEXes are **not** covered.

The repository intentionally does not calculate a purchase recommendation or trigger an approval. Before any future live interaction, verify the selected browser wallet, intended token address, actual spender/router, chain, available liquidity, quoted amounts, gas and slippage. This inspection alone does **not** establish external dApp Wallet connectivity.

## Reproducible 20,000-line development target

Development aims toward 20,000 meaningful source lines across **DAT, EMA, CAWELON and their shared ThreeCore-Wallet tooling**, rather than padding files to inflate counts. This is a long-term engineering goal, **not** a production readiness, code quality, token value or delivery guarantee. The user has not authorized funds movement, token changes or game development to pursue this goal.

The command `npm run census` (or `node scripts/codebase-census.js`) measures the four sibling Git working trees by listing only `git ls-files` tracked files. It excludes README and prose files, lockfiles, node_modules, generated/vendor/build/coverage folders, and files larger than 1 MiB. It reports physical lines and a second estimated active-line count, breaking files into implementation, tests, developer tools and configuration. Active lines exclude blank/comment-only lines but are still **not** a precise semantic measure of useful or executable code. Always accompany any line-count milestone with working functionality and successful tests. The output is tied to the current local Git checkout; verify each branch and commit against GitHub before announcing a published result.

Run from the normal `ThreeCore-FordPrefect/ThreeCore-Wallet` checkout alongside `DAT`, `EMA-Draft`, and `CAWELON-Draft`. If any repository is absent, the command fails rather than reporting a misleading partial total. No wallet permissions, network requests or file modifications are performed by this diagnostic.

## In-flight read-only requests and wallet session changes

The browser wallet session guards every asynchronous `eth_chainId` / `eth_accounts` preflight and subsequent `eth_getBalance`, `eth_call` or `eth_getCode` response with a connection-generation check. If the user disconnects, an EIP-1193 account/chain/disconnect event invalidates the session, or a read becomes stale across explicit reconnection, that read rejects with `SESSION_CHANGED` instead of presenting a stale result. Invalidating an event-driven connection also removes its registered listeners when the provider supports `removeListener`. This behavior is covered by mock regression tests for each read method, account/chain changes, stale account responses, and reconnection.

**Limitations:** The browser-wallet RPC request may already have reached the provider before session invalidation. This safeguard discards stale results; it cannot cancel the provider's network request, revoke a wallet extension's persisted permissions, or prove third-party dApp safety. Disconnection never authorizes a subsequent reconnect; only an explicit user action may request account access again. No new chain or external site support is implied by these tests.

## External Aerodrome dApp connection-flow probe (isolated browser, synthetic wallet)

A real third-party **website-level integration test** is now available using the official [Aerodrome website](https://aerodrome.finance/connect) in a newly-created temporary headless Chromium profile (Edge on Windows, Chrome on Linux). **This is not a real wallet login.** The browser profile has no wallet extension, session cookies, funds or private keys. A deliberately fictitious EIP-1193/EIP-6963 provider simulates account permission and rejects every signing, transaction, approval or chain-switch request.

On Windows with Edge, or Linux with `/usr/bin/google-chrome`:

```bash
# Uses the live public Aerodrome site and a synthetic ZERO-FUNDS test wallet.
npm run test:external-dapp

# Inspects the live public connect UI without injecting any wallet provider.
npm run inspect:external-dapp
```

These browser diagnostics use the network and are **excluded** from the default `npm test` and ordinary regression CI. The separate `external-dapp.yml` workflow can be manually run; Phase 11 validation branches also run it. A completed diagnostic can report a connection that was not observed, which is not a positive compatibility test. `npm test` includes offline unit tests for the synthetic provider, permission gating, exact trusted origin, blocked signing/transaction methods and restrictions on attaching to an existing user browser. The launcher creates a random loopback debugging port and a fresh disposable browser profile; it does **not** attach to the existing logged-in Chrome/Edge session.

### Observed live site behavior — 2026-10-20

- Official `https://aerodrome.finance/connect` displayed **Browser Wallet**, **WalletConnect**, **Coinbase Wallet** and **Binance Wallet**.
- Browser Wallet requested `wallet_requestPermissions` and `eth_requestAccounts`; the **simulated** test wallet granted only its fictitious public account.
- Aerodrome then displayed a legal-disclaimer **Sign-in** step. On choosing Sign-in using the simulation, the website requested **`personal_sign`**, which the synthetic provider **rejected**. No signature, token approval or transaction was produced.
- Thus **external website flow up to the signature requirement was exercised**, but **real-wallet integration, completed Aerodrome sign-in, authorized trading and external dApp acceptance of any ThreeCore-specific Wallet are NOT verified**. The actual connection workflow requires separate user-controlled account permission and, currently, a sign-in signature. Never infer authorization to sign from this test.

### Security and scope

This probe deliberately uses only the official hostname `aerodrome.finance`. It ignores mirrors and similar-looking domains. Its test account is not associated with any private key. A successful simulation does **not** certify the website, its smart contracts or any swap. Public site behavior and wallet connection requirements may change over time; a mismatch causes a nonzero process exit so results are not silently labelled successful. As elsewhere in ThreeCore-Wallet, signing, live swaps, liquidity deposits and token approvals require independent, explicit authorization and are currently out of scope.

## Validation — 2026-10-21

[Results, safety fixes and remaining limits](docs/VALIDATION_2026-10-21.md) · [Live read-only evidence](docs/validation-evidence-2026-10-21.json). Wallet uint256 responses are bounded, the simulation checks the exact HTTPS origin, and the public Aerodrome inspector pins code/balance/allowance reads to its reported block number. Offline regressions run in GitHub Actions; live external-site probes remain opt-in.

### Further connection and permit validation

[Phase 2 results](docs/VALIDATION_PHASE2_2026-10-21.md) cover pending-permission cancellation, stale response/event isolation across reconnection, cleanup failures, and strict single-word ERC-20 return decoding. The three token repositories also exercise ten permit authorization boundary cases each on a local simulated EVM. Real-wallet login and external-dApp compatibility remain unverified.

### Token contract and Wallet integration

[Phase 3 results and reproduction](docs/VALIDATION_PHASE3_2026-10-21.md) cover 18 local EVM integration cases per token, using chain IDs 8453 and 84532 without contacting either live network. Wallet CI compiles pinned token checkouts and tests their actual ABI responses against this checkout's Wallet code.

The read-only session's public `state.connectionEpoch` identifies its current connection generation. Custom session adapters passed to `inspectDappSpender` must expose a nonnegative safe integer epoch and advance it on disconnection or invalidation. Preflight compares it across every read, so reconnecting to the same account cannot combine results from different connections. Reports include the epoch and reject balances or allowances outside uint256.

### Block-consistent dApp preflight

`inspectDappSpender` now captures a mined header and pins both code reads, token balance and allowance to its hash using [EIP-1898](https://eips.ethereum.org/EIPS/eip-1898) with `requireCanonical: true`. It rechecks the header at the captured height before returning. Reports include `blockNumber` (decimal string) and `blockHash`; the demo displays the sampled block number. A new head can appear without changing the sampled values. A missing/replaced block or unsupported hash selector rejects the inspection without falling back to `latest`.

Custom adapters must implement `getBlockSnapshot(blockNumber = "latest")`, returning `{ number, hash }` with a hexadecimal block number and a 32-byte hash. Their `getContractCode(address, blockHash)`, `getTokenBalance(token, blockHash)` and `getTokenAllowance(token, spender, blockHash)` must honor the hash and require canonical state. `ThreeCoreWalletSession.getNativeBalance(blockHash)` also supports an explicit hash. Individual read methods retain `latest` behavior when the hash argument is omitted; the composite preflight and demo card's balance action automatically pin a snapshot.

[Phase 4 validation](docs/VALIDATION_PHASE4_2026-10-21.md) records 179 Wallet regressions and 22 local EVM integration cases per token (66 total), including actual local chain advancement and rollback during inspection. Provider compliance and truthful responses remain trust assumptions; a later reorganization can still invalidate a previously returned report. This change does not establish real-browser provider support or completed external-dApp login.

### Demo UI state and synthetic browser coverage

Each card now owns its connection and visible operation through `createWalletCardController`. Disconnecting, changing the account/chain/provider, or receiving a provider invalidation clears displayed results. Delayed replies cannot restore an obsolete connection, error or balance. Changing token/spender inputs clears the old report while preserving a valid connection. A balance action captures its inputs and pins native balance, token code, balance and allowance to one canonical block hash.

[Phase 5 validation and reproduction](docs/VALIDATION_PHASE5_2026-10-21.md) records 196 offline tests and 24 local EVM cases per token (72 total). CI additionally runs two HTTP route tests and eight real DOM interaction tests in headless Chrome, using an isolated profile and a synthetic provider. The browser tests never use an installed Wallet or external RPC; they do not certify Wallet extension compatibility.

Run `npm run test:demo-server` for HTTP routes and `npm run test:browser-ui` on Linux with `google-chrome` installed. For manual reproduction, `npm run demo -- --ui-test` exposes `/test/browser/` on the displayed local address. Normal demo mode does not serve test fixtures. The automated browser suite starts its own temporary loopback server and removes its temporary Chrome profile when finished.

### Token history response validation

[Phase 6 validation](docs/VALIDATION_PHASE6_2026-10-21.md) extends the pinned token CI matrix with 91 read-only regressions and seven actual local-EVM history cases per token. The three token repositories reject removed or pending events, uint256 overflow and conflicting event identities. Their history reports retain block hashes and explicitly mark canonicality and completeness as unverified. The Wallet's 24 integration cases per token and synthetic browser tests remain enabled.

### History block changes and hash-pinned allowances

[Phase 7 validation](docs/VALIDATION_PHASE7_2026-10-21.md) updates the token pins to 120 read-only cases and 10 local-EVM history cases each. The history readers compare event hashes with provider headers and recheck the sampled end block and network, including empty histories. Approval allowance reads now use a canonical block hash. Actual local chain advancement and rollback tests verify preserved snapshot values, rejection on observed replacements, and successful fresh reads.

These provider checks do not independently prove canonicality or complete history. Range-based log queries can omit events, and temporary reorganizations that return to the original chain are not fully detected. Real-RPC and real-Wallet compatibility remain unverified.

### Provider access loss without events

[Phase 8 validation](docs/VALIDATION_PHASE8_2026-10-21.md) adds 52 offline regressions (248 total) and six local-EVM cases per token (30 each). Read failures with numeric EIP-1193 codes `4100`, `4900` or `4901` invalidate the current session and require explicit reconnection, even without a provider event. A delayed failure from a previous connection cannot disconnect a new one. Other errors preserve the connection and are returned without automatic retries or an unpinned fallback.

The card clears results when any pending read invalidates its shared session, including a superseded read. CI runs 13 synthetic Chrome UI cases and two HTTP isolation cases; the EVM matrix retains the Phase 7 token versions. These tests use no real Wallet or external RPC and do not establish completed Aerodrome login or production dApp compatibility.

### Read deadlines and immediate local cancellation

[Phase 9 validation](docs/VALIDATION_PHASE9_2026-10-21.md) adds a 30-second deadline to each provider request during connected-session reads, including account/chain prechecks. Timeout returns `READ_TIMEOUT`, invalidates the session and clears the report. Disconnect also settles pending reads immediately with `SESSION_CHANGED`. Successful, rejected and cancelled reads clean up their timers; late provider outcomes cannot update a reconnected session. No automatic retry or unpinned fallback is introduced.

The optional session constructor setting `readTimeoutMs` accepts integer milliseconds from 1 to 120000 and defaults to 30000. It applies per RPC, not to the total duration of a composite inspection or connection establishment. The human `eth_requestAccounts` prompt and connection-time probes are unchanged. EIP-1193 cannot cancel the underlying provider request; browser timer throttling or a blocked JavaScript event loop can delay a deadline. These are local waiting limits, not hard real-time or network cancellation guarantees.

Local validation passes 275 offline tests and 34 EVM cases per token (102 across all three). CI additionally runs 15 synthetic Chrome UI cases and two HTTP cases. Wallet CI pins the starting Phase 8 token main versions, while token CI pins this Wallet implementation. Solidity and deployment settings are unchanged.

### Connection establishment deadlines and outstanding permission requests

[Phase 10 validation](docs/VALIDATION_PHASE10_2026-10-21.md) extends waiting limits to every connection step. Chain/account probes default to 30 seconds per request; the human account-permission prompt has a separate 120-second local deadline. Timeouts and manual disconnect settle the pending connection, remove listeners and require explicit reconnection. Late replies cannot create a connected session or overwrite a newer one.

An outstanding `eth_requestAccounts` request remains guarded until the underlying provider promise settles. Another session or replacement card using that same provider object receives `PERMISSION_PENDING` without another RPC or permission prompt. The old prompt's late success does not automatically connect; the user must explicitly reconnect. This guard is shared within this loaded module, not across separate pages, bundles or provider wrappers. It cannot close a Wallet dialog or revoke permissions granted inside the Wallet.

Constructor settings are independent: `connectTimeoutMs` defaults to 30000 (integer 1..120000); `permissionTimeoutMs` defaults to 120000 (integer 1..300000); `readTimeoutMs` retains its previous meaning. Deadlines are per request and subject to JavaScript scheduling. No background retries, network switches or transaction methods are added.

Local validation passes 322 offline tests and 42 EVM cases per token (126 across the three). CI runs 18 synthetic Chrome UI cases plus two HTTP tests, and retains all token contract, permit, read-only and history regressions. Real-Wallet, live-RPC and completed external-dApp login compatibility remain unverified.

### External dApp compatibility with a synthetic provider

[Phase 11 validation](docs/VALIDATION_PHASE11_2026-10-21.md) reruns the official Aerodrome UI with two isolated provider-discovery configurations. The legacy `window.ethereum` path reaches account permission and the sign-in signature request, which is rejected with code 4001. Synthetic account revocation returns the site to its connect chooser; explicit reconnection returns to Sign-in. With EIP-6963 alone, an account query is observed but the connection permission flow is not reached. This is a measured limitation of this path, not proof of universal EIP-6963 non-support.

The mock now emits account changes, returns scoped permission metadata and supports listener cleanup. The probe accepts an EIP-2255 permission flow without requiring a redundant `eth_requestAccounts` call, while still checking the granted synthetic account and rejected signature. Offline regression tests total 349. Full real-wallet login, signatures, swaps, transfers, approvals and LP actions remain unperformed. See the [live diagnostic evidence](docs/phase11-external-dapp-evidence.json).

Run `npm run test:external-dapp -- --eip6963-only` to inspect discovery without a legacy injected provider. Neither diagnostic generates keys or signs messages.

### Why the EIP-6963-only external route does not connect

[Phase 12 investigation](docs/VALIDATION_PHASE12_2026-10-21.md) confirms that the observed Aerodrome build discovers the synthetic Wallet but trims the displayed connector list to its initially configured entries. Its Browser Wallet route uses the legacy `window.ethereum` provider. The announced Wallet therefore receives readiness account queries, but no permission request from that route, even after rediscovery and a second click. The external site was not modified; pure EIP-6963 connection there remains unestablished.

The diagnostic now records discovery and RPC phases, checks the public application asset fingerprint, and separates observed facts from source-based routing analysis. Three new Chrome cases confirm that ThreeCore's own selector connects without any legacy provider, accepts late announcements, and preserves the user's selected provider when others appear. Offline tests total 361; browser UI cases total 21. Run `npm run test:external-dapp -- --eip6963-only --diagnose-discovery` for the bounded live diagnostic. See the [cause evidence](docs/phase12-discovery-evidence.json). Real Wallet signatures and transactions remain prohibited.

## Local read-result identity verification

The local development version rechecks eth_chainId and eth_accounts after each block-header, native balance, token balance, allowance and contract-code read. If the provider silently changes networks/accounts while the read is pending, the session disconnects and does not return the sampled data. Post-read checks use the existing bounded request timeout and never request permissions, signatures or transactions. These checks cannot detect an unreported transient change that has already reverted before observation, nor independently authenticate a malicious RPC provider.

Offline regression: node --test test/postread-identity-guards.test.js. Unit tests demonstrate mock-provider behavior, not real-wallet compatibility or an independent security audit.

## Portfolio modules and browser interface

Use readPortfolioSnapshot(session, { tokens: [explicitContractAddress], signal, timeoutMs }) from src/portfolio-snapshot.js with an already connected read-only session. Results contain raw integer strings, block number/hash and code-presence notices. Contract addresses and decimals must be independently verified; code presence does not authenticate a token.

createPortfolioController() from src/portfolio-controller.js owns one application's refresh/cancel/clear lifecycle. It does not connect a wallet or persist data. encodePortfolioReport/decodePortfolioReport from src/portfolio-report.js serialize historical observations only. Imported reports cannot authorize connections or transactions. formatBaseUnits requires an explicitly supplied decimal count and never converts amounts through floating-point Number.

readAgentPortfolios from src/agent-portfolios.js requires exactly DAT, EMA and CAWELON with distinct connected accounts and explicit token lists. It returns all portfolios or rejects. Each portfolio pins a block, but the three portfolios are not an atomic simultaneous observation. The browser demo integrates individual portfolio reads, historical comparisons, token-plan preview/application and progress reporting. The three-agent coordinator remains a library API.

### Local workspace backup and restore (2026-10-23)

The local demo now combines all three cards into a single workspace backup:
public account/network settings, the single-token input, token lists and saved
historical observations. Restore starts with a preview and defaults to merging
history. Replacement that removes records needs a separate acknowledgement.
The detailed preview lists contract addresses and added/removed record identities.
A changed configuration disconnects that card; importing never grants connection,
signing or transaction permissions.

The coordinator checks for edits after preview, validates all cards before writing,
and attempts to return all local stores to their prior state after a write failure.
One undo is available while the page remains open and the restored data is unchanged.
If rollback fails, it retains a recovery draft for manual inspection and blocks
further restores. Recovery drafts are deliberately distinct from importable backups.

Workspace files contain a SHA-256 checksum for corruption detection. This is not
proof of authorship, ownership, a live balance, or an independent security audit.
Private keys, seed phrases, provider permissions and approval-spender inputs are
excluded. Public addresses and historical balances are included: share deliberately.
The demo does not automatically persist data when the page closes. Download the
backup and confirm its presence on disk before closing the page.

An offline read-back tool verifies an existing downloaded backup without restoring
it or contacting any network:

```sh
node scripts/check-workspace-backup.js --file path/to/ThreeCore-workspace-backup.json
node scripts/check-workspace-backup.js --file path/to/ThreeCore-workspace-backup.json --json
```

The CLI summary omits full public addresses and balances. Limits are three cards,
64 observations per card, 32 configured tokens per card and an 8 MiB file envelope.
The workspace browser tests use synthetic data; they do not establish that three
separate real wallets have been connected. The source is included in this publication; the demo and saved data remain local to the browser.
## Browser-local saved checkpoints (2026-10-23)

The wallet demo now offers an opt-in checkpoint panel for all three cards. It opens
IndexedDB only after **保存済みの控え一覧を読み込む** is clicked. Saving is explicit;
typing, connecting a wallet, or reading a balance does not automatically persist data.

1. Load the saved-checkpoint list, enter a name, and save the current three-card draft.
2. After reopening the same browser and origin, load the list and inspect a checkpoint.
3. Stage the inspected checkpoint into the existing workspace import panel. Preview
   the changes and confirm before applying. Restoring does not reconnect a wallet.
4. Save a separate file backup. The collection export includes names, archive states,
   settings, token lists, and historical observations for every saved checkpoint.

There are at most five checkpoints, including archived ones, with a combined payload
limit of 24 MiB. Each nested workspace file remains limited to 8 MiB. Names are limited
to 60 UTF-16 code units. Checkpoints are immutable snapshots; metadata can be renamed
or archived. An archived checkpoint can be returned to the active list. Permanent
deletion requires selecting an archived entry and checking a separate confirmation.
Deletion cannot be undone in this panel; retain a file backup first.

The collection importer verifies the outer checksum and every nested workspace file
before offering a review. Import is append-only. An identical ID and file is skipped,
retaining local metadata; an identical ID with different content rejects the whole
batch. Capacity or revision conflicts also reject the complete write. IndexedDB writes
use a single read/write transaction with an expected revision, so stale tabs cannot
overwrite a newer list. A stale result requires explicit refresh.

Public addresses and historical balances are stored **unencrypted**. Secret keys,
seed phrases, wallet permission state, and spender authorization are not saved.
Browser profiles, browsers, hostnames, and ports have separate storage. Private mode,
clearing browser data, storage eviction, or device loss can remove it. This feature
does not request persistent-storage permission or replace an independent backup.
Checksums detect accidental changes; they do not authenticate the creator or prove
ownership, current balances, contract safety, or an independent security audit.

Inspect a downloaded collection locally without importing or modifying it:

```powershell
node scripts/check-checkpoint-collection.js --file "C:\path\ThreeCore-saved-checkpoints.json" --json
```

The inspection report excludes labels, full account addresses, and balance values.
Test-only manual verification is served at `/test/browser/checkpoint-demo/` when the
server starts with `--ui-test`. It uses synthetic data, has no wallet provider, denies
network connections through CSP, and uses a different database from the normal demo.
Automated browser cases use unique `threecore-test-checkpoint-` databases and close
connections before cleaning up only their own test database. Production storage is
never opened by those cases. The normal demo remains at `/`.

Relevant checks are `node --test test/*.test.js`,
`node --test integration/*server.test.mjs`, and the complete `/test/browser/` suite.
`integration/token-compatibility.test.mjs` is a separate local-EVM harness that must
run from a compiled token repository, not from the wallet directory. This checkpoint
change does not modify any deployed contract or perform a blockchain transaction.

IndexedDB behavior references: [transaction lifecycle](https://developer.mozilla.org/en-US/docs/Web/API/IDBTransaction)
and [blocked upgrades](https://developer.mozilla.org/en-US/docs/Web/API/IDBOpenDBRequest/blocked_event).

### Local allowance observations

The DAT, EMA and CAWELON cards can now read existing ERC-20 allowances for up to
20 explicitly reviewed spender addresses. Each observation pins token identity,
balances and allowance reads to one block, rejects changed sessions/blocks, and
keeps failed reads unknown. No signing, approval, revocation or transaction method
is added. Search, filters, exact-amount comparisons, individual JSON files and a
combined three-token file are available. Imported records are historical and
do not reconnect wallets or replace the card configuration.

See [allowance observations](docs/allowance-observations.md) for the workflow,
file limits, offline checker and synthetic test routes. This publication includes the source; operation remains a local, read-only development workflow.

### Local transfer history (unpublished development)

The token cards also support bounded ERC-20 Transfer-event reads, precise amount
display, direction/search filters, reviewed JSON import, CSV export and same-range
comparison. A separate in-memory archive collects up to 12 compatible period
records and reports gaps between queried ranges. Save the transfer/archive JSON
before closing the screen; older workspace backups do not include these records.

See [transfer history](docs/transfer-history.md) for limits, trust boundaries,
offline verification and synthetic browser tests. This feature is read-only and
has not been published to GitHub as part of the current local development task.


### Three-token history vault (local development)

DAT, EMA and CAWELON histories can now be captured together, reviewed, saved in an
explicit browser-local list and restored after reopening. JSON backups cover both
the current working copy and the whole saved list. Per-token activity summaries,
filters and bounded working-copy undo/redo are included. Saving and restoration
are explicit; no wallet connection or transaction is initiated by the vault.

See [transfer history vault](docs/transfer-vault.md) for the workflow, file formats,
limits, privacy details, offline checker and isolated preview. Existing workspace
backups remain separate. This round remains on the PC and is not pushed to GitHub.


### Local balance/history reconciliation

The wallet demo now compares saved DAT, EMA and CAWELON balances with saved Transfer histories.
It includes interval-gap diagnostics, exact residuals, block summaries, reviewed JSON recovery, and CSV exports.
See [the Japanese user guide](docs/BALANCE_RECONCILIATION_JA.md) and [the design and test notes](docs/RECONCILIATION_DESIGN.md).
Run `npm run reconciliation:check -- saved.json --json` to inspect a backup without wallet access.


### Resumable historical period collection (local development)

The wallet can now collect balances at two explicit blocks and sequential Transfer
windows for DAT, EMA or CAWELON through an already connected read-only card.
Save completed steps as JSON, review an imported checkpoint, and explicitly resume
after rechecking its block anchors. Complete evidence can be reviewed in the
existing three-token reconciliation screen without replacing the other slots.

See [the period user guide](docs/PERIOD_COLLECTION_JA.md) and
[the design and verification notes](docs/PERIOD_COLLECTION_DESIGN.md).
Run `npm run period:check -- saved.json --json` for an offline file inspection.
The isolated preview at `/test/browser/period-demo/` uses synthetic data only.
This development remains on the PC; no GitHub publication is performed here.

### Saved period library (local development)

Named period checkpoints can now be saved explicitly in an origin-scoped PC-local
list. Reopen, filter, compare, rename, archive and review a checkpoint before
restoring it to the collector. New acquisition progress creates a new record.
Quarantined block-conflict records retain their restriction marker after restore.

Collection JSON backs up every entry, including archived records; filtered CSV
is an index only. A dedicated database keeps these records separate from the
workspace and transfer vault. No automatic save, provider connection or network
request is introduced by the library.

See [the saved-period guide](docs/PERIOD_LIBRARY_JA.md) and
[design and verification details](docs/PERIOD_LIBRARY_DESIGN.md).
Run `npm run period-library:check -- saved-library.json --json` for offline checks.
The synthetic preview is `/test/browser/period-library-demo/` in `--ui-test` mode.
This round remains local and has not been pushed to GitHub.


### Three-token historical period reports (local development)

Select one saved checkpoint per token to review exact balances, history residuals,
acquisition progress and shared-block hash consistency together. Partial, archived
and restricted evidence remains explicit. Reports are fixed historical snapshots,
not current wallet balances or a combined token valuation.

Reviewed JSON recovery recomputes conclusions from original evidence. CSV and
scriptless printable HTML summarize the accepted report. Replacement review shows
changed accounts, periods, hashes, acquisition progress and event evidence.

See [the Japanese report guide](docs/PERIOD_REPORT_JA.md) and
[design and verification notes](docs/PERIOD_REPORT_DESIGN.md).
Run `npm run period-report:check -- report.json --json` for offline checks.
The synthetic preview is `/test/browser/period-report-demo/` in `--ui-test` mode.
This work remains local and has not been pushed to GitHub.

### Saved report history (local development)

Keep named three-token report snapshots with notes and tags, reopen them after
review, and compare their evidence and period boundaries. Optional source
inspection shows whether the original acquisition checkpoints still match the
PC-local library. It never changes the captured report or rechecks a live chain.

Back up all reports, including archived records, in checksummed JSON. Restoration
adds new reports, retains existing annotations and blocks same-ID conflicts until
reviewed. Origin-scoped IndexedDB storage has a 12-report / 64 MiB limit.

See [the Japanese history guide](docs/REPORT_HISTORY_JA.md) and
[design and verification details](docs/REPORT_HISTORY_DESIGN.md).
Run `npm run report-history:check -- backup.json --json` for offline diagnostics.
The synthetic preview is `/test/browser/report-history-demo/` in `--ui-test` mode.
This work remains on the PC and has not been pushed to GitHub.

### Shared file import protection (local development)

Wallet imports now share one page-wide admission budget: up to four unfinished
reads and 128 MiB of declared input sizes, while each format keeps its own size
limit. Cancellation rejects the waiting operation promptly; its reservation is
released only when the underlying read settles. Late content is discarded.

Strict UTF-8 decoding, exact byte counts, captured source methods and bounded
deadlines protect the input boundary before existing format-specific validation.
The main screen shows aggregate counts and can stop pending file reads without
changing saved wallet data. It does not display filenames, paths or contents.

See [the security design and verification guide](docs/FILE_IMPORT_SECURITY_2026-10-24.md).
The synthetic walkthrough is `/test/browser/file-boundary-demo/` in `--ui-test`
mode; the focused browser suite is `/test/browser/?suite=file-read`.
The checks use synthetic inputs and do not constitute an independent audit.
This work remains local and has not been pushed to GitHub.
