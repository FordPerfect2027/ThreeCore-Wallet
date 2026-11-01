# History CLI input validation and redaction

Each token's full read-only suite passed 213 cases, including 19 history CLI
and input cases. The prior 194 cases overlap this result. Test concurrency was
limited to two. Actual child processes and viem HTTP decoded known positive
Transfer/Approval events against an isolated mock RPC; default empty history
was also checked. A historical Approval of 5 and sampled allowance of 1 remain
distinct facts. Tests never contact a public network or use a real wallet.

The unchanged DAT base CLI files were exported from commit
62dee6aba8a092e179643e0e4b19d53473cd6e67 and exercised with the new assertions.
Each made three mock RPC calls for an invalid 2,001-block range. Both expected
baseline failures are retained. The corrected commands make zero requests for
that input. The method snapshot contains local path constants and requires
adjustment before reproduction; dependencies were reused. The added parser
was imported by the test file, not by the baseline commands.

No new live history scan, completed real-wallet UI acceptance or independent
review is claimed. The change is at CLI input/error/transport policy boundaries;
history event validation, canonical header checks, contracts and dependency
locks were unchanged. Existing package 7d58d08 predates this follow-up.
