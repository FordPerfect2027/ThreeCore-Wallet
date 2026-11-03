# Rehearsal readability and navigation: items 436–437

Source: `ce12d98`.

- **436 — Bounded, readable discrepancy previews.** Both report and evidence detail previews wrap long uninterrupted values inside their section, keep exact text, and use a bounded vertically scrollable area. A markup-shaped value stays plain text. The focusable preview remains usable after selecting a difference.
- **437 — Keyboard destinations for rehearsal links.** Existing navigation and file-format guide links move focus to their destination while retaining native fragment navigation. A direct evidence link opens the containing disclosure. Modified clicks and previously cancelled navigation retain browser behavior. Disposal removes listeners. Heading targets are programmatically focusable; the evidence summary remains a normal Tab stop.

## Checks

- Focused navigation, page and local-server checks: 127 passed, zero failed/skipped/cancelled, 3,980.1755 ms.
- Related rehearsal/server checks: 1,361 passed, zero failed/skipped/cancelled, 44,932.9531 ms.
- Native Chrome: 865 passed. New cases measured exact long-text containment at a 360 px container width, vertical scrolling and detail focus; traversed all 18 links across 10 destinations; opened the evidence disclosure; verified unchanged synthetic session output and inert disposed listeners.

[Evidence](evidence/2026-10-31-rehearsal-readability-navigation/) contains completed logs, the tested HTML/CSS snapshot, capture metadata and SHA-256 manifest. Source and tests remained fixed during checks. The latest full-wallet checkpoint is still item 431, 14,726 tests; this batch uses scoped and native verification. Checksums establish consistency only. No user-browser reconnection, real-wallet action, external RPC, key access, existing-server restart, publication or deployment is claimed or performed.
