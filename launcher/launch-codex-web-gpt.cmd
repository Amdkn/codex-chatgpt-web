@echo off
set "ASPACE_ZERO_TELEMETRY=1"
set "ASPACE_ALLOW_EXTERNAL_UPDATE=0"
set "DO_NOT_TRACK=1"
set "CODEX_CHATGPT_WEB_BUN=C:\Users\amado\.bun\bin\bun.exe"
set "PATH=C:\Users\amado\.bun\bin;%PATH%"
cd /d "C:\Users\amado\Aspace OS V5\01_Forkable\FKB01_Inference\03_Inference_FreeCloud\codex-chatgpt-web\launcher"
start "" "node_modules\electron\dist\electron.exe" .