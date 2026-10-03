# MCP Gateway Test

A local learning project for an MCP gateway. GitLab and Analytics are mock downstream MCP servers. The gateway discovers and forwards their tools through one endpoint, and a small test client demonstrates the route. Both network hops use MCP over HTTP with the `2026-07-28` protocol revision.

## Requirements

- Node.js 20 or newer
- pnpm 11.9.0

## Run the first slice

Install dependencies with `pnpm install --frozen-lockfile`. Copy `.env.example` to `.env`, generate a 32-byte base64 key with `openssl rand -base64 32`, and set `GATEWAY_ENCRYPTION_KEY`, `STANDARD_PASSWORD`, and `ADMIN_PASSWORD` in `.env`. The key must be kept to reopen the local credential store.

Run these commands in separate terminals, in order:

```sh
pnpm dev:gitlab
pnpm dev:analytics
pnpm dev:gateway
pnpm dev:portal
```

The mock servers listen on `127.0.0.1:4101` and `127.0.0.1:4102`; the gateway listens on `127.0.0.1:4100`. Open the portal at `http://127.0.0.1:5173` and sign in as `standard` with the password from `.env`. Connect GitLab with the fictional token `gl-standard` (the admin's is `gl-admin`). Analytics uses `an-standard` or `an-admin`.

Create a gateway access token in the portal. The token is shown once; copy it, then run the test client in another terminal:

```sh
GATEWAY_TOKEN=<paste-token> pnpm demo
```

The client connects only to the gateway, lists the namespaced tools, and calls GitLab for `team/demo`. It should print the standard user's issues `#101 Fix login` and `#102 Update docs`.

For different ports, set `GITLAB_PORT`, `ANALYTICS_PORT`, `GATEWAY_PORT`, `GITLAB_MCP_URL`, `ANALYTICS_MCP_URL`, or `GATEWAY_MCP_URL` as needed. The local gateway state is stored in `.data/`, which is ignored by Git.

Run `pnpm typecheck` and `pnpm test` to verify the slice. The end-to-end test starts both HTTP servers on temporary ports and checks the public gateway endpoint.
