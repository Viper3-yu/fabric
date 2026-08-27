$ErrorActionPreference = "Stop"
$ProjectDir = Split-Path -Parent $PSScriptRoot
$GoFmt = Get-Command gofmt -ErrorAction SilentlyContinue

if (-not $GoFmt) {
  throw "gofmt was not found. Install Go 1.23 or newer and add it to PATH."
}

$Files = Get-ChildItem -LiteralPath `
  (Join-Path $ProjectDir "apps\api"), `
  (Join-Path $ProjectDir "chaincode\logistics") `
  -Recurse -Filter "*.go" -File |
  Where-Object {
    # Vendor trees would blow past the Windows command-line length limit
    # (808+ files) and are excluded by CI / check-go-format.sh as well.
    $_.FullName -notlike "*\vendor\*" -and
    $_.FullName -notlike "*\.go-cache\*" -and
    $_.FullName -notlike "*\.go-mod\*"
  } |
  Select-Object -ExpandProperty FullName

$Unformatted = & $GoFmt.Source -l $Files
if ($Unformatted) {
  Write-Host "The following Go files are not formatted:"
  $Unformatted | ForEach-Object { Write-Host $_ }
  exit 1
}

Write-Host "[ok] Go source is formatted."
