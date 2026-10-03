import { expect } from "vitest";

export async function connectDemoUser(gatewayUrl: string, credentials: Record<string, string> = { gitlab: "gl-standard" }) {
  const login = await fetch(new URL("/api/login", gatewayUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "standard", password: "standard-password" }),
  });
  expect(login.status).toBe(200);
  const cookie = login.headers.get("set-cookie")!.split(";")[0];

  for (const [integration, token] of Object.entries(credentials)) {
    const response = await fetch(new URL(`/api/integrations/${integration}/credential`, gatewayUrl), {
      method: "PUT",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    expect(response.status).toBe(200);
  }

  const response = await fetch(new URL("/api/token", gatewayUrl), {
    method: "POST", headers: { Cookie: cookie },
  });
  expect(response.status).toBe(200);
  return { cookie, token: (await response.json() as { token: string }).token };
}
