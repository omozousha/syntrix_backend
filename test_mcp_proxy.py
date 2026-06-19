import requests

session = requests.Session()

# Test 1: MCP initialize
payload = {
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
        "protocolVersion": "2024-11-05",
        "capabilities": {},
        "clientInfo": {"name": "test", "version": "1.0"}
    }
}
r = session.post(
    "http://localhost:11435/mcp",
    json=payload,
    headers={"Accept": "application/json, text/event-stream"},
)
print(f"=== Test 1: MCP initialize ===")
print(f"Status: {r.status_code}")
session_id = r.headers.get("Mcp-Session-Id")
print(f"Mcp-Session-Id: {session_id}")
print(f"Body: {r.text}")
print()

# Test 2: initialized notification (required by MCP spec)
notif = {
    "jsonrpc": "2.0",
    "method": "notifications/initialized"
}
r2 = session.post("http://localhost:11435/mcp", json=notif)
print(f"=== Test 2: notifications/initialized ===")
print(f"Status: {r2.status_code}")
print(f"Body: {r2.text}")
print()

# Test 3: list tools
headers3 = {"Accept": "application/json, text/event-stream"}
if session_id:
    headers3["Mcp-Session-Id"] = session_id
list_payload = {
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/list",
    "params": {}
}
r3 = session.post("http://localhost:11435/mcp", json=list_payload, headers=headers3)
print(f"=== Test 3: tools/list ===")
print(f"Status: {r3.status_code}")
print(f"Body: {r3.text[:1500]}")
print()

# Test 4: call list_models tool
call_payload = {
    "jsonrpc": "2.0",
    "id": 3,
    "method": "tools/call",
    "params": {
        "name": "list_models",
        "arguments": {}
    }
}
r4 = session.post("http://localhost:11435/mcp", json=call_payload, headers=headers3)
print(f"=== Test 4: tools/call list_models ===")
print(f"Status: {r4.status_code}")
print(f"Body: {r4.text[:1500]}")
