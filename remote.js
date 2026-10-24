// Modo remoto (Streamable HTTP) para usarlo como conector personalizado en claude.ai.
// Sin estado: cada petición crea su propio servidor MCP.
import { createServer as createHttpServer } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "./server.js";
const PORT = Number(process.env.PORT ?? 3000);
// Si se define, la URL del conector es /mcp/<secreto> y /mcp a secas responde 404.
const SECRET = process.env.FJ_SECRET?.trim();
const MCP_PATH = SECRET ? `/mcp/${SECRET}` : "/mcp";
async function readBody(req) {
    const chunks = [];
    for await (const c of req)
        chunks.push(c);
    if (!chunks.length)
        return undefined;
    return JSON.parse(Buffer.concat(chunks).toString("utf-8"));
}
const http = createHttpServer(async (req, res) => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname.replace(/\/$/, "");
    if (path === "" || path === "/health") {
        res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" }).end("fuentes-juridicas-mcp OK\n");
        return;
    }
    if (path !== MCP_PATH) {
        res.writeHead(404).end();
        return;
    }
    if (req.method !== "POST") {
        // Modo sin estado: no hay flujo SSE por GET ni sesiones que cerrar.
        res.writeHead(405, { Allow: "POST" }).end();
        return;
    }
    try {
        const body = await readBody(req);
        const server = createServer();
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
        res.on("close", () => {
            transport.close();
            server.close();
        });
        await server.connect(transport);
        await transport.handleRequest(req, res, body);
    }
    catch (err) {
        console.error(err);
        if (!res.headersSent) {
            res.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32700, message: "Petición no válida" }, id: null }));
        }
    }
});
http.listen(PORT, () => console.error(`fuentes-juridicas MCP (HTTP) escuchando en :${PORT}${MCP_PATH}`));
