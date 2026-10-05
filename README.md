# MCP Gateway Test

A local learning project for an MCP gateway. Coding clients use one MCP endpoint to reach tools from two fictional applications, GitLab and Analytics. The gateway discovers each downstream catalog through MCP, gives tools stable application-prefixed names, and forwards calls through MCP. A React portal shows integrations, per-user connections, tool opt-in, catalog state, and recent calls.

This project uses the MCP `2026-07-28` protocol revision on both sides of the gateway. The downstream services hold only mock data. Jira and the separate Agent Lab integration are later work.

## Start locally

Requirements: Node.js 20 or newer and pnpm 11.9.0.

1. Run `pnpm install --frozen-lockfile`.
2. Copy `.env.example` to `.env`. Generate a 32-byte base64 key with `openssl rand -base64 32` and set `GATEWAY_ENCRYPTION_KEY`, `STANDARD_PASSWORD`, and `ADMIN_PASSWORD` in `.env`.
3. Run `pnpm dev` and open `http://127.0.0.1:5173`.

The single development command starts two mock MCP HTTP servers, the gateway, and the portal. The gateway is at `http://127.0.0.1:4100/mcp`. Keep the encryption key to reopen saved credentials. Local state and audit records live in ignored `.data/`. Changing the passwords in `.env` after first start does not change the seeded accounts; remove the local state to reset the demo.

To inspect the effective MCP tool list in a browser, run `pnpm inspector` in another terminal (Node.js 22.19 or newer). Open the URL it prints. The editable **local-gateway** entry is preconfigured for Streamable HTTP and the `2026-07-28` protocol. In its **Settings → Custom Headers**, add `Authorization` with value `Bearer <gateway-token>`, then connect and open **Tools**. Create the gateway token in the portal; Inspector settings are stored in ignored `.data/inspector-catalog.json`.

## Complete demo

1. Sign in as **standard**. Connect GitLab with `gl-standard` and Analytics with `an-standard`. These are fictional service tokens accepted only by the mock servers.
2. Enable `gitlab__list_issues`, `gitlab__create_issue`, and `analytics__list_issues`. Every tool starts disabled for each user.
3. Create a gateway access token in the portal and copy it when shown. Run the client with that token:

   ```sh
   GATEWAY_TOKEN=<standard-token> pnpm demo
   GATEWAY_TOKEN=<standard-token> pnpm demo analytics__list_issues '{"workspace":"sales"}'
   GATEWAY_TOKEN=<standard-token> pnpm demo gitlab__create_issue '{"projectPath":"team/demo","title":"Demo issue"}'
   ```

   The client lists the effective tools and prints each result with its correlation ID. A GitLab issue call reaches the GitLab mock; the Analytics call reaches the Analytics mock.

4. Sign out and sign in as **admin**. Connect Analytics with `an-admin`. Enable `analytics__list_users`, `analytics__create_user`, and `analytics__deactivate_user`, then create the admin's gateway token.
5. Call the admin-only tools:

   ```sh
   GATEWAY_TOKEN=<admin-token> pnpm demo analytics__create_user '{"name":"Casey","email":"casey@example.test"}'
   GATEWAY_TOKEN=<admin-token> pnpm demo analytics__deactivate_user '{"userId":"U-2"}'
   ```

   The portal shows those tools to the standard user but does not let that user enable them. They manage fictional Analytics users, not gateway accounts. GitLab issue deletion is an ordinary write tool that a standard user can opt into.

6. Inspect **Recent calls** in the portal. Each entry shows the caller, exposed and downstream tool names, integration, duration, outcome, and correlation ID. Tool arguments and credential values are not recorded.

To demonstrate an unavailable downstream server, stop `pnpm dev` and start the components in separate terminals using `pnpm dev:gitlab`, `pnpm dev:analytics`, `pnpm dev:gateway`, and `pnpm dev:portal`. Stop only Analytics, then click **Refresh tools** in the portal. Its last-known catalog is marked stale. Call a previously enabled Analytics tool with the client and compare the failure's correlation ID with **Recent calls**. A successful refresh after the server returns updates the catalog; new or materially changed tools start disabled.

Gateway read/write labels come from explicit policy entries. A discovered tool without a policy remains visible as unclassified but cannot be enabled or called. Portal sessions expire after eight hours on the server as well as in the browser.

## Verify

- `pnpm typecheck` checks TypeScript.
- `pnpm test` runs end-to-end tests through the public MCP and portal HTTP interfaces, including one complete demo scenario.
- `pnpm build` typechecks and builds the portal.

The gateway and mock servers bind to loopback. Their ports and URLs can be changed with `GATEWAY_PORT`, `GITLAB_PORT`, `ANALYTICS_PORT`, `PORTAL_PORT`, `GITLAB_MCP_URL`, `ANALYTICS_MCP_URL`, and `GATEWAY_MCP_URL` where applicable.
