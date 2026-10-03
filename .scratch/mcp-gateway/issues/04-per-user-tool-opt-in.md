# 04: Per-user tool opt-in

**What to build:** Each connected user can enable or disable eligible tools one at a time in the portal. Their MCP tool list reflects that choice, and the gateway enforces the same rule when a call arrives, including calls to guessed names.

**Blocked by:** 03: Two-user connections and credentials.

**Status:** resolved

- [x] Every tool starts disabled for each user; a connected integration alone does not expose its tools to that user's MCP client.
- [x] The portal shows curated read/write behavior and lets a standard user opt into GitLab issue listing, creation, and deletion individually.
- [x] Enabling or disabling a tool changes only that user's effective MCP list; the other user's list remains independent.
- [x] A disabled, unconnected, or guessed tool call is denied at call time even if a client has an older tool list.
- [x] A public-surface check demonstrates both a successful opted-in call and a denied call.
