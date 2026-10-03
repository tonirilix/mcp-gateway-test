import "dotenv/config";
import { createServer } from "vite";
import { startAnalyticsServer } from "./analytics-server.js";
import { startGatewayServer } from "./gateway-server.js";
import { startGitLabServer } from "./gitlab-server.js";
import { localGatewaySettings } from "./local-config.js";

const settings = localGatewaySettings();
const gitlab = await startGitLabServer({ port: Number(process.env.GITLAB_PORT ?? 4101) });
try {
  const analytics = await startAnalyticsServer({ port: Number(process.env.ANALYTICS_PORT ?? 4102) });
  try {
    const gateway = await startGatewayServer({
      ...settings, gitlabUrl: gitlab.url, analyticsUrl: analytics.url,
    });
    try {
      const portal = await createServer({
        server: {
          host: "127.0.0.1",
          port: Number(process.env.PORTAL_PORT ?? 5173),
          proxy: { "/api": new URL(gateway.url).origin },
        },
      });
      await portal.listen();
      console.log(`Mock GitLab: ${gitlab.url}`);
      console.log(`Mock Analytics: ${analytics.url}`);
      console.log(`Gateway: ${gateway.url}`);
      portal.printUrls();

      let closing = false;
      const shutdown = async () => {
        if (closing) return;
        closing = true;
        await portal.close();
        await gateway.close();
        await analytics.close();
        await gitlab.close();
      };
      process.once("SIGINT", () => void shutdown());
      process.once("SIGTERM", () => void shutdown());
    } catch (error) {
      await gateway.close();
      throw error;
    }
  } catch (error) {
    await analytics.close();
    throw error;
  }
} catch (error) {
  await gitlab.close();
  throw error;
}
