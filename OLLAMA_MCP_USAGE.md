# Menggunakan Ollama MCP Server di Codex

## Status Setup ✅

- **MCP Server**: `ollama` (enabled, stdio-based)
- **Ollama API**: http://localhost:11434
- **Server Script**: `scripts/ollama-mcp-server/server.js`
- **Tools tersedia**:
  - `list_models` — Daftar model Ollama
  - `generate` — Generate teks dari Ollama model
  - `chat` — Chat dengan Ollama model

## Cara Menggunakan

### 1. Di Codex CLI (Interactive Mode)
```bash
# Jalankan Codex
codex

# Dalam session Codex, minta untuk pakai tool
Tolong list model Ollama yang tersedia
# Codex akan otomatis memanggil mcp__ollama__list_models
```

### 2. Di Codex IDE / VS Code Extension
Saat menggunakan Codex dalam editor:
- Tools Ollama tersedia otomatis sebagai "available tools"
- Codex akan mempertimbangkan untuk memanggil `list_models`, `generate`, atau `chat` saat relevan

### 3. Contoh Prompt

**List Model:**
```
Tolong list semua model Ollama yang terpasang di lokal
```

**Generate Text:**
```
Gunakan model qwen2.5-coder:14b untuk generate code snippet untuk reverse string di Python
```

**Chat:**
```
Chat dengan model minimax-m3:cloud: Apa perbedaan async/await dan Promise di JavaScript?
```

## Model Tersedia

| Model | Type | Context | Capabilities |
|-------|------|---------|--------------|
| minimax-m3:cloud | Remote | 524KB | completion, tools, thinking, vision |
| qwen2.5-coder:14b | Local (GGUF) | 32KB | completion, tools, insert |
| minimax-m2.5:cloud | Remote | 202KB | completion, tools, thinking |
| kimi-k2.5:cloud | Remote | 256KB | completion, tools, thinking, vision |

## Troubleshooting

### Proxy tidak tersedia?
```bash
# Cek status proxy
curl http://localhost:11435/

# Restart proxy (kill & rerun)
# Terminal harus tetap buka dengan proxy running
```

### MCP server tidak muncul di Codex?
```bash
# Lihat registered servers
codex mcp list

# Pastikan status: "enabled"
```

### Tools tidak dipanggil?
- Codex memilih untuk memanggil tools berdasarkan relevance
- Pastikan prompt cukup jelas minta Ollama tools digunakan
