<#
.SYNOPSIS
    Lance le fork souverain Aspace OS V5 de Codex Web GPT (`01_Forkable/FKB01_Inference/codex-chatgpt-web`)
    avec le bouclier Zero-Telemetry (`aspace-telemetry-shield.cjs`), phone-home GitHub désactivé,
    et support Multi-Plateformes (ChatGPT, Gemini, Muse, Claude, DeepSeek, Z.ai, Qwen, Sakana Fugu, LFM3 :9931, FreeLLMAPI :31415).
#>
param(
    [switch]$VerifyOnly
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$ShieldPath = Join-Path $RepoRoot "launcher\electron\aspace-telemetry-shield.cjs"
$UpdatePath = Join-Path $RepoRoot "launcher\electron\update.cjs"

$env:ASPACE_ZERO_TELEMETRY = "1"
$env:ASPACE_ALLOW_EXTERNAL_UPDATE = "0"
$env:DO_NOT_TRACK = "1"

if ($VerifyOnly) {
    Push-Location $RepoRoot
    try {
        & "C:\Program Files\nodejs\node.exe" -e @"
const shield = require('./launcher/electron/aspace-telemetry-shield.cjs');
const update = require('./launcher/electron/update.cjs');
const router = new shield.AspaceFuguRouter();
const plan = router.planTrinityWorkflow('Test Sovereign Inference', 'fugu-ultra');
const upd = update.createUpdateController({ currentVersion: '0.1.24', platform: 'win32', arch: 'x64', packaged: true });
console.log(JSON.stringify({
  telemetryPatternsBlocked: shield.TELEMETRY_URL_PATTERNS.length,
  headersStripped: shield.TELEMETRY_HEADERS_TO_STRIP.length,
  providersCount: Object.keys(shield.ASPACE_MULTI_PLATFORM_PROVIDERS).length,
  sentryBlocked: shield.isTelemetryUrl('https://o123.ingest.sentry.io/api/1/envelope/'),
  chatgptAbBlocked: shield.isTelemetryUrl('https://ab.chatgpt.com/v1/rgstr'),
  googleLogBlocked: shield.isTelemetryUrl('https://play.google.com/log?format=json'),
  updateControllerState: upd.getState().status,
  trinityRoles: Object.keys(plan.trinity),
  telemetryPurged: plan.telemetryPurged
}));
"@
    } finally {
        Pop-Location
    }
    exit $LASTEXITCODE
}

Write-Host "[Aspace OS V5] Lancement de Codex Web GPT Souverain (Zero-Telemetry Shield actif)..." -ForegroundColor Cyan
Push-Location $RepoRoot
try {
    & npx electron .
} finally {
    Pop-Location
}
