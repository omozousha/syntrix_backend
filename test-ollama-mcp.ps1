#!/usr/bin/env pwsh

# Test Ollama MCP Tools
# Gunakan script ini untuk test tools sebelum pakai di Codex editor

$PROXY_URL = "http://localhost:11435/mcp"

function Invoke-MCPTool {
    param(
        [string]$toolName,
        [hashtable]$arguments = @{}
    )

    $body = @{
        jsonrpc = "2.0"
        id = [guid]::NewGuid().ToString()
        method = "tools/call"
        params = @{
            name = $toolName
            arguments = $arguments
        }
    } | ConvertTo-Json -Depth 10

    Write-Host "`n[MCP Call] Tool: $toolName" -ForegroundColor Cyan
    Write-Host "Arguments: $($arguments | ConvertTo-Json -Depth 5)" -ForegroundColor Gray

    try {
        $response = Invoke-RestMethod -Uri $PROXY_URL -Method POST -Body $body -ContentType "application/json" -ErrorAction Stop
        
        if ($response.error) {
            Write-Host "Error: $($response.error.message)" -ForegroundColor Red
            return $null
        }

        $result = $response.result.content[0].text
        Write-Host "Result:`n$result" -ForegroundColor Green
        return $result
    }
    catch {
        Write-Host "Connection Error: $($_.Exception.Message)" -ForegroundColor Red
        return $null
    }
}

# Test 1: List Models
Write-Host "`n========================================" -ForegroundColor Yellow
Write-Host "TEST 1: List Ollama Models" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow
Invoke-MCPTool "list_models"

# Test 2: Generate dengan qwen2.5-coder
Write-Host "`n========================================" -ForegroundColor Yellow
Write-Host "TEST 2: Generate Code (qwen2.5-coder:14b)" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow
Invoke-MCPTool "generate" @{
    model = "qwen2.5-coder:14b"
    prompt = "Write a simple Python function to check if a string is a palindrome"
}

# Test 3: Chat dengan minimax-m3
Write-Host "`n========================================" -ForegroundColor Yellow
Write-Host "TEST 3: Chat (minimax-m3:cloud)" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow
Invoke-MCPTool "chat" @{
    model = "minimax-m3:cloud"
    message = "Jelaskan perbedaan REST API dan GraphQL dalam 3 kalimat"
}

Write-Host "`n========================================" -ForegroundColor Green
Write-Host "All tests completed!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
