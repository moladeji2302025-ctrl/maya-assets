# Maya Asset Library – launcher
# Usage: .\start.ps1 [-ApiKey "sk-ant-..."]
param([string]$ApiKey = "")

if ($ApiKey) {
    $env:ANTHROPIC_API_KEY = $ApiKey
}

$backend = Join-Path $PSScriptRoot "backend"
Write-Host "Starting Maya Asset Library backend..." -ForegroundColor Cyan
Write-Host "Open http://localhost:8000 in your browser." -ForegroundColor Green
Write-Host ""

if (-not $env:ANTHROPIC_API_KEY) {
    Write-Warning "ANTHROPIC_API_KEY is not set. AI features will not work."
    Write-Warning "Set it with: `$env:ANTHROPIC_API_KEY = 'sk-ant-...'"
    Write-Host ""
}

Set-Location $backend
python -m uvicorn main:app --host 127.0.0.1 --port 8000 --reload
