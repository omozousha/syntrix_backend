import requests

payload = {
    'model': 'minimax-m3:cloud',
    'prompt': 'Berikan 3 tips terbaik untuk menggunakan Ollama dengan efektif',
    'stream': False
}

response = requests.post('http://localhost:11434/api/generate', json=payload)
result = response.json()
print(f'Model: {result["model"]}\n')
print(result['response'])
