"""Demo: cara pakai Ollama lewat MCP proxy dari kode Python."""
import requests

PROXY = "http://localhost:11435/mcp"


def call_tool(name: str, arguments: dict | None = None) -> str:
    """Panggil MCP tool di Ollama proxy dan return text content."""
    payload = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/call",
        "params": {"name": name, "arguments": arguments or {}},
    }
    r = requests.post(
        PROXY,
        json=payload,
        headers={"Accept": "application/json, text/event-stream"},
    )
    r.raise_for_status()
    data = r.json()
    if "error" in data:
        raise RuntimeError(data["error"])
    return "\n".join(
        c["text"] for c in data["result"]["content"] if c.get("type") == "text"
    )


if __name__ == "__main__":
    print("=== list_models ===")
    print(call_tool("list_models"))

    print("\n=== generate (qwen2.5-coder:14b) ===")
    print(
        call_tool(
            "generate",
            {
                "model": "qwen2.5-coder:14b",
                "prompt": "Sebutkan 3 best practice error handling di Node.js (jawab singkat)",
            },
        )
    )
