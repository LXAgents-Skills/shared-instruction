#!/usr/bin/env node
/*
 * Server entry point.
 * Nothing here may write to stdout: on stdio, stdout is the JSON-RPC channel.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

/*
 * Which transport this process speaks.
 *
 * `MCP_TRANSPORT=http` is here so all five servers in the organization select a transport
 * the same way. The default stays stdio, because `Dockerfile`'s `CMD` is
 * `node dist/index.js` and that command has to keep meaning what it means.
 */
const transportName = (process.env.MCP_TRANSPORT ?? "stdio").toLowerCase();

if (transportName === "http" || transportName === "streamable-http") {
  /*
   * The import is dynamic and that is the whole point of it.
   *
   * `src/http.ts` pulls in express and the cluster machinery, and a static import would
   * load all of it into the stdio process whether or not HTTP was selected — in a process
   * whose stdout is the JSON-RPC channel. Deferring it keeps that graph empty until
   * something asks for the other transport.
   *
   * It also delegates rather than duplicating: `src/http.ts` is this repository's HTTP
   * entry point because `package.json`'s `start:http` and the `Dockerfile` comment both
   * name it, and neither may change. There is one HTTP path here, and this reaches it.
   */
  await import("./http.js");
} else {
  const server = createServer();
  const transport = new StdioServerTransport();

  await server.connect(transport);

  process.on("SIGINT", async () => {
    await server.close();
    process.exit(0);
  });
}
