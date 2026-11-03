# Start a local demo loreserver (same as install.ps1 -Demo, but non-blocking)
# unless one is already healthy. GitHub's Windows runners kill processes a step
# started when that step ends, so call this at the top of every step that needs it.
$ErrorActionPreference = 'Stop'
function Test-Health {
  try { Invoke-WebRequest -Uri http://127.0.0.1:41339/health_check -UseBasicParsing -TimeoutSec 2 | Out-Null; return $true } catch { return $false }
}
if (Test-Health) { Write-Host "loreserver already healthy"; exit 0 }
$exe = (Get-Command loreserver.exe).Source
$log = Join-Path $env:RUNNER_TEMP ("loreserver-" + [Guid]::NewGuid().ToString('N') + ".log")
Start-Process -FilePath $exe -WindowStyle Hidden -RedirectStandardOutput $log -RedirectStandardError "$log.err" | Out-Null
for ($i = 0; $i -lt 60; $i++) {
  if (Test-Health) { Write-Host "loreserver healthy"; exit 0 }
  Start-Sleep -Milliseconds 500
}
Get-Content -Tail 40 $log, "$log.err" -ErrorAction SilentlyContinue
throw "loreserver did not become healthy"
