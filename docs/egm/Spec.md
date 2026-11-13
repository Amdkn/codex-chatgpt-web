# CPU V0 -> V0.0.1 -> V0.1 — Spec.md (Spécifications Techniques & Invariants)

## 1. V0 -> V0.1 (Socle Souverain Débridé)
- **Zéro Télémétrie** : `aspace-telemetry-shield.cjs` injecté au démarrage Electron (`DO_NOT_TRACK=1`, `ASPACE_ZERO_TELEMETRY=1`, `ASPACE_ALLOW_EXTERNAL_UPDATE=0`).
- **Déverrouillage UI/IPC** :
  - Suppression des barrières GitHub/X à l'onboarding (`App.tsx`, `main.cjs`).
  - Déblocage de l'installation Codex, du mode `ZeroRiskModelMenu` Pro, de MCP et des 6 commutateurs de `Paramètres` avant `coreSetupComplete`.
  - Forwarding CLI des préférences pré-setup via `preferenceCliArgs()` (`runtime.cjs`).
- **Persistance Windows** : lanceurs `launch-codex-web-gpt.cmd` / `.vbs` et raccourci Menu Démarrer `Codex Web GPT.lnk`.

## 2. V0.1 — Les 3 Paliers CPU
1. **Palier 1 (Web Stabilisé)** :
   - Sous-modules `Amdkn/agent-browser` (`f88c40b7`, v0.42.0) + `api-anything` + `rea` dans `01_Forkable/FKB04_Tools_Anything/`.
   - Sélecteur header compact `+ Plateformes` (`App.tsx` `<select>`) gérant un nombre arbitraire de plateformes sans déborder ni être masqué par `WebContentsView`.
   - `openPlatformTab` dans `browser-host.cjs` avec `isPlatformTab: true` (pas d'émulation device avant rendu).
2. **Palier 2 (Plus Desktop)** :
   - Sous-module `Amdkn/agent-desktop` (`54855b62`, v1.2.0) + `CLI-Anything` pour piloter les applications téléchargées sous Windows via l'arbre d'accessibilité OS (UIA) sans voler le focus.
3. **Palier 3 (Pro Agnostique Multi-CLI)** :
   - Endpoints HTTP sur `src/server.ts` :
     - `GET /v1/aspace/paliers`
     - `POST /v1/chat/completions` (OpenAI-compatible)
     - `POST /v1/messages` (Anthropic-compatible)
     - `POST /v1/responses` (Codex-compatible)
   - Commandes CLI : `codex-chatgpt-web palier status` et `codex-chatgpt-web palier export <harness>`.
