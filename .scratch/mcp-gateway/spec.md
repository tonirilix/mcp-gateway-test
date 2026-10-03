# Standalone MCP gateway learning project

Status: ready-for-agent

## Problem Statement

I used an MCP gateway that let coding agents connect once and use tools from several applications. I could browse integrations and configure or authenticate to them in a website, but I do not know how that gateway implemented discovery, routing, identity, or operations. I want a standalone project that teaches those patterns through real MCP interactions and is credible to explain in an interview. The gateway should be understandable locally before it is deployed or connected to my separate Agent Lab project.

## Solution

Build a local gateway with one HTTP MCP endpoint, two fictional downstream MCP servers (GitLab and Analytics), a small MCP test client, and a modest management portal. The gateway discovers downstream tools through MCP, exposes stable namespaced tools to each authenticated user, and routes calls to the appropriate server using that user's integration credential. Users can connect integrations and opt into tools individually. The portal makes tool behavior, eligibility, connection state, calls, and failures visible. The system records enough audit and trace information to explain each call without recording secrets.

## User Stories

1. As a learner, I want one local command or documented sequence to start the system, so that I can demonstrate it reliably.
2. As a learner, I want a small MCP test client, so that I can inspect protocol behavior without an agent model obscuring the result.
3. As an MCP client, I want one gateway endpoint, so that I can reach tools from multiple applications through one configuration.
4. As an MCP client, I want to authenticate as a particular gateway user, so that discovery and calls use that user's access.
5. As an MCP client, I want to list available tools through MCP, so that I can discover the tools I can currently call.
6. As an MCP client, I want stable application-prefixed tool names, so that tools from different servers cannot collide.
7. As an MCP client, I want each tool's description and input schema preserved, so that I can call it correctly.
8. As an MCP client, I want a call to reach the correct downstream MCP server, so that the gateway behaves as a real protocol intermediary.
9. As an MCP client, I want tool-reported errors distinguished from gateway or transport failures, so that I can interpret failures accurately.
10. As an MCP client, I want a clear result when a downstream server is slow or unavailable, so that a failed call does not hang indefinitely.
11. As a standard user, I want to see every integration and its discovered tools in the portal, so that I can decide what to connect and enable.
12. As a standard user, I want tools labeled as read-only or data-changing, so that I understand their behavior before enabling them.
13. As a standard user, I want to see which tools are admin-only, so that I understand why I cannot enable them.
14. As a standard user, I want to supply my own credential for each integration, so that calls use my downstream identity.
15. As a standard user, I want to see whether each integration is connected, so that I know which tools can be used.
16. As a standard user, I want every tool disabled by default for my account, so that I opt into only the tools I intend to expose.
17. As a standard user, I want to enable or disable eligible tools individually, so that my MCP tool list matches my choices.
18. As a standard user, I want to enable an ordinary read or write tool, including the mock issue deletion tool, so that opt-in is separate from read/write classification.
19. As a standard user, I want a denied call to stay denied even if I guess a tool name, so that tool-list filtering is not the only access check.
20. As an admin, I want to enable the mock Analytics user creation and deactivation tools, so that I can demonstrate an admin-only boundary.
21. As an admin, I want those user-management calls to affect only mock downstream data, so that the gateway's own accounts remain controlled outside the MCP tool surface.
22. As a portal user, I want a catalog refresh action, so that I can see newly discovered downstream tools.
23. As a portal user, I want an unavailable server and a stale catalog clearly marked, so that I do not mistake cached definitions for current service health.
24. As a portal user, I want a newly discovered or materially changed tool to require fresh opt-in, so that a changed tool does not inherit an old choice silently.
25. As a portal user, I want recent calls to show caller, tool, destination, duration, outcome, and correlation ID, so that I can explain where a call went and why it failed.
26. As a portal user, I want credential values hidden after submission, so that the portal does not reveal stored secrets.
27. As an operator, I want authentication and authorization checked on every MCP request, so that users cannot borrow another user's catalog or credentials.
28. As an operator, I want audit records for successful, denied, and failed calls, so that behavior can be reconstructed during a demo.
29. As an operator, I want timeout and downstream-unavailable cases in the test client demo, so that the gateway's failure behavior is visible.
30. As a future integrator, I want the gateway's MCP behavior to be independent of Agent Lab, so that Agent Lab can be connected later without changing the learning project's core design.

## Implementation Decisions

- The first version runs locally. It uses TypeScript and Node. Hono supplies the HTTP shell and portal API; the official MCP TypeScript SDK handles MCP protocol interactions. React supplies the portal.
- The gateway exposes a single HTTP MCP endpoint targeting the `2026-07-28` protocol revision. The first test client targets that revision. Supporting older clients is a later compatibility decision.
- The gateway and both fictional downstream applications use actual MCP tool-list and tool-call interactions. The first version aggregates tools only; prompts, resources, and extensions are outside its initial protocol surface.
- The downstream integrations are fixed and trusted for the first version. The gateway does not accept arbitrary user-supplied downstream URLs. Each mock server makes its tool catalog discoverable before an individual user connects; calls require that user's mock service credential. This is a prototype design choice, not a claim about the former employer's system.
- Discovery stores a last-known catalog for each integration. A refresh updates its availability and definitions. If refresh succeeds and a tool is removed, it leaves the effective tool list. If a server is unavailable, the portal can display the stale catalog with an explicit status; a call to a previously listed tool returns a bounded failure.
- Exposed tool names use a stable integration prefix. Routing uses a catalog mapping from exposed name to integration and original downstream name. A name is never used as an unchecked destination or URL.
- A new tool starts disabled for every user. A material definition change, such as a changed schema or curated behavior classification, requires fresh opt-in. The portal shows the discovered description and schema alongside the gateway's classification.
- Two gateway users are seeded: standard and admin. Each receives a separate gateway bearer token for MCP access and can store a separate credential for each integration. The portal has local sign-in; its browser session is distinct from the MCP bearer token.
- Every tool has a curated read/write behavior label and an eligibility rule. MCP tool annotations may inform display but do not grant access or decide whether a tool is safe. Ordinary tools, including the mock issue deletion tool, are eligible for both users. Mock downstream user creation and deactivation are admin-only. Users control a separate enabled flag for each eligible tool; all flags default to off.
- An effective tool requires a connected integration, user eligibility, and that user's enabled flag. The gateway evaluates these conditions for both tool listing and every call. A tool name that is absent or unauthorized cannot be invoked by guessing it. User-specific tool lists are private and avoid stale cross-user caching.
- GitLab offers mock issue listing, creation, and deletion. Analytics offers read tools plus mock user creation and deactivation. Both operate only on local demo data. The gateway's own user accounts are not administered through MCP.
- Tool calls use the calling user's downstream credential. Gateway tokens are stored as non-reversible hashes; downstream credentials are encrypted at rest with a key kept outside the data store. The portal never returns stored credential values. Secret values and tool arguments are excluded from default audit records and traces.
- Each request gets a correlation ID. Audit and trace records capture user, integration, exposed and downstream tool names, timing, and outcome. Outcomes distinguish denied access, downstream tool error, timeout, unavailable service, and protocol failure. A downstream tool result marked as an error is preserved as a tool result rather than falsely reported as a transport failure.
- Gateway-level per-call approval for writes is not part of version one. The calling client may enforce its own approval rules. Agent Lab's existing approval behavior must be reviewed before exposing gateway write tools to its agent.
- The portal displays integration catalog, tool metadata and classification, connection status, credential configuration, eligible toggles, refresh controls, and recent call records. An editor for admin eligibility policy is outside version one; the rule is configured with the gateway.

## Testing Decisions

- Use one local end-to-end test setup as the primary seam: start the gateway and both mock MCP servers, then exercise the public MCP endpoint with the small test client and the portal through its public UI or API. Tests assert externally visible behavior rather than private module calls.
- Verify real MCP discovery and routing: each exposed tool retains its expected schema, resolves to the intended downstream tool, and returns its downstream result.
- Verify two-user isolation: different gateway tokens produce the correct effective tool lists, per-user credentials reach the downstream server, and a guessed or disabled tool call is denied at call time.
- Verify tool policy: all tools initially disabled; an ordinary read, additive write, and issue deletion tool can be opted into by a standard user; Analytics user-management tools can be enabled only by the admin.
- Verify catalog changes: refresh discovers a new tool as disabled, removes a missing tool, and requires fresh opt-in after a material definition change. An unavailable server leaves a visibly stale portal catalog and produces a bounded call failure.
- Verify failure behavior: a downstream `isError` result, invalid arguments, timeout, unavailable server, and protocol failure have distinguishable client outcomes and corresponding audit records. Test that records and portal responses do not expose credential values.
- Verify the portal's main user journey through its public surface: sign in, view catalog and status, connect an integration, enable an eligible tool, inspect a call, and see an admin-only tool unavailable to the standard user.
- There is no prior test suite in this empty repository. The public MCP client and portal boundary is the project's initial test precedent; any narrower tests should address a concrete risk not covered at that boundary.

## Out of Scope

- Reconstructing the former employer's implementation or asserting where its Jira access was routed.
- A real GitLab, Analytics, or Jira connection; real service OAuth; enterprise single sign-on; or a production-ready external authentication provider.
- Remote deployment, multiple gateway instances, high availability, and a full administrator policy editor.
- Gateway account creation or deletion through MCP tools. The mock admin-only tools manage users inside the fictional Analytics application.
- MCP prompts, resources, Tasks, and other extensions; arbitrary third-party server onboarding; and automatic protocol translation between revisions.
- Agent Lab integration in this repository. It is a later milestone in the separate Agent Lab project.

## Further Notes

- The former company's observable behavior motivates this project, but its internal credential flow, discovery model, routing, and Jira integration remain unknown.
- Build in slices: (1) real MCP servers, gateway, and test client; (2) identity and per-user credentials; (3) tool policy; (4) catalog refresh, failures, audit, and traces; (5) portal. After the standalone demo works, test Agent Lab as a separate client integration.
- The official TypeScript SDK v2 documents the current HTTP handler and protocol eras: https://ts.sdk.modelcontextprotocol.io/v2/api/%40modelcontextprotocol/server/server/createMcpHandler.html and https://ts.sdk.modelcontextprotocol.io/v2/protocol-versions.
