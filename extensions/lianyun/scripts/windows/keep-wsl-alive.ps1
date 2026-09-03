param(
    [string]$Distro = 'Ubuntu'
)

$taskName = 'LianyunWSLKeepAlive'
$action = New-ScheduledTaskAction `
    -Execute 'wsl.exe' `
    -Argument "-d $Distro --exec /bin/bash -lc `"sudo systemctl start docker mysql apache2 lianyun-backend; exec /bin/sleep infinity`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit ([TimeSpan]::Zero)

Register-ScheduledTask `
    -TaskName $taskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Description 'Keep Ubuntu WSL running for the Lianyun Fabric demo' `
    -Force | Out-Null

Start-ScheduledTask -TaskName $taskName
Get-ScheduledTask -TaskName $taskName | Select-Object TaskName, State
