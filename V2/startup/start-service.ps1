# start-service.ps1
# Lance `start-and-monitor.js` en arrière-plan et redirige les logs.
# Conçu pour être appelé par un service Windows ou manuellement pour tester.

$ScriptPath = Join-Path $PSScriptRoot 'start-and-monitor.js'
$Node = 'node'
$Root = Resolve-Path "$PSScriptRoot\.." | Select-Object -ExpandProperty Path
$LogsDir = Join-Path $Root 'logs'
if (!(Test-Path $LogsDir)) { New-Item -ItemType Directory -Path $LogsDir | Out-Null }

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$logFile = Join-Path $LogsDir "startup-$timestamp.log"
$errFile = Join-Path $LogsDir "startup-$timestamp.err"

# Utilise cmd.exe pour permettre la redirection dans PowerShell 5.1
$cmd = "`"$Node`" `"$ScriptPath`" > `"$logFile`" 2> `"$errFile`""
Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', $cmd -WindowStyle Hidden

Write-Output "Started: node $ScriptPath"
Write-Output "Logs: $logFile"
Write-Output "Err : $errFile"
