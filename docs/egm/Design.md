# CPU V0 -> V0.0.1 -> V0.1 — Design.md (Architecture & Interfaces)

```
┌─────────────────────────────────────────────────────────────────────────┐
│ HARNESSES CLI AGNOSTIQUES (Palier 3 Pro)                                │
│  Codex | Claude Code | OpenCode | Hermes | OpenClaw | Pi | dsh / Feishu │
└───────────┬─────────────────────┬──────────────────────┬────────────────┘
            │ /v1/responses       │ /v1/chat/completions │ /v1/messages
┌───────────▼─────────────────────▼──────────────────────▼────────────────┐
│ CPU SERVER & ORCHESTRATEUR (src/server.ts + aspace-palier-orchestrator) │
├──────────────────────────────┬──────────────────────────────────────────┤
│ PALIER 1 · WEB STABILISÉ     │ PALIER 2 · DESKTOP / APPS TÉLÉCHARGÉES   │
│ • REA (reverse protocole)    │ • CLI-Anything (harnesses JSON natifs)   │
│ • API-Anything (HTTP JSON)   │ • agent-desktop (OS UIA @ref / MCP)      │
│ • agent-browser (CDP @ref)   │                                          │
│ • Electron Cockpit (+ Select)│                                          │
└──────────────────────────────┴──────────────────────────────────────────┘
```

## Décisions d'ingénierie clés
- **Sélecteur `<select>` natif dans le header** : sous Windows/Electron, une liste déroulante HTML `<div>` est recouverte par la surface native `WebContentsView`. Le `<select>` natif OS passe toujours au-dessus et maintient la barre d'onglets compacte même avec des dizaines de plateformes (incluant Feishu Bot / Lark).
- **Séparation stricte `tab.isPlatformTab`** : les onglets de plateformes souveraines ne subissent ni `enableDeviceEmulation` ni expiration de bail de tour Codex.
- **Mapping de modèle agnostique** : les requêtes `/v1/chat/completions` et `/v1/messages` portant des noms de modèles externes (ex. `claude-sonnet-4-5`, `gpt-5.4`) sont automatiquement mappées vers `chatgpt-web/gpt-5.6-sol` sauf préfixe explicite `chatgpt-web/`.
