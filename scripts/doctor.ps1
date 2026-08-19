$ErrorActionPreference = "Stop"

function Resolve-ToolVersion([string]$Raw) {
  # "go version go1.24.0 windows/amd64" / "v20.12.1" / "11.9.0" / "git version 2.45.1.windows.1"
  $trimmed = "$Raw" -replace '^[^0-9]+', ''
  if ($trimmed -match '^(\d+(\.\d+)+)') { return $Matches[1] }
  return $null
}

function Test-MinimumVersion([string]$Version, [version]$Minimum) {
  $parts = ($Version -split '\.')[0..2] -join '.'
  try { return ([version]$parts) -ge $Minimum } catch { return $false }
}

$checks = @(
  @{ Name = "Go 1.23+"; Command = "go"; Args = @("version"); Required = $true; Minimum = "1.23" },
  @{ Name = "Node.js 20.12+"; Command = "node"; Args = @("--version"); Required = $true; Minimum = "20.12" },
  @{ Name = "pnpm 11+"; Command = "pnpm"; Args = @("--version"); Required = $true; Minimum = "11.0" },
  @{ Name = "Git"; Command = "git"; Args = @("--version"); Required = $true; Minimum = $null },
  @{ Name = "Docker Desktop"; Command = "docker"; Args = @("--version"); Required = $false; Minimum = $null }
)

$failed = $false
foreach ($check in $checks) {
  $command = Get-Command $check.Command -ErrorAction SilentlyContinue
  if (-not $command) {
    $label = if ($check.Required) { "missing" } else { "optional missing" }
    Write-Host "[$label] $($check.Name)"
    if ($check.Required) { $failed = $true }
    continue
  }

  $raw = & $command.Source @($check.Args) 2>$null | Select-Object -First 1
  $version = Resolve-ToolVersion "$raw"
  if ($null -eq $version) {
    Write-Host "[error] $($check.Name): could not parse version from '$raw'"
    if ($check.Required) { $failed = $true }
    continue
  }
  if ($null -ne $check.Minimum -and -not (Test-MinimumVersion $version ([version]$check.Minimum))) {
    Write-Host "[error] $($check.Name): found $version, need >= $($check.Minimum)"
    if ($check.Required) { $failed = $true }
    continue
  }
  Write-Host "[ok] $($check.Name): $version"
}

. (Join-Path $PSScriptRoot "..\network\resolve-git-bash.ps1")
try {
  $gitBash = Resolve-GitBash
  $bashVersion = & $gitBash --version 2>$null | Select-Object -First 1
  Write-Host "[ok] Git Bash: $bashVersion ($gitBash)"
} catch {
  Write-Host "[optional missing] Git Bash"
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Write-Host "Note: the API only runs against a real Fabric network, which requires Docker Desktop."
}

if ($failed) { exit 1 }
