# Liquidity inputs and diagnostic command behavior — items 139–147

Source: `029d6a4` (local only). The existing liquidity calculation could accept a report for another quote token/factory, numeric block values, unbounded quantities and duplicate pool addresses. Several diagnostic commands also ignored extra arguments or contacted RPC when given help-like input.

## Completed work

139. Require the existing Classic factory and Base-native-USDC identities before labeling calculated reserves as USDC.
140. Require strict read-only, wallet-disconnected and Classic-factory flags and a canonical bounded block-number string.
141. Bound individual reserve/timestamp inputs to uint256 before integer conversion.
142. Reject repeated observed pool addresses across tracked tokens to prevent double counting.
143. Reject contradictory or invalid pool states while preserving absent/undeployed pools as unknown, including unknown aggregate totals.
144. Retain exact aggregate formatting for three maximum uint256 reserves, with a separate aggregate bound.
145. Validate arguments for all four public diagnostic commands before RPC, rejecting ignored extras, unknown flags and duplicate JSON flags.
146. Provide consistent offline `--help` and usage exit behavior without echoing invalid input.
147. Verify real command processes with an injected, non-forwarding transport: successful JSON/human output, unknown-reserve propagation, sanitized failure text and exit statuses.

## Verification

**32 tests passed, zero failed**, including 22 added tests. [Recorded run summary](evidence/2026-10-30-liquidity-inputs/verification.json) contains the command, observed counts and source revision. It is a structured transcription of the tool result, not a raw log.

```powershell
node --test --test-concurrency=2 test/liquidity-target.test.js test/public-diagnostic-cli.test.js
```

The process tests preload `test/helpers/public-diagnostic-cli-fixture.mjs`, replacing every fetch without forwarding. They exercise the actual scripts and their result formatting, including the entire pool-reader-to-liquidity-calculation path. No live balance or liquidity observation was made.

The initial process test harness used a Windows filesystem path for Node's ESM preload and failed before running the commands. Changing the preload to a file URL resolved the harness error; the final run passed all 32 tests.

## Compatibility and limits

Actual output from `inspectAerodromePools()` already contains the required identity and status fields. Hand-constructed incomplete reports that previously produced percentages now fail explicitly. An absent pool or a valid address without deployed code remains unknown; this is not converted to zero. A deployed pool with missing or invalid reserves is an error.

The existing 5,000-USDC target and ratio illustration were not changed. They remain planning arithmetic, not an instruction or quote for a deposit. Identity comparisons enforce the current manifest, not authenticity of a supplied report or safety of those contracts. Valid-looking fabricated data still requires independent source verification.

Command exits are 0 for success/help, 2 for invalid usage and 1 for inspection failure. Network defaults and existing supported positional arguments are unchanged. The test fixture is never imported by a production command.

No signatures, transfers, approvals, private-key retrieval, publishing or deployment occurred.
