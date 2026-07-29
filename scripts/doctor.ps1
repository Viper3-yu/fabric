$checks = @(
  @{ Name = "Go 1.23+"; Command = "go"; Args = @("version"); Required = $true },
  @{ Name = "Node.js 20+"; Command = "node"; Args = @("--version"); Required = $true },
  @{ Name = "pnpm"; Command = "pnpm"; Args = @("--version"); Required = $true },
  @{ Name = "Git"; Command = "git"; Args = @("--version"); Required = $true },
  @{ Name = "Docker Desktop"; Command = "docker"; Args = @("--version"); Required = $false }
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

  $version = & $command.Source @($check.Args) 2>$null | Select-Object -First 1
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
  Write-Host "Note: demo mode and automated tests do not require Docker. A real Fabric network requires Docker Desktop."
}

if ($failed) { exit 1 }
