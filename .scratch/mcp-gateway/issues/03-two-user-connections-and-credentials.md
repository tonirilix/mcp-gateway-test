# 03: Two-user connections and credentials

**What to build:** The seeded standard and admin users can sign in to the portal, configure their own mock service credentials, and use separate gateway tokens with the MCP test client. A call reaches the downstream application under the calling user's identity.

**Blocked by:** 02: Second integration and portal catalog.

**Status:** resolved

- [x] Both seeded users can sign in locally and see their own integration connection status; neither can view the other's credential values.
- [x] Each user can configure a credential for an integration, and the mock downstream server can distinguish which user's credential was used on a call.
- [x] The MCP endpoint rejects missing or invalid gateway tokens and does not use one user's downstream credential for another user's call.
- [x] Gateway token storage is non-reversible, downstream credentials are encrypted at rest with a key outside the data store, and the portal never returns a stored credential value.
- [x] An end-to-end check demonstrates separate users through the public portal and MCP surfaces.
