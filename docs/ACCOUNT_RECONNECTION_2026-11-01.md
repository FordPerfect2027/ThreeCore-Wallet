# Resume an already permitted wallet account — November 1, 2026

The connection form previously required an address to be entered before Connect,
even when the wallet already exposed an account to this site. After a protection
stop, the form could retain an older account's address while the operator had
selected another account in MetaMask. Asking the operator to copy the address
each time was unnecessary friction.

Each card now provides **Walletの許可済みアドレスを確認** beside the address field.
It reads existing site permission and previews the first exposed public address
and network. **確認した公開アドレスを入力** repeats the read before applying it.
Only the later **接続** action connects the card. The existing wrong-account
and chain checks remain in force.

## Scope and protections

- The probe calls only `eth_chainId` and `eth_accounts`, twice each. It neither
  requests additional permission nor reads balances, signs, sends, switches
  chains or reads wallet internals. It uses the chosen provider on the existing
  page origin; no new server endpoint or alternate browser origin was added.
- The existing RPC guard, result bounds, timeout/capacity supervisor and page
  protection gate apply. Provider events, changed form inputs, cancellation,
  disposal and late results invalidate the operation. Outstanding provider
  work still consumes capacity after the local wait is cancelled.
- Preview alone changes no configuration. Apply verifies the preview again,
  rejects chain mismatch and duplicate agent addresses, and changes only the
  selected card's address. Existing saved histories remain intact.
- A returned address is an observation of site permission, not proof of ownership
  or of a wallet's human-readable account name. Unpermitted or locked wallets
  return no usable account and are not automatically unlocked or prompted.
- Global Stop also clears these previews. Resume does not issue a probe or
  reconnect automatically. The idle and hidden-page protection settings were
  not weakened.

## Verification

- **116 focused cases passed**, including existing controller, connection,
  setup and protection-panel tests and 16 new account-probe cases. The latter
  cover empty permission, unsupported/changed chain, changed account, malformed
  response getters, stopped access, cancellation, deadlines, preview/apply and
  private error-message suppression.
- **1,004 synthetic browser UI cases passed** in two isolated profiles. Three
  new full-application cases check preview → apply → explicit Connect, global
  Stop/Resume and duplicate-card rejection. No real extension or external RPC
  is involved in that suite.
- [Focused log](evidence/2026-11-01-permitted-account/focused.log),
  [browser log](evidence/2026-11-01-permitted-account/browser.log), and
  [SHA-256 manifest](evidence/2026-11-01-permitted-account/SHA256SUMS.txt)
  are published. The PR's CI result identifies the final public source revision.

## Intended-PC observation

In Microsoft Edge on the existing port 4231, MetaMask exposed one permitted
address on Base Mainnet. The operator had reported selecting Account 1. The new
controls previewed and applied that address, and the EMA card connected without
the operator copying an address. The application then read EMA's registered
contract metadata and balance at canonical block **53,374,780**; the registered
metadata matched.

The identity JSON and settings JSON were saved as actual files and checked with
the existing parsers. A named browser checkpoint preserved the selected address
and chain. After a real page reload, the checkpoint was reviewed and restored:
the card remained disconnected until Connect was pressed. Manual Stop then
cleared the live connection, retained the configured address and disabled the
account probe; Resume alone left the card disconnected. A subsequent explicit
Connect succeeded again.

The live address, balance, screenshots and local restart note remain on the
operator's PC. The public evidence above contains synthetic test data only.
The original running server was not restarted. This is one account on Base
Mainnet; it does not complete the three-distinct-account public-testnet gate or
independent security review. See the [release gates](RELEASE_READINESS_2026-11-01.md).
