# Response-body deadline evidence

See [the correction and scope](../../RPC_BODY_DEADLINE_2026-11-02.md).

- body-deadline-results.json: fixed token commits, changed-source hashes, runtime, initial failures and final complete results.
- body-deadline-*-serial.log: full 227-entry passing run for each token, including actual 12-second command checks.
- body-deadline-*-initial.log: simultaneous runs retained with existing child-process watchdog failures.
- body-deadline-*.patch: complete committed changes against each token included in the prior verified distribution.
- body-deadline-baseline.log and baseline-method.json: unchanged DAT source, corrected test harness, all five stalled commands stopped by the test watchdog.
- body-deadline-preliminary-*.log: original process-startup timing assumption; these preliminary failures are not used as proof of the body defect.
- body-deadline-diagnosis.log and .mjs: single-child timing observation used to distinguish startup from the request deadline.
- body-deadline-focused.log: successful focused transport and actual CLI tests after the harness correction.
- body-deadline-method.mjs: local collection/commit orchestration snapshot; it is not a general-purpose replay command.

Existing installed dependencies were reused; EMA and CAWELON resolve to the DAT dependency directory. No fresh installation, contract build, real wallet, public RPC, remote CI, independent review or publication is claimed. The older Sepolia deployment-artifact verifier is outside this five-command correction.
