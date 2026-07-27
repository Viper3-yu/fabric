function Resolve-GitBash {
  $usrCandidates = @()
  $binCandidates = @()

  if ($env:ProgramFiles) {
    $usrCandidates += Join-Path $env:ProgramFiles "Git\usr\bin\bash.exe"
    $binCandidates += Join-Path $env:ProgramFiles "Git\bin\bash.exe"
  }

  $programFilesX86 = [Environment]::GetFolderPath("ProgramFilesX86")
  if ($programFilesX86) {
    $usrCandidates += Join-Path $programFilesX86 "Git\usr\bin\bash.exe"
    $binCandidates += Join-Path $programFilesX86 "Git\bin\bash.exe"
  }

  if ($env:LOCALAPPDATA) {
    $usrCandidates += Join-Path $env:LOCALAPPDATA "Programs\Git\usr\bin\bash.exe"
    $binCandidates += Join-Path $env:LOCALAPPDATA "Programs\Git\bin\bash.exe"
  }

  foreach ($gitCommand in @(Get-Command git.exe -All -ErrorAction SilentlyContinue)) {
    if (-not $gitCommand.Path) { continue }
    $cursor = Split-Path -Parent $gitCommand.Path
    for ($level = 0; $level -lt 3 -and $cursor; $level++) {
      $usrCandidates += Join-Path $cursor "usr\bin\bash.exe"
      $binCandidates += Join-Path $cursor "bin\bash.exe"
      $cursor = Split-Path -Parent $cursor
    }
  }

  foreach ($bashCommand in @(Get-Command bash.exe -All -ErrorAction SilentlyContinue)) {
    if (-not $bashCommand.Path) { continue }
    if ($bashCommand.Path -match "[\\/]usr[\\/]bin[\\/]bash\.exe$") {
      $usrCandidates += $bashCommand.Path
    }
    elseif ($bashCommand.Path -match "[\\/]bin[\\/]bash\.exe$") {
      $binCandidates += $bashCommand.Path
    }
  }

  foreach ($candidate in @(($usrCandidates + $binCandidates) | Select-Object -Unique)) {
    if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) { continue }

    $fullPath = [IO.Path]::GetFullPath($candidate)
    if ($fullPath -match "[\\/]usr[\\/]bin[\\/]bash\.exe$") {
      $gitRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $fullPath))
    }
    elseif ($fullPath -match "[\\/]bin[\\/]bash\.exe$") {
      $gitRoot = Split-Path -Parent (Split-Path -Parent $fullPath)
    }
    else {
      continue
    }

    if (Test-Path -LiteralPath (Join-Path $gitRoot "cmd\git.exe") -PathType Leaf) {
      return $fullPath
    }
  }

  throw "Git for Windows Bash was not found. Install Git for Windows; WSL bash.exe is intentionally not used."
}
