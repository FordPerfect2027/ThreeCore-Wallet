# Encrypted workspace backup: local security iteration

This optional workflow protects an exported ThreeCore workspace file with a
passphrase. It is implemented in the local development checkout and has not been
pushed to GitHub. The preceding plaintext workspace format remains supported.

## User-visible behavior

The workspace section now includes a separate encrypted backup panel.
The user enters a passphrase twice and acknowledges that it cannot be recovered.
The panel clears both input fields immediately when preparation begins.
It prepares a file in memory, then enables an explicit download button.
It never silently substitutes a plaintext download after encryption fails.

To restore, the user selects an encrypted JSON file and enters its passphrase.
Opening the file validates its authenticated ciphertext and the inner workspace.
Nothing is applied at this point. A separate action places the validated data in
the existing workspace restore input. The existing change preview, confirmation,
replacement acknowledgement, transactional apply and undo still control writes.

The encrypted panel clears its inputs and pending content when cancelled,
invalidated, hidden, closed, or protected by the wallet's existing stop control.
Entered passphrases and unlocked restore candidates also expire after two minutes.
Typing resets the input timer. A completed decrypt or preview handoff begins a
new two-minute window. Browser timer scheduling is best effort; hide and page-exit
events provide additional immediate cleanup paths.

## Scope of the file

Included:

- DAT, EMA and CAWELON public account configuration.
- Selected Base or Base Sepolia chain configuration.
- Token contract configuration and token lists.
- Saved portfolio balance observations already in each card's history.

Not included:

- Private keys, seed phrases, browser extension passwords or signing authority.
- Active provider sessions, connection permission or transaction permission.
- Separate period report, allowance, transfer vault or report-history collections.
- Unrelated local files, browser storage, or prior plaintext backup downloads.

Restored observations remain historical records. They do not establish present
balances, chain finality, account ownership, or the accuracy of imported data.
Knowledge of the backup passphrase does not prove the sender's identity.

## Cryptographic format

The root object contains exactly four members:

| Member | Purpose |
| --- | --- |
| `schema` | Fixed string `threecore-encrypted-workspace-v1` |
| `kdf` | Fixed algorithm, hash, iteration count and fresh 16-byte salt |
| `cipher` | Fixed algorithm, key size, tag size and fresh 12-byte IV |
| `ciphertext` | Canonical padded base64 of ciphertext followed by authentication tag |

The parameters of version 1 are fixed:

- PBKDF2-HMAC-SHA256, 600,000 iterations.
- AES-GCM, a nonextractable 256-bit key, and a 128-bit authentication tag.
- A random 128-bit salt and random 96-bit IV for each encryption operation.
- Native WebCrypto and the platform cryptographic random generator.

The header is reconstructed in a fixed member order before JSON encoding as
UTF-8 additional authenticated data. It includes the schema, KDF settings and
cipher settings. Object member order and insignificant whitespace on disk can
change without altering the authenticated canonical header.

The native AES-GCM output contains its tag in the final 16 bytes. Ciphertext is
not compressed. A file's approximate payload size remains visible to an observer.
No account, balance, original filename or creation timestamp appears in the header.

The encrypted plaintext is the existing checksummed workspace-file envelope.
After AES-GCM succeeds, the inner UTF-8, JSON, schema, canonical workspace and
SHA-256 checksum are independently checked. The checksum is a compatibility and
corruption check; AES-GCM supplies passphrase-based ciphertext authentication.

### Passphrase handling

Passphrases must contain at least 12 Unicode code points and at most 1,024 UTF-8
bytes. All-whitespace input, control characters, and unpaired UTF-16 surrogates
are rejected. No trimming or Unicode normalization changes the supplied string.
Composed and decomposed Unicode forms are therefore different passphrases.

The minimum length is not a password-strength guarantee. A long, unpredictable
passphrase is still necessary because a stolen file permits offline guessing.
There is no recovery key, server escrow, reset endpoint or recovery service.

The derived key and PBKDF2 input key are nonextractable. The operation clears its
owned password and plaintext byte arrays in `finally` blocks. JavaScript strings,
browser internals, garbage collection and operating-system memory cannot be
reliably wiped by this code. Cleanup is best effort, not secure-memory erasure.

### Resource boundaries

- Encrypted input file: at most 12 MiB, checked before and during file reading.
- Decrypted workspace-file payload: at most 8 MiB.
- Envelope JSON: depth 4, at most 32 nodes, bounded key and number lengths.
- Duplicate keys, escaped duplicate keys, unsafe property names and unknown fields
  are rejected before any key derivation.
- KDF iteration values are fixed; file-controlled high-cost settings are rejected.
- Base64 validation is linear and rejects alternate alphabets, embedded whitespace,
  misplaced padding, nonzero unused pad bits and incorrect decoded lengths.
- One active crypto operation is allowed per JavaScript realm through a shared
  runner. There is no automatic queue or automatic retry.
- The default crypto deadline is 60 seconds. The caller can cancel promptly, but
  an uncancellable native operation retains the slot until it actually finishes.
- The bounded file reader has its own timeout and supports stream cancellation.

These limits constrain the app's own work. They cannot prevent a compromised
browser, malicious extension, independent tab or external process from using CPU.

## State and data boundaries

`secure-backup-format.js` performs envelope and passphrase validation.
`secure-backup-crypto.js` performs native encryption and decryption.
`secure-backup-runner.js` owns the single native-operation slot.
`secure-backup-controller.js` owns cancellation and staged candidates.
`secure-backup-panel.js` owns DOM input cleanup and user actions.

Controller notifications contain phase, static error code, byte counts and
capability flags. They contain no passphrase, account, balance, ciphertext or
decrypted workspace. The UI uses static messages and text nodes, not error HTML.
Unknown backend errors are reduced to stable local error codes.

The controller has no wallet provider, signing API, write-draft callback, network
client or storage adapter. Its sole restore capability is a synchronous staging
callback into the existing preview workflow.

Encryption captures a canonical draft fingerprint before awaiting native work.
Both completion and download recheck the current fingerprint. Decryption similarly
captures the target before work and rechecks before exposing a staged candidate.
Editing the target again after decrypt blocks the handoff. Invalidation clears all
pending state. Late asynchronous results cannot replace a new operation's state.

Downloads report that the browser was asked to start a download. They never report
that a disk write succeeded. Users must check the browser's download list and
retain the passphrase separately from the encrypted file.

## Threats addressed and limits

| Threat | Control | Remaining limitation |
| --- | --- | --- |
| Stolen exported file | Passphrase encryption | Offline guessing remains possible |
| Ciphertext/header modification | AES-GCM authentication | Does not identify who created the file |
| Valid encryption of malformed data | Inner workspace validation | Valid but false historical data can still exist |
| Resource-exhaustion file | Fixed KDF settings, file and parser limits | Browser and OS resource limits still matter |
| Repeated cancel/retry | Native slot retained until actual completion | Native WebCrypto itself cannot be aborted |
| Changed source or restore target | Fingerprint rechecks | User still reviews the final preview |
| Forgotten open restore candidate | Hide/stop/cancel/expiry cleanup | JS memory cannot be guaranteed erased |
| Error-message disclosure | Static codes and text-only UI | Debugging tools can inspect process memory |
| Accidental plaintext downgrade | Separate formats, no fallback | Existing plaintext files remain plaintext |
| Unintended restore | Separate decrypt, handoff, preview and apply | Explicitly applied history remains in the app |

The workflow does not defend against a fully compromised device, hostile script
already executing inside the app, a malicious extension reading input fields,
keyloggers, screenshots, clipboard monitoring or weak/reused passphrases.
It is not a third-party security audit, custodial wallet or mainnet release.

## Ordinary demo startup

Final verification found that the ordinary demo page still used an inline module,
which the previous strict `script-src 'self'` response policy correctly blocked.
The same startup lifecycle now lives in `examples/wallet-entry.js`, an explicitly
served same-origin module. No inline-script permission was added. Both the normal
page and the synthetic test harness were opened in the in-app browser. Server
regression tests now check that this startup/CSP combination stays compatible.

## Verification references

Unit tests include native cryptographic round trips, independent Node crypto
decryption, fresh-randomness checks, nonextractable-key checks, modified data,
wrong passphrases, malformed inner content, cancellation, delayed results,
resource boundaries, UI field cleanup and mixed event sequences.

The browser suite uses synthetic accounts, native File streams and WebCrypto.
It checks explicit preview/application and unchanged data on failure. Existing
wallet, restore, history and server regression suites also run locally.

The algorithm choices were checked against primary documentation:

- [MDN AES-GCM parameters](https://developer.mozilla.org/en-US/docs/Web/API/AesGcmParams)
  describes IV uniqueness and authenticated additional data.
- [MDN SubtleCrypto encryption](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/encrypt)
  documents the browser API.
- [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
  lists 600,000 iterations for PBKDF2-HMAC-SHA256. This native-browser file format
  uses that cost; it does not claim FIPS certification or that PBKDF2 is universally
  preferable to a memory-hard KDF.

Raw test results, line counts, local commit and backup hashes are stored outside
the checkout in the adjacent `wallet-secure-backup-verification-20261024` folder.
