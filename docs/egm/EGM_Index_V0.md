# EGM Index V0 -> V0.0.1 -> V0.1 -> V0.2..V0.9 — CPU (CLI-Plateformes-Unifié, ex-Codex Web GPT)

> **Modèle Éléphant–Poisson Rouge (EGM)** : *Design with an elephant (contexte V5 complet). Review with a goldfish (contrats vérifiables sans contexte caché).*
> **Dossier cible Drive LDo8** : `https://drive.google.com/drive/folders/1w03PhL-jBA6bEyW7VeGblyzKS6mOzxgJ` -> `A'Space V5/CPU-CLI/` & `CPU CLI-Plateformes-Unifier/`

---

## 1. Cartographie des Versions (`V0` -> `V0.1` -> `V1`)

| Version | Identité | Périmètre & Transformations Réelles | Preuves / Tests / Backends |
|---|---|---|---|
| **V0** | `Codex Web GPT` (Fork brut amont `6.1.17`) | Pont local `/v1/responses` -> `chatgpt.com` via Electron `WebContentsView` + Playwright/CDP. Verrouillé sur Codex seul, anglais/chinois UI, barrières sociales & smoke obligatoire. | `src/server.ts`, `src/cli.ts`, `launcher/electron/browser-host.cjs`, `tests/*.test.ts` |
| **V0.0.1** | `Fork Souverain Débridé & Zéro-Télémétrie` | 1. **Purge télémétrie & phone-home** (`aspace-telemetry-shield.cjs`, 24 patterns bloqués, 7 headers supprimés, auto-update GitHub désactivé).<br>2. **Localisation FR & suppression `zh-CN`/`zh-TW`**.<br>3. **Déverrouillage intégral** (onboarding sans GitHub/X, installation sans smoke obligatoire, MCP & Paramètres débloqués avant setup, `preferenceCliArgs`).<br>4. **Installation durable Windows** (Menu Démarrer `Codex Web GPT.lnk`, `launch-codex-web-gpt.vbs`). | `start-aspace-codex-web.ps1 -VerifyOnly` (exit 0), `bun test ./tests/*.test.ts` (`1112 pass, 0 fail`), `node --test` (`412 pass, 0 fail`) |
| **V0.1 (CPU)** | `CLI-Web-Platform Unifié` (Paliers 1–3) | **Palier 1 (Web Stabilisé)** : `Amdkn/agent-browser` (`0.42.0`, `@ref` + CDP) + `api-anything` + `rea` + sélecteur compact `+ Plateformes` (Occidentales + Chinoises incl. **Feishu/Lark** `open.feishu.cn` / `larksuite.com`).<br>**Palier 2 (Plus Desktop)** : `CLI-Anything` + `Amdkn/agent-desktop` (`1.2.0`, Windows UIA sans vol de focus).<br>**Palier 3 (Pro Agnostique)** : Endpoints `/v1/responses`, `/v1/chat/completions`, `/v1/messages`, `/v1/aspace/paliers` + CLI `palier status/export` pour Codex, Claude Code, OpenCode, Hermes Agent, OpenClaw, Pi, `dsh`. | `src/adapters/aspace-palier-orchestrator.ts`, `tests/aspace-palier-orchestrator.test.ts` (`5 pass, 0 fail`), `launcher/electron/browser-host.cjs` (`134 pass, 0 fail`) |

---

## 2. Contrats de Modules & Frontières (Goldfish-Checkable)

| Sous-système | Entrée | Sortie / Invariant | Commande de vérification |
|---|---|---|---|
| **Bouclier Télémétrie** (`launcher/electron/aspace-telemetry-shield.cjs`) | Requête Electron `webRequest` / `navigator.sendBeacon` | Bloque 24 domaines télémétrie, retire 7 headers, maintient 14 providers souverains (`providersCount: 14`). | `pwsh -NoProfile -File start-aspace-codex-web.ps1 -VerifyOnly` |
| **Orchestrateur Paliers 1–3** (`src/adapters/aspace-palier-orchestrator.ts`) | Requête OpenAI `/v1/chat/completions`, Anthropic `/v1/messages`, ou CLI `palier` | Normalise vers `/v1/responses` (`chatgpt-web/gpt-5.6-sol` par défaut), sonde `FKB04_Tools_Anything` + `agent-browser`/`agent-desktop`. | `bun test tests/aspace-palier-orchestrator.test.ts` |
| **Cockpit Electron** (`launcher/electron/browser-host.cjs`, `launcher/src/App.tsx`) | Action utilisateur (`openPlatformTab`, `selectTab`, `closeTab`) | Ouvre une `WebContentsView` isolée sans `enableDeviceEmulation` avant `dom-ready` (`tab.isPlatformTab`). | `node --test launcher/tests/browser-host.test.cjs` |
