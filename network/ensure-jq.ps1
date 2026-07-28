param(
  [string]$Version = "1.8.1",
  [string]$Sha256 = "23cb60a1354eed6bcc8d9b9735e8c7b388cd1fdcb75726b93bc299ef22dd9334"
)

$ErrorActionPreference = "Stop"
$NetworkDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$BinDir = Join-Path $NetworkDir "bin"
$JqExe = Join-Path $BinDir "jq.exe"
$ExpectedHash = $Sha256.ToUpperInvariant()

if (Test-Path -LiteralPath $JqExe -PathType Leaf) {
  $ExistingHash = (Get-FileHash -LiteralPath $JqExe -Algorithm SHA256).Hash
  if ($ExistingHash -eq $ExpectedHash) {
    Write-Output $JqExe
    return
  }

  Write-Host "The project-local jq binary failed verification and will be replaced."
}

New-Item -ItemType Directory -Path $BinDir -Force | Out-Null
$Download = Join-Path $BinDir "jq.exe.download"
$DownloadUri = "https://github.com/jqlang/jq/releases/download/jq-$Version/jq-windows-amd64.exe"

try {
  Write-Host "Downloading project-local jq $Version..."
  Invoke-WebRequest -Uri $DownloadUri -OutFile $Download

  $DownloadedHash = (Get-FileHash -LiteralPath $Download -Algorithm SHA256).Hash
  if ($DownloadedHash -ne $ExpectedHash) {
    throw "jq $Version failed SHA-256 verification."
  }

  Move-Item -LiteralPath $Download -Destination $JqExe -Force
}
finally {
  if (Test-Path -LiteralPath $Download) {
    Remove-Item -LiteralPath $Download -Force
  }
}

& $JqExe --version *> $null
if ($LASTEXITCODE -ne 0) {
  throw "The verified jq binary could not be executed."
}

Write-Output $JqExe
