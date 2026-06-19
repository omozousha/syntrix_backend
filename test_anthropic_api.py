"""Test Anthropic-compatible API at Ollama."""
import requests

payload = {
    "model": "minimax-m3:cloud",
    "max_tokens": 100,
    "messages": [{"role": "user", "content": "Halo, apa kabar?"}],
}

r = requests.post(
    "http://localhost:11434/v1/messages",
    json=payload,
    headers={"anthropic-version": "2023-06-01"},
    timeout=30,
)
print(f"Status: {r.status_code}")
print(f"Response:\n{r.text}")
