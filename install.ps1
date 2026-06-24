#!/usr/bin/env pwsh
#Requires -Version 5.1

if (-not $env:SAIA_API_KEY) {
  Write-Error "SAIA_API_KEY is not set. Get your key from https://chat-ai.academiccloud.de/ then run:"
  Write-Error "  [Environment]::SetEnvironmentVariable('SAIA_API_KEY', 'your_key_here', 'User')"
  exit 1
}

$targetDir = Join-Path $env:USERPROFILE ".config\opencode\plugins\saia"
New-Item -ItemType Directory -Force -Path $targetDir | Out-Null

Copy-Item -Path "src\*" -Destination $targetDir -Recurse -Force

Write-Host "✓ Plugin installed to $targetDir"

$configDir = Join-Path $env:USERPROFILE ".config\opencode"
$configFile = Join-Path $configDir "opencode.json"

New-Item -ItemType Directory -Force -Path $configDir | Out-Null

if (-not (Test-Path $configFile)) {
  $config = @{
    '$schema' = "https://opencode.ai/config.json"
    plugin = @("./saia/saia")
  } | ConvertTo-Json -Depth 10
  $config | Set-Content $configFile -Encoding UTF8
  Write-Host "✓ Created $configFile with plugin registration"
} else {
  Write-Host "⚠ Config exists at $configFile"
  Write-Host "  Add 'plugin' registration if not already present"
}

Write-Host ""
Write-Host "Run 'opencode' in any project to use SAIA models"
