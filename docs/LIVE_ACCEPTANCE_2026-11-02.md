# Intended-PC acceptance progress — November 2, 2026

After the operator selected the existing Microsoft Edge rehearsal tab, its
control connection responded. The existing MetaMask permission exposed one
account on Base Mainnet. Three token cards were explicitly connected to that
same existing account. No new account, funding, signature, approval transaction
or transfer was required. These are Mainnet read-only observations, not Sepolia
acceptance or three independent wallets.

| Token | Identity-read block | Saved portfolio block | Token balance, smallest units |
| --- | --- | --- | --- |
| DAT | 53,395,642 | 53,395,700 | 0 |
| EMA | 53,395,722 | 53,395,743 | 0 |
| CAWELON | 53,395,750 | 53,395,754 | 0 |

The identity reads matched the registered names, symbols and decimals, found
contract code, and passed the bounded supply/balance comparisons. Each JSON
records its own canonical block hash. They are separate block observations;
the displayed values are not an aggregate or a later/current balance claim.
This metadata check does not prove contract safety or exact deployed source.

## Save, restore, reconnect and stop

1. Saved each identity result, and added one newly read portfolio observation
   to each card's history. Saved the actual combined workspace to Downloads.
2. Opened a separate, empty Wallet tab through the rehearsal's same-origin
   link, leaving the source tab and original server running.
3. Selected the actual downloaded workspace through the documented browser
   file-chooser API. The checksum passed. The preview showed three settings
   changes, three added observations and zero removed existing observations.
4. Confirmed the preview and restored. All three cards remained disconnected.
   The UI comparison reported matching settings, token lists and full histories
   on all three cards. Re-exported the restored workspace.
5. Explicitly selected MetaMask and reconnected each restored card. Started a
   DAT read, observed it pending, then used the ordinary three-token Stop control.
   All cards became disconnected; the in-progress result remained unconfirmed
   after later inspection. Each accepted history remained at one observation.
6. Saved again after Stop. All three actual workspace files are byte-identical:
   **4,410 bytes**, SHA-256
   `17d16f8c10f571ba04b23be790640cab36ccbae5feeddca44e6a4433328ac989`.
   The resume control did not automatically reconnect any card.

The same session restored the pre-existing fictional rehearsal workspace into
the empty selected rehearsal tab: DAT 3, EMA 2, CAWELON 1 records. Its preview
was saved before applying. The re-export matched the original **4,771 bytes**,
SHA-256 `b3ab23fb3c2af4d1b88051fb6c976f2437bfc721b3a0e8764d965b80da770302`.
That simulation result is distinct from the actual-account observations above.

## Scope and retained evidence

Application source on disk was `96b59459a0f593246c60f0bed4b52052211a464a`;
the checkout was `e5841f0d1b412b516b3e3eb4a81d75eabaf81edd`, whose only later
code change is the [test-only native-crypto wait correction](NATIVE_CRYPTO_TEST_WAIT_2026-11-02.md).
Fresh client tabs loaded the current assets. The original port 4231 server,
PID 2108, started October 30 at 00:41:41 JST and was not restarted. Its already
imported server modules were preserved. This is not a complete fresh-candidate
server deployment or a test of the new relay limit on that original process.

[The local evidence summary](evidence/2026-11-02-release-regression/live-mainnet-acceptance-summary.json)
records checks, block hashes and file digests. Actual downloaded account files,
screenshots and the Stop observation are preserved under
`Downloads/ThreeCore-private-live-acceptance-20261102`. The summary omits the
account value; the recording method identifies the observed public account.
Checksums detect alteration; they do not authenticate provenance. The recording
method validates saved bytes and records observed UI actions; it is not an
automated browser replay or an independent audit.

Remaining: the two-existing-account switch, chain-switch behavior on the real
wallet, Sepolia acceptance, full candidate deployment/version return and
independent review. Native Windows picker traversal was not exercised: the real
files were selected through the browser's supported file-chooser API. These
results advance the file/reconnection checks without closing all release gates
or establishing a completion percentage.
