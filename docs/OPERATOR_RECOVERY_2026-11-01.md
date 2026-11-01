# Operator recovery observation — November 1, 2026

Microsoft Edge completed a file-based save, preview, cancellation, confirmed
restore and re-export of the existing **fictional operation rehearsal**. The
original and restored exports are byte-for-byte identical. This closes this
specific rehearsal recovery check, not real-wallet acceptance.

## Environment and source scope

The observed application was the existing `http://127.0.0.1:4231/rehearsal/`
page on the intended Windows PC. Its server and original working tab were not
restarted or reloaded. The checkout was based on
`d9f0eb05ac3c4694b1240811d88747416099befa`, with the connection-message and
operator-documentation follow-up uncommitted. This records the observed local
development state; it does not claim an immutable release-candidate deployment.

The [operator observations](evidence/2026-11-01-operator-recovery/operator-observations.json)
are a transcription of browser UI/actions observed during the session. No
screenshot or automated replay of this recovery cycle was saved. The downloaded
bytes and their structural inspection are available separately for reproduction.

## Save and restore results

1. Saved the original tab with **履歴とケース集をまとめて保存**. A tool-level
   download-event waiter timed out, but the new file existed on disk and was
   verified. The save was not repeated without checking that result.
2. Opened a separate empty rehearsal tab. Selected the downloaded JSON through
   the ordinary file chooser. Its preview showed three ledgers and three cases;
   nothing had been applied yet.
3. Cancelled the preview. The new tab remained empty and the restore control
   was disabled.
4. Selected the same file again, reviewed it and explicitly confirmed restoration.
   The UI showed six confirmed records and three comparison cases.
5. Saved a second export from the restored tab and compared both files. The
   original working tab and both downloaded originals were retained.

| Property | Original export | Restored export |
| --- | --- | --- |
| Saved time, JST | 2026-11-01 21:34:37 | 2026-11-01 21:36:58 |
| Bytes | 17,387 | 17,387 |
| DAT / EMA / CAWELON records | 3 / 2 / 1 | 3 / 2 / 1 |
| Comparison cases | 3 | 3 |
| Simulation only | true | true |

Both files have SHA-256:

```text
22c7909969a4221d443d8452cefb4e147fa796782f9ef7ce50462cb6ea4d8f9c
```

Evidence:

- [Original export](evidence/2026-11-01-operator-recovery/original-session.json)
- [Restored export](evidence/2026-11-01-operator-recovery/restored-session.json)
- [Byte comparison](evidence/2026-11-01-operator-recovery/byte-verification.json)
- [Existing session checker's inspection](evidence/2026-11-01-operator-recovery/inspection.json)
- [Checksums for all six artifacts](evidence/2026-11-01-operator-recovery/SHA256SUMS.txt)

All addresses in these rehearsal files are the existing repeated-digit dummy
addresses; the asset is SIM. No live wallet balance or account permission was
used to perform the restoration. A browser reload of the restored tab was not
part of this observation.

From the repository root:

```sh
node scripts/verify-evidence-manifest.js docs/evidence/2026-11-01-operator-recovery/SHA256SUMS.txt
node scripts/check-rehearsal-session.js docs/evidence/2026-11-01-operator-recovery/original-session.json
node scripts/check-rehearsal-session.js docs/evidence/2026-11-01-operator-recovery/restored-session.json
```

## Connection guidance and bounded source review

Wrong account, wrong network and missing account permission now have static
Japanese instructions in `wallet-card-controller`. Only those three messages
changed; account matching and connection permissions were not relaxed. The
existing controller and connection-boundary tests passed **66 / 66**, with no
failures or skipped cases ([log](evidence/2026-11-01-operator-recovery/focused.log)).
The [Japanese operator guide](OPERATOR_ACCEPTANCE_JA.md) follows the actual
control labels for account selection, preservation, backups and restoration.

A limited source review traced these existing boundaries:

| Path inspected | Enforcement / existing regression evidence |
| --- | --- |
| `wallet-session` connection request | `#requestConnect` applies `guardRpcRequest` before dispatch. Only this path permits the fixed `eth_requestAccounts` request. The pending-permission guard prevents another prompt while the first remains unsettled |
| `wallet-session` wallet and alternate state-provider reads | Both dispatch paths pass through `#requestRead` and the same request guard. Chain, account and connection-generation checks surround reads; obsolete results cannot become a current observation |
| `security-rpc` method and call filters | The method allowlist rejects signing and transaction submission. `eth_call` accepts only the supported metadata/account-bound getters; it rejects transfer/approval selectors and additional transaction fields. Transfer-log filters require the selected account and catalog token |
| Wrong identity and stopped view | `connection-boundaries.test.js` rejects the wrong account and stale reads; `view-stop-delivery.test.js` checks that stopping while publishing a view cannot leave the cancelled result displayed |

The relevant security and lifecycle suites were included in the successful
[CI run on the preceding source](https://github.com/FordPerfect2027/ThreeCore-Wallet/actions/runs/41306291181).
This is a developer self-review of these paths, not an independent security
audit of the final candidate, browser extension or token contracts. No new
critical finding was identified in this bounded review; the remaining release
gates stay visible in the [readiness record](RELEASE_READINESS_2026-11-01.md).
