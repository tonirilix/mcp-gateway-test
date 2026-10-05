export function localGatewaySettings() {
  const key = process.env.GATEWAY_ENCRYPTION_KEY;
  const standardPassword = process.env.STANDARD_PASSWORD;
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!key || !standardPassword || !adminPassword) {
    throw new Error("Set GATEWAY_ENCRYPTION_KEY, STANDARD_PASSWORD, and ADMIN_PASSWORD in .env");
  }
  const encryptionKey = Buffer.from(key, "base64");
  if (encryptionKey.length !== 32) throw new Error("GATEWAY_ENCRYPTION_KEY must decode to 32 bytes");
  return {
    port: Number(process.env.GATEWAY_PORT ?? 4100),
    stateFile: process.env.GATEWAY_STATE_FILE ?? ".data/gateway-state.json",
    encryptionKey,
    seedPasswords: { standard: standardPassword, admin: adminPassword },
  };
}
