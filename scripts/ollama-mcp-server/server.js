#!/usr/bin/env node
/**
 * Ollama MCP Server (stdio)
 * Proper MCP server for Codex using stdio transport
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";

const server = new McpServer({
  name: "ollama",
  version: "1.0.0",
});

// Tool: List available models
server.tool(
  "list_models",
  "List all available Ollama models installed locally",
  {},
  async () => {
    try {
      const res = await fetch(`${OLLAMA_URL}/api/tags`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      
      const data = await res.json();
      const models = data.models || [];
      
      if (models.length === 0) {
        return {
          content: [{ type: "text", text: "No models installed" }],
        };
      }

      const modelList = models
        .map((m) => `- ${m.name} (${m.details?.family || "unknown"})`)
        .join("\n");

      return {
        content: [{ type: "text", text: `Available models:\n${modelList}` }],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${err.message}` }],
        isError: true,
      };
    }
  }
);

// Tool: Generate text
server.tool(
  "generate",
  "Generate text using an Ollama model",
  {
    model: z.string().describe("Model name (e.g., qwen2.5-coder:14b)"),
    prompt: z.string().describe("Prompt for text generation"),
    stream: z.boolean().optional().describe("Enable streaming (default: false)"),
  },
  async ({ model, prompt, stream = false }) => {
    try {
      const res = await fetch(`${OLLAMA_URL}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, prompt, stream }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      
      const data = await res.json();
      const response = data.response || "(no response)";

      return {
        content: [{ type: "text", text: response }],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${err.message}` }],
        isError: true,
      };
    }
  }
);

// Tool: Chat
server.tool(
  "chat",
  "Chat with an Ollama model",
  {
    model: z.string().describe("Model name"),
    message: z.string().describe("User message"),
    stream: z.boolean().optional().describe("Enable streaming (default: false)"),
  },
  async ({ model, message, stream = false }) => {
    try {
      const res = await fetch(`${OLLAMA_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: message }],
          stream,
        }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      
      const data = await res.json();
      const response = data.message?.content || "(no response)";

      return {
        content: [{ type: "text", text: response }],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${err.message}` }],
        isError: true,
      };
    }
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Server error:", err);
  process.exit(1);
});
