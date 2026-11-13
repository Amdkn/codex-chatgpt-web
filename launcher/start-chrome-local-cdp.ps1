param(
  [int]$CdpPort = 9222,
  [string]$Url = "https://chatgpt.com/"
)

$ErrorActionPreference = "Stop"

try {
  $ver = Invoke-RestMethod -Uri "http://127.0.0.1:$CdpPort/json/version" -TimeoutSec 2
  if ($ver.webSocketDebuggerUrl) {
    Write-Host "[CPU-CLI] Chrome Local CDP deja actif sur 127.0.0.1:$CdpPort ($($ver.Browser))" -ForegroundColor Green
    exit 0
  }
} catch {
  # Port pas encore ouvert
}

$chromeExe = @(
  $env:ASPACE_CHROME_PATH,
  "C:\Program Files\Google\Chrome\Application\chrome.exe",
  "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
  (Join-Path $env:LOCALAPPDATA "Google\Chrome\Application\chrome.exe")
) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1

if (-not $chromeExe) {
  Write-Error "chrome.exe introuvable."
  exit 1
}

$userDataDir = if ($env:ASPACE_CHROME_USER_DATA_DIR) {
  $env:ASPACE_CHROME_USER_DATA_DIR
} else {
  Join-Path $env:LOCALAPPDATA "Google\Chrome\User Data"
}

$existingChrome = Get-Process -Name "chrome" -ErrorAction SilentlyContinue
if ($existingChrome) {
  Write-Warning "[CPU-CLI] Chrome est deja ouvert sans --remote-debugging-port=$CdpPort. Ferme Chrome puis relance ce script pour attacher ton profil principal, ou definis ASPACE_CHROME_USER_DATA_DIR."
  exit 2
}

$args = @(
  "--remote-debugging-port=$CdpPort",
  "--user-data-dir=`"$userDataDir`"",
  "--no-first-run",
  "--no-default-browser-check",
  $Url
)

Start-Process -FilePath $chromeExe -ArgumentList $args | Out-Null
Start-Sleep -Milliseconds 1200

try {
  $ver = Invoke-RestMethod -Uri "http://127.0.0.1:$CdpPort/json/version" -TimeoutSec 3
  Write-Host "[CPU-CLI] Chrome Local CDP pret sur 127.0.0.1:$CdpPort ($($ver.Browser))" -ForegroundColor Green
  exit 0
} catch {
  Write-Warning "[CPU-CLI] Chrome lance, mais CDP 127.0.0.1:$CdpPort ne repond pas encore."
  exit 1
}
