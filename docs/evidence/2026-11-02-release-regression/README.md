# Local release regression evidence — November 2, 2026

Application source: `97dae0f43104ec80ae387e671a86389db9156aad`.
Final test/guide revision: `c36ce33f16bfb42dc099324382281300ba9c9f30`.
`source-scope.json` records the exact four changed paths; application/server and
integration sources are unchanged. No GitHub publication occurred.

| Artifact | Outcome and scope |
| --- | --- |
| `node-complete.log` | Exit 0; 16,445 tests passed, none failed/cancelled/skipped; 537,050.9589 ms |
| `browser-complete.log` | Exit 0; 1,019 synthetic UI cases in two fresh profiles, 510 + 509; cleanup completed; no external RPC |
| `deadline-focused.log` | Exit 0; 91 deadline/format cases; overlaps the complete Node result |
| `token-DAT.log` | Exit 0; 50 local-EVM cases |
| `token-EMA-Draft.log` | Exit 0; 50 local-EVM cases |
| `token-CAWELON-Draft.log` | Exit 0; 50 local-EVM cases |
| `compile-*.log` | Each build command exited 0 with no contracts needing compilation; existing artifacts reused |
| `fresh-startup-97dae0f.json` | Ten successful HTTP/startup checks from a fresh export; its own server closed; not a browser/wallet test |
| `public-pr4-readonly.json` | Read-only observation of the already published PR head and five successful jobs; no new remote validation |

Commands, run from the Wallet checkout:

```powershell
node --test --test-timeout=60000 --test-concurrency=2 test/*.test.js integration/*-server.test.mjs integration/local-navigation-help.test.mjs
node scripts/test-browser-ui.js
node --test test/file-read-formats.test.js test/file-read-deadline.test.js
node docs/evidence/2026-11-02-release-regression/deadline-reproduction.mjs
```

The token jobs ran `npm run compile` and the Wallet's
`integration/token-compatibility.test.mjs` from each token checkout. They cover
chain IDs 8453 and 84532 in local EVMs, without public transactions. Source pins:

- DAT: `e0215f1a32824c19bcc89da96841e758928f4f29`
- EMA: `362db49dcc5d5db5560b71ed5acd19bba326575e`
- CAWELON: `c62f63370f7bcbe559d07b4d757384cf5f43ff0f`

## Retained failures and reproduction

`node-initial-failure.log` exited 1: 16,444/16,445 passed. The caller-deadline
allowance test wrongly expected a retained worker even when timeout could occur
before the underlying read started. `deadline-reproduction.mjs` reproduces this
path with synthetic delayed metadata; `deadline-reproduction.json` records the
result. Timeout counters and actual reservation accounting now decide the
adapter assertions, with existing injected-clock cases verifying both branches.
No timeout or product guard was relaxed.

`browser-initial-shutdown-failure.log` exited 1 after the first shard reported
510 passes. Shutdown did not complete within its deadline, so the second shard
never ran. Its temporary profile was retained. The identical browser harness
later passed both shards and cleanup in a separate run, after the heavy suites
finished. The earlier shutdown failure's cause remains undetermined.

Logs are copied unchanged. Actual account addresses, saved account files and
private PC observations remain in Downloads, outside these committed artifacts.
The synthetic empty-database recovery case does not prove intended-PC recovery
using actual account files. Three distinct real-account testnet acceptance,
independent review and a release decision remain outstanding. These counts are
not development percentages or a claim of token safety.

See [the detailed local record](../../RELEASE_REGRESSION_2026-11-02.md).

## Later distribution checkpoint

[The d904442 distribution record](DISTRIBUTION_D904442.md) verifies the combined Wallet/token source and fresh minimal-runtime restoration. Its narrower package checks do not replace or rerun the earlier full regressions above.
