# 08: Repeatable complete demo

**What to build:** A learner can run the finished local system and walk through one concise demonstration of real MCP discovery, both users, integration credentials, individual opt-in, admin-only tools, refresh, and traceable failures. The run is reproducible from a fresh checkout.

**Blocked by:** 05: Admin-only Analytics user tools; 06: Catalog refresh and stale state; 07: Traceable call failures.

**Status:** resolved

- [x] A fresh checkout can start the portal, gateway, both mock MCP servers, and test client using the documented setup and local configuration.
- [x] The documented walkthrough shows a standard and admin user with distinct effective MCP tool lists and credentials.
- [x] The walkthrough includes a successful call to each integration, an opted-in write, an admin-only user-management call, and a denied standard-user attempt.
- [x] The walkthrough demonstrates catalog refresh, an unavailable downstream server, and a portal audit record tied to a client-observed failure.
- [x] An end-to-end check through the public MCP endpoint and portal surface covers the complete demo without relying on private implementation details.
