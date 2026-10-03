# MCP Gateway Test

A local learning project for an MCP gateway. This first slice has one mock GitLab MCP server, a gateway that discovers and forwards its tool, and a small MCP test client. Both network hops use MCP over HTTP with the `2026-07-28` protocol revision.

## Requirements

- Node.js 20 or newer
- pnpm 11.9.0

## Run the first slice

Install dependencies with `pnpm install --frozen-lockfile`. Then run these commands in separate terminals, in order:

```sh
pnpm dev:gitlab
pnpm dev:gateway
pnpm demo
```

The mock server listens on `127.0.0.1:4101` and the gateway on `127.0.0.1:4100`. The demo client connects only to the gateway, lists `gitlab__list_issues`, and calls it for `team/demo`. It should print issues `#101 Fix login` and `#102 Update docs`.

For different ports, set `GITLAB_PORT`, `GATEWAY_PORT`, `GITLAB_MCP_URL`, or `GATEWAY_MCP_URL` as needed.

Run `pnpm typecheck` and `pnpm test` to verify the slice. The end-to-end test starts both HTTP servers on temporary ports and checks the public gateway endpoint.
