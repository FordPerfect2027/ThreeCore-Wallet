# Choose history search results and save an individual observation

Items 578–579. Source: 5e0a3e8.

578. Filtered history rows can select the before/after observation directly in the existing comparison controls and move keyboard focus there. Sorted results retain their source archive indices. Selection alone neither compares nor deletes. Filter changes, replaced archives, stale revisions and disposed views retire the old controls; only a synchronous, current owner confirmation is accepted. Selecting a row clears the old comparison and clear-all confirmation.

579. The selected later observation can be downloaded as one strict portfolio report, including its original block identity and exact balances. It can be reused by the existing baseline-file workflow. This is separate from a whole-history backup and does not set the full-backup marker. Missing/stale selection or failed/asynchronous/reentrant delivery does not claim success. The integrated portfolio card forwards the same download adapter through its history panels.

192 related tests passed (3177.1229 ms); 136 focused native browser cases passed (31751 ms). The native integration checks focus, sorted source mapping, exact report text, unchanged current wallet state/history, stale row retirement and zero provider reads. [Evidence](evidence/2026-11-01-history-result-actions/) captures a 30/10/20 source archive sorted 30/20/10, selection of blocks 10→30, exact +20 base units and a standalone block-30 report. These are synthetic and native-browser checks, not an OS-picker or real-wallet acceptance test.

Last full browser: 431dcfd (980 cases). Last full-wallet: d253e8d (15,720 tests). No existing-server restart, external RPC, signature, transfer, approval, private-key retrieval, publication or deployment occurred.
