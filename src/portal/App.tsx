import { useEffect, useState, type FormEvent } from "react";

type CatalogTool = {
  name: string;
  description?: string;
  inputSchema: unknown;
  behavior: "read" | "write";
  enabled: boolean;
  adminOnly: boolean;
  eligible: boolean;
};

type CatalogIntegration = {
  id: string;
  name: string;
  status: "available" | "unavailable";
  stale: boolean;
  lastRefreshedAt?: string;
  connected: boolean;
  tools: CatalogTool[];
};

type Catalog = { integrations: CatalogIntegration[] };
type User = { id: string; role: string };

async function readApi<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const body = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status})`);
  return body;
}

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [username, setUsername] = useState("standard");
  const [password, setPassword] = useState("");
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [gatewayToken, setGatewayToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadCatalog() {
    setCatalog(await readApi<Catalog>("/api/catalog"));
  }

  useEffect(() => {
    let active = true;
    readApi<{ user: User }>("/api/me")
      .then(async ({ user: current }) => {
        if (!active) return;
        setUser(current);
        await loadCatalog();
      })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      const result = await readApi<{ user: User }>("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      setUser(result.user);
      setPassword("");
      await loadCatalog();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not sign in");
    }
  }

  async function saveCredential(event: FormEvent<HTMLFormElement>, id: string) {
    event.preventDefault();
    setError(null);
    try {
      await readApi("/api/integrations/" + id + "/credential", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: credentials[id] }),
      });
      setCredentials((current) => ({ ...current, [id]: "" }));
      await loadCatalog();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not connect integration");
    }
  }

  async function createToken() {
    setError(null);
    try {
      const result = await readApi<{ token: string }>("/api/token", { method: "POST" });
      setGatewayToken(result.token);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create token");
    }
  }

  async function toggleTool(name: string, enabled: boolean) {
    setError(null);
    try {
      await readApi(`/api/tools/${encodeURIComponent(name)}/enabled`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      await loadCatalog();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update tool");
    }
  }

  async function refreshIntegration(id: string) {
    setError(null);
    try {
      await readApi(`/api/integrations/${id}/refresh`, { method: "POST" });
      await loadCatalog();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not refresh integration");
    }
  }

  async function signOut() {
    await readApi("/api/logout", { method: "POST" });
    setUser(null);
    setCatalog(null);
    setGatewayToken(null);
    setCredentials({});
    setError(null);
  }

  return (
    <main className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Local learning project</p>
          <h1>MCP gateway catalog</h1>
          <p>Tools discovered from downstream MCP servers and exposed through one gateway endpoint.</p>
        </div>
        <span className="endpoint">/mcp</span>
      </header>

      {error && <p role="alert" className="notice error">{error}</p>}

      {!user && (
        <form className="login-card" onSubmit={signIn}>
          <h2>Sign in</h2>
          <p>Use one of the two seeded demo accounts.</p>
          <label>Username
            <select value={username} onChange={(event) => setUsername(event.target.value)}>
              <option value="standard">standard</option>
              <option value="admin">admin</option>
            </select>
          </label>
          <label>Password
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required />
          </label>
          <button type="submit">Sign in</button>
        </form>
      )}

      {user && (
        <>
          <section className="account-bar">
            <span>Signed in as <strong>{user.id}</strong> ({user.role})</span>
            <button type="button" className="secondary" onClick={signOut}>Sign out</button>
          </section>
          <section className="token-card">
            <div>
              <h2>Gateway access token</h2>
              <p>Create a token for the MCP test client. A new token replaces your previous one.</p>
            </div>
            <button type="button" onClick={createToken}>Create token</button>
            {gatewayToken && <p className="token-value">Copy now; it will not be shown again: <code>{gatewayToken}</code></p>}
          </section>
          {!catalog && <p className="notice">Loading integrations…</p>}
          {catalog && (
            <section className="integrations" aria-label="Integrations">
              {catalog.integrations.map((integration) => (
                <article className="integration" key={integration.id}>
                  <div className="integration-heading">
                    <div><p className="eyebrow">Integration</p><h2>{integration.name}</h2></div>
                    <span className="status">{integration.connected ? "Connected" : "Not connected"}</span>
                  </div>
                  <div className="catalog-status">
                    <p className="count">{integration.tools.length} discovered tool{integration.tools.length === 1 ? "" : "s"} · Server {integration.status}{integration.stale ? " · Last-known catalog" : ""}</p>
                    <button type="button" className="secondary" onClick={() => refreshIntegration(integration.id)}>Refresh tools</button>
                  </div>
                  {integration.stale && <p className="notice">These tool definitions were saved before the server became unavailable. Calls may fail until it returns.</p>}
                  <form className="credential-form" onSubmit={(event) => saveCredential(event, integration.id)}>
                    <label>Mock service token
                      <input
                        type="password"
                        value={credentials[integration.id] ?? ""}
                        onChange={(event) => setCredentials((current) => ({ ...current, [integration.id]: event.target.value }))}
                        placeholder={integration.connected ? "Replace saved token" : "Enter token"}
                        required
                      />
                    </label>
                    <button type="submit">{integration.connected ? "Update connection" : "Connect"}</button>
                  </form>
                  <div className="tools">
                    {integration.tools.map((tool) => (
                      <section className="tool" key={tool.name}>
                        <div className="tool-heading">
                          <h3>{tool.name}</h3>
                          <span className="tool-labels">
                            <span className="behavior">{tool.behavior === "read" ? "Read only" : "Changes data"}</span>
                            {tool.adminOnly && <span className="admin-label">Admin only</span>}
                          </span>
                        </div>
                        <p>{tool.description}</p>
                        <label className="tool-toggle">
                          <input
                            type="checkbox"
                            checked={tool.enabled}
                            disabled={!integration.connected || !tool.eligible}
                            onChange={(event) => toggleTool(tool.name, event.target.checked)}
                          />
                          {tool.enabled ? "Enabled for me" : "Disabled for me"}
                        </label>
                        {!tool.eligible && <p className="eligibility">Your role cannot enable this tool.</p>}
                        <details><summary>Input schema</summary><pre>{JSON.stringify(tool.inputSchema, null, 2)}</pre></details>
                      </section>
                    ))}
                  </div>
                </article>
              ))}
            </section>
          )}
        </>
      )}
    </main>
  );
}
