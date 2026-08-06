# TaskForge Single Command Startup Script

Write-Host "================================================" -ForegroundColor Cyan
Write-Host "         Launching TaskForge Platform          " -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan

Set-Location -Path $PSScriptRoot

# Run all services concurrently
npm run dev
