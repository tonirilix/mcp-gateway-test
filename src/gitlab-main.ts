import { startGitLabServer } from "./gitlab-server.js";

const port = Number(process.env.GITLAB_PORT ?? 4101);
const server = await startGitLabServer({ port });
console.log(`Mock GitLab MCP server listening at ${server.url}`);
