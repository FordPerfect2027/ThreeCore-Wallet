# Prepare a past observation's contract list for reviewed reuse

Item 585. Source: 02e7ae2.

History management can hand the selected record's contract list to the existing token-configuration review panel. The draft contains only schema, agent, chain and contract addresses; it carries no account or balance. Missing-code contracts are retained as requested historical inputs, not asserted to exist now. The current card's agent and chain must match. The draft receives keyboard focus while the current token input, observation and archive stay unchanged.

Existing explicit preview and apply controls remain required. Applying replaces the input list and clears the previous current result; it does not automatically read a balance or connect a wallet. Context is checked again during preview/application. Staging retires delayed file reads, clears old apply eligibility, rejects malformed/getter-based plans and preserves prior draft text on validation failure. Reentrant invalidation, disposal and unconfirmed callbacks cannot claim a completed handoff.

102 related checks passed (2673.4938 ms); 139 focused native browser file-read cases passed. [Evidence](evidence/2026-11-01-history-token-reuse/) captures the source history, exact configuration-only JSON and staged/applied state. The native check verifies focus, unchanged current observation while staging, explicit preview/application and no extra provider read. The source archive remains unchanged throughout.

Last full-browser checkpoint: b3254c9 (986 cases). Last full-wallet: d253e8d (15,720 tests). These synthetic/native-browser checks do not establish OS-picker use or a real-wallet connection. No existing-server restart, external RPC, signature, transfer, approval, private-key retrieval, publication or deployment occurred.
