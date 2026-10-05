export function mockCaller(request: Request | undefined, prefix: string): "standard" | "admin" | undefined {
  const token = request?.headers.get("Authorization")?.match(/^Bearer (.+)$/)?.[1];
  if (token === `${prefix}-standard`) return "standard";
  if (token === `${prefix}-admin`) return "admin";
  return undefined;
}

export function mockAuthFailure(request: Request, prefix: string): Response | undefined {
  const hasAuthorization = request.headers.has("Authorization");
  const isCall = request.headers.get("Mcp-Method") === "tools/call";
  if ((hasAuthorization || isCall) && !mockCaller(request, prefix)) {
    return new Response("Invalid integration credential", { status: 401 });
  }
  return undefined;
}
