# Runs the WowGrok companion and restarts it after a crash.
# Exit 0 is a clean stop. Exit 2 means another instance is already running.
$ErrorActionPreference = "Continue"
Set-Location (Split-Path -Parent $PSScriptRoot)
while ($true) {
  & node (Join-Path $PSScriptRoot "index.js") @args
  $code = $LASTEXITCODE
  if ($code -eq 0 -or $code -eq 2) { exit $code }
  Write-Host "WowGrok companion exited with $code; restarting in 3s. Ctrl+C stops."
  Start-Sleep -Seconds 3
}
