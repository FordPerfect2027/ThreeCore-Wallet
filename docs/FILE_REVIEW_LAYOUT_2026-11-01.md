# Keep file review usable in narrow panes and by keyboard

Item 570. Source: 42a0f7e.

Wallet batch results and retained comparison tables now have named, focusable scroll regions instead of pushing the whole page wider. Rehearsal and independently reopened comparison tables use the same treatment. Long names, digests and JSON paths wrap inside bounded areas; tables retain readable columns and scroll within their own regions. Controls stay within their pane, checkboxes retain intrinsic width, buttons have a 44px minimum height and focus remains visible. Difference-location outputs are keyboard-focusable named regions. The rehearsal page now loads the existing shared stylesheet, with its original content-security restrictions intact.

49 selected behavior tests passed (6055.036 ms). 126 focused native browser file-read cases passed (31930 ms), including three new layout checks using actual DOM geometry in 320px panes, 105-character filenames, long JSON paths, native File/DataTransfer selection, focus and horizontal scrolling. These checks preserve the original negative classifications and full underlying comparison scope. They verify geometry and programmatic native focus; they do not claim a screen-reader audit or a complete manual visual audit.

[Evidence](evidence/2026-11-01-file-review-layout/) includes validation logs and an actual read-only probe of the existing 4231 server: the rehearsal page, shared CSS and changed module all returned HTTP 200 and their expected markers. The server was not restarted. This does not verify the user's browser tab or wallet connection. No signature, transfer, approval, private-key retrieval, external RPC, publication or deployment occurred.

The last full browser checkpoint remains 5b34eec (968 cases); the last full-wallet checkpoint remains d253e8d (15,720 tests). This is one combined narrow-pane/keyboard accessibility repair, not separate items for CSS selectors or individual assertions.
