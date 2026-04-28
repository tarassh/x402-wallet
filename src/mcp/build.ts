import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerX402Tools, type ToolRuntime } from "./tools.ts";

export const SERVER_NAME = "x402-wallet";
export const SERVER_VERSION = "0.1.0";

export function buildMcpServer(rt: ToolRuntime): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  registerX402Tools(server, rt);
  return server;
}
