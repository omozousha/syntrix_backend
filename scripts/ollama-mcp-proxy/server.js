// MCP Streamable HTTP proxy for Ollama.
// Exposes Ollama LLM inference as MCP tools that Claude Code can call.

import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";

const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const PORT = Number(process.env.PORT || 11435);

const server = new McpServer({
  name: "ollama-proxy",
  version: "1.0.0",
});

server.tool(
  "list_models",
  "Daftar model Ollama yang terpasang di lokal.",
  {},
  async () => {
    const res = await fetch(`${OLLAMA_URL}/api/tags`);
    const data = await res.json();
    const names = (data.models || []).map((m) => m.name).join("\n- ");
    return {
      content: [
        { type: "text", text: names ? `- ${names}` : "(tidak ada model terpasang)" },
      ],
    };
  }
);

server.tool(
  "generate",
  "Generate teks dari sebuah Ollama model (LLM inference lokal).",
  {
    model: z.string().describe("Nama model, mis. minimax-m3:cloud atau qwen2.5-coder:14b"),
    prompt: z.string().describe("Prompt / pertanyaan untuk model"),
  },
  async ({ model, prompt }) => {
    const res = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt, stream: false }),
    });
    const data = await res.json();
    return {
      content: [{ type: "text", text: data.response || "(tidak ada respons)" }],
    };
  }
);

server.tool(
  "chat",
  "Chat / percakapan dengan Ollama model.",
  {
    model: z.string().describe("Nama model Ollama"),
    message: z.string().describe("Pesan user"),
  },
  async ({ model, message }) => {
    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        messages: [{ role: "user", content: message }],
      }),
    });
    const data = await res.json();
    return {
      content: [
        {
          type: "text",
          text: data.message?.content || "(tidak ada respons)",
        },
      ],
    };
  }
);

const app = express();
app.use(express.json({ limit: "4mb" }));

// Stateless MCP: each request gets a fresh transport.
app.post("/mcp", async (req, res) => {
  const requestId = randomUUID();
  console.log(`[${requestId}] POST /mcp`);

  try {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    res.on("close", () => {
      console.log(`[${requestId}] response closed`);
      transport.close().catch(() => {});
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
    console.log(`[${requestId}] handled OK`);
  } catch (err) {
    console.error(`[${requestId}] MCP request error:`, err);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: String(err?.message || err) },
        id: req?.body?.id ?? null,
      });
    }
  }
});

const handleMethodNotAllowed = (req, res) => {
  res
    .status(405)
    .set("Allow", "POST")
    .json({ error: `Method ${req.method} not allowed. Use POST.` });
};

app.get("/mcp", handleMethodNotAllowed);
app.delete("/mcp", handleMethodNotAllowed);

app.get("/", (req, res) => {
  res.json({
    name: "ollama-mcp-proxy",
    version: "1.0.0",
    ollama: OLLAMA_URL,
    tools: ["list_models", "generate", "chat"],
    mcp_endpoint: "POST /mcp",
  });
});

app.listen(PORT, () => {
  console.log(`Ollama MCP proxy listening on http://localhost:${PORT}`);
  console.log(`MCP endpoint: POST http://localhost:${PORT}/mcp`);
  console.log(`Forwarding to Ollama at ${OLLAMA_URL}`);
});
