# Inspect saved token input configuration without treating it as a balance record

Item 576. Source: f0f871a.

The shared saved-file guide and batch inspector now recognize token input lists. The existing strict token-plan decoder checks schema, exact fields, agent/network, distinct contract addresses and the 8,192-character bound. The resulting structure-only inspection binds the original text to SHA-256 and reports one configuration, its token count and its agent. It records no accounts or balance observations, contains no original addresses, and does not claim an internal checksum, authenticity, restoration, current chain state or execution permission.

Valid lists participate in existing plain-JSON difference location inspection and portable batch evidence; invalid lists remain invalid and structure-only rows never become authenticated original records. The existing offline saved-file command returns the same result with exit 2 for structure-only verification. The guide provides the correct card instructions. Navigation for token lists and existing portfolio/history formats reaches the card section only; selecting and applying the original file remain separate actions.

66 related tests passed (4671.9461 ms); 134 focused native browser file-read cases passed. The live wallet demo test exercises all three card navigation targets, confirms input fields stay empty and records zero provider calls. [Evidence](evidence/2026-11-01-token-plan-inspection/) contains exact source files, inspection, difference locations, a mixed valid/invalid batch and captured equal UI/API/CLI results. Renaming a file does not change format detection. Native tests use synthetic files/providers, not the user's wallet or OS picker.

Last full-browser checkpoint: 431dcfd (980 cases). Last full-wallet checkpoint: d253e8d (15,720 tests). No existing-server restart, external RPC, signature, transfer, approval, private-key retrieval, publication or deployment occurred. This extends independent inspection to a previously unsupported configuration type; it is separate from item 573's direct save/load/apply workflow and is counted once.
