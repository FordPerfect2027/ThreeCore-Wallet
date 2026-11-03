# Final package startup and fixed-version recovery — November 3, 2026

The standalone `ThreeCore-complete-4dfa300-20261103.zip` now has a verified
startup and browser recovery path after fresh extraction and source restoration.
The application, dependency pins and sealed archive were not changed by these
checks. This record supplements the [delivery receipt](ACCOUNT_REFRESH_DELIVERY_2026-11-03.md).

## Documented startup

The clean restored Wallet at `4dfa300aa2efc0b068ee5537df941282a21df1f4` was
started with its ordinary `npm run demo` command and `THREECORE_DEMO_PORT=4240`.
No dependency installation or browser-test mode was required. Original servers
4231, 4232 and 4233 and their working tabs were preserved.

The [startup probe](evidence/2026-11-03-final-startup/verify-restored-startup.mjs)
checked both entry pages and their literal JavaScript/CSS dependencies. All
219 served assets matched restored source bytes and the expected content types
and response headers. These are assets, not 219 new tests or completed features.
Four test/private routes returned 404 in ordinary mode. Cross-origin navigation
returned 403 with the explicit local opening link and no automatic redirect.
See the [recorded HTTP result](evidence/2026-11-03-final-startup/startup-result.json).

The first negative fixture failed because Node's `fetch` changed the requested
`sec-fetch-mode: navigate` header to `cors`. A separate local header receiver
confirmed this behavior. The fixture was corrected to use the same raw HTTP
request approach as the existing integration test; no application protection
or assertion was relaxed. The initial failure and header diagnosis are retained.

## Actual browser file recovery

The supported Codex in-app browser on the intended Windows PC completed this
sequence using new, empty tabs:

| Source version | File imported | File saved | Result |
| --- | --- | --- | --- |
| Final candidate `4dfa300`, port 4240 | Backup (36) | Backup (37) | Three cards, nine histories; exact original bytes |
| Prior fixed candidate `36ed431`, port 51031 | Backup (37) | Backup (38) | Three cards, nine histories; exact original bytes |
| Final candidate `4dfa300`, port 4240 | Backup (38) | Backup (39) | Three cards, nine histories; exact original bytes |

Each file was selected through the supported filechooser, checked, previewed
as three additions and zero removals per card, explicitly restored, and saved
through the browser. The downloaded files were then read from disk. All three
are 10,103 bytes with SHA-256
`6e4e79f3cb6efcb3cf49169779918e4bd6dd032b54a3c9d6af6d8cf5071e6c2a`.
Their configuration and nine histories match backup (36) byte-for-byte.

The [browser receipt](evidence/2026-11-03-final-startup/browser-version-return.json)
records file times, source pins and screenshot hashes. Original files and
screenshots remain in the user's Downloads directory, outside the repository.
The final restored tab is retained for the user.

This closes the fixed-candidate file return exercise that could not be completed
through the detached Edge automation tab. It does not claim a repaired Edge
extension connection, a new MetaMask exercise, native Windows picker traversal,
or compatibility with the older public `07041f0` checkpoint. No wallet provider
was detected in these tabs, and no connection or chain read was requested.

## Current technical checkpoint

The [source and evidence audit](evidence/2026-11-03-final-startup/checkpoint-audit.json)
separates completed technical work from remaining release decisions. The shared
helper repair, assigned developer review, connection-change handling, corrected
account summaries, full Wallet regression, actual file recovery and standalone
four-source restoration have supporting records. Current application/test files
match the fully tested implementation `7bdb23d`; the later token commits add
configuration tests and maintenance documentation without changing contracts
or dependency pins.

Publication and deployed scope remain separate from this local candidate.
Independent audit and a numerical overall mainnet-completion percentage are not
established by this checkpoint. This update does not turn asset counts, repeated
checks or elapsed time into a progress percentage.

The [manifest](evidence/2026-11-03-final-startup/SHA256SUMS.txt) fixes this
supplement's evidence. It postdates the sealed ZIP, which remains unchanged.
