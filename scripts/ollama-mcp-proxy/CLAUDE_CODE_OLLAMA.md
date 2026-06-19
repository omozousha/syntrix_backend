# Cara Pakai Ollama dengan Claude Code CLI

## ❌ Claude Code CLI tidak bisa langsung pakai Ollama sebagai login

Claude Code CLI hanya support backend resmi:
- Anthropic API (API key)
- AWS Bedrock
- Google Vertex AI  
- Azure Foundry

Ollama **tidak didukung** karena protocol berbeda.

## ✅ Solusi yang Tersedia

### Solusi 1: Pakai Ollama sebagai MCP Tools (Yang Sudah Kita Setup) ⭐ RECOMMENDED

Status: ✅ Sudah aktif!

**Cara kerja:** Claude Code pakai model Anthropic untuk berpikir, tapi bisa panggil Ollama via MCP tools untuk:
- Generate teks lewat model lokal
- Chat dengan model lokal
- List models

**Cara pakai di chat:**
```
Pakai model qwen2.5-coder:14b untuk review kode ini
```
Atau:
```
Generate teks dengan minimax-m3:cloud: "Jelaskan REST API"
```

Claude akan otomatis panggil `mcp__ollama__generate`.

**File konfigurasi:** `~/.claude.json`
```json
"ollama": {
  "type": "http",
  "url": "http://localhost:11435/mcp"
}
```

---

### Solusi 2: Ollama Proxy yang Kompatibel dengan Anthropic API (Belum ada)

Bikin proxy yang translate Ollama API → Anthropic Messages API.

**Belum dibuat** - tapi bisa kalau Anda mau.

Tools yang bisa dipakai:
- `litellm` - Proxy multi-provider
- Custom Node.js proxy

**Contoh dengan LiteLLM:**
```bash
pip install litellm
litellm --model ollama_chat/qwen2.5-coder:14b \
        --api_key anything
```

Lalu set env:
```bash
ANTHROPIC_BASE_URL=http://localhost:4000
ANTHROPIC_API_KEY=anything
claude --model claude-3-5-sonnet-20241022
```

**⚠️ Catatan:** Format Ollama ↔ Anthropic beda, mungkin perlu prompt adapter.

---

### Solusi 3: Pakai Ollama Sebagai CLI Tools (Bukan Login)

Buat wrapper command yang panggil Ollama + tools lain:

**File:** `~/bin/claude-ollama` (bash) atau script PowerShell

```bash
#!/bin/bash
# Kirim prompt ke Ollama, return response
PROMPT="$1"
MODEL="${2:-qwen2.5-coder:14b}"
curl -s http://localhost:11434/api/generate \
  -d "{\"model\":\"$MODEL\",\"prompt\":\"$PROMPT\",\"stream\":false}" \
  | jq -r '.response'
```

Pakai dari terminal:
```bash
claude-ollama "Jelaskan async/await"
```

---

## 🎯 Rekomendasi

| Use Case | Solusi |
|----------|--------|
| Mau Claude Code panggil model lokal sebagai **tools** | ✅ Solusi 1 (sudah aktif) |
| Mau Claude Code CLI jalan **sepenuhnya** dengan Ollama | ⚠️ Solusi 2 (perlu setup) |
| Mau CLI command sederhana | ✅ Solusi 3 (1 script) |

## Status Saat Ini

- ✅ Ollama MCP proxy running di port 11435
- ✅ 4 model tersedia (minimax-m3, qwen2.5-coder, dll)
- ✅ Claude Code connected ke MCP Ollama

## Quick Test

Coba tanya Claude Code:
```
"Tolong list model Ollama yang tersedia"
atau
"Pakai model qwen2.5-coder:14b untuk review kode di app.js"
```

Claude akan otomatis panggil MCP tool.
