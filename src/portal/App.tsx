import { useEffect, useState } from "react";

type CatalogTool = {
  name: string;
  description?: string;
  inputSchema: unknown;
  behavior: "read" | "write";
};

type CatalogIntegration = {
  id: string;
  name: string;
  status: "available" | "unavailable";
  tools: CatalogTool[];
};

type Catalog = { integrations: CatalogIntegration[] };

export function App() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/catalog")
      .then(async (response) => {
        if (!response.ok) throw new Error(`Catalog request failed (${response.status})`);
        return (await response.json()) as Catalog;
      })
      .then((value) => {
        if (active) setCatalog(value);
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : "Could not load catalog");
      });
    return () => { active = false; };
  }, []);

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
      {!catalog && !error && <p className="notice">Loading integrations…</p>}
      {catalog && (
        <section className="integrations" aria-label="Integrations">
          {catalog.integrations.map((integration) => (
            <article className="integration" key={integration.id}>
              <div className="integration-heading">
                <div>
                  <p className="eyebrow">Integration</p>
                  <h2>{integration.name}</h2>
                </div>
                <span className="status">{integration.status}</span>
              </div>
              <p className="count">{integration.tools.length} discovered tool{integration.tools.length === 1 ? "" : "s"}</p>
              <div className="tools">
                {integration.tools.map((tool) => (
                  <section className="tool" key={tool.name}>
                    <div className="tool-heading">
                      <h3>{tool.name}</h3>
                      <span className="behavior">{tool.behavior === "read" ? "Read only" : "Changes data"}</span>
                    </div>
                    <p>{tool.description}</p>
                    <details>
                      <summary>Input schema</summary>
                      <pre>{JSON.stringify(tool.inputSchema, null, 2)}</pre>
                    </details>
                  </section>
                ))}
              </div>
            </article>
          ))}
        </section>
      )}
    </main>
  );
}
