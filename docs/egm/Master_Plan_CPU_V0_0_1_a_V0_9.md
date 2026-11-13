# Master_Plan_CPU_V0_0_1_a_V0_9.md — Roadmap & Artefacts par Version (CPU — CLI-Plateformes-Unifié)

## Phase V0 — Baseline Forkée
- Clone `codex-chatgpt-web` dans `01_Forkable/FKB01_Inference/03_Inference_FreeCloud/codex-chatgpt-web` (branche `aspace-v5-native`).

## Phase V0.0.1 — Bouclier Souverain & Déverrouillage Basic -> Full
- [x] `aspace-telemetry-shield.cjs` + `start-aspace-codex-web.ps1 -VerifyOnly`.
- [x] Localisation FR, retrait `zh-CN`/`zh-TW`.
- [x] Suppression des blocages UI/IPC (onboarding social, smoke gate, MCP, Paramètres, `ZeroRiskModelMenu`).
- [x] Suppression du binaire portable basic dans `Downloads` & création raccourci persistant Menu Démarrer.

## Phase V0.1 — CPU (Phases 1–9 : Paliers 1–3 + Phases 4–6 + Phases 7–9)
- [x] **Paliers 1–3 (Phases 1–3)** : `Amdkn/agent-browser` + `Amdkn/agent-desktop` + endpoints `/v1/chat/completions`, `/v1/messages`, `/v1/aspace/paliers` + CLI `palier status/export`.
- [x] **Phase 4 (Chrome Local Natif Win32 & UI)** : démon `aspace-win32-embed.exe serve`, `HostForm` DPI-aware, répartition 18 plateformes en 4 groupes (`LLM`, `Google Lab`, `Modèles Chinois`, `Local / Fugu`).
- [x] **Phase 5 (Drive Manifests → Goldfish Factory)** : dispatcher `dispatchDriveManifestToEgmGoldfish` + `/v1/aspace/egm/dispatch` & `/v1/aspace/egm/missions` + CLI `palier dispatch-manifest` + UI `SuperAgentSurface` + workflows `.github/workflows/aspace-drive-dispatch.yml` & `apps-script-drive-to-github-chat.gs` (double dossier `CPU-CLI` & `CPU CLI-Plateformes-Unifier`) + sync Drive LDo8. *(Déclenchement cloud Apps Script ↔ GitHub PAT à activer dans Google Workspace une fois `GITHUB_PAT` saisi).*
- [ ] **Phase 6 (SuperAgent `:3082` × Dev Auto-Merge × Space LD08)** : `allow_auto_merge: true` activé sur GitHub et workflows validés ; preuve webhook Space LD08 temps réel à valider dès fourniture d'une URL Space.
- [ ] **Phases 7–9 (`V0.1`) puis `V0.2` à `V0.9` (9 phases par version avant `V1`)** : maîtrise du Sidebar (P7), fusion Orca worktree (P8), endpoint agnostique pour FreeLLMAPI `:31415` (P9).

> Contrat vérifiable détaillé : `V0.1_Phases_1_9_CPU_Contrat.md` · Synchronisation Drive cible : `A3 GEORGIOU — LD08 Impact / A'Space V5 / CPU-CLI & CPU CLI-Plateformes-Unifier`.
