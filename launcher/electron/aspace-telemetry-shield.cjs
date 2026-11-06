/**
 * Aspace OS V5 — Sovereign Zero-Telemetry Shield & Multi-Platform Fugu Inference Hub
 * for `01_Forkable/FKB01_Inference/codex-chatgpt-web`
 *
 * 1. Blocks all telemetry, analytics, crash-reporting, fingerprinting, and beacon requests
 *    at the Electron session level (`webRequest.onBeforeRequest` & `onBeforeSendHeaders`)
 *    and at the DOM level (`navigator.sendBeacon` no-op) BEFORE any Google/Gmail or AI account sign-in.
 * 2. Extends Codex Web GPT to all Sovereign Web Platforms:
 *    - ChatGPT (`https://chatgpt.com/`)
 *    - Google Gemini (`https://gemini.google.com/app`)
 *    - Muse AI (`https://muse.ai/`)
 *    - Claude (`https://claude.ai/new`)
 *    - DeepSeek (`https://chat.deepseek.com/`)
 *    - Z.ai / GLM (`https://chat.z.ai/`)
 *    - Qwen (`https://chat.qwen.ai/`)
 *    - Sakana AI (`https://chat.sakana.ai/`)
 * 3. Integrates with Local Sovereign Models (`LFM3-Omni-2B` on 127.0.0.1:9931, Needle 3, GLiNER2.5-multi-Decide),
 *    `FreeLLMAPI` (127.0.0.1:31415), `api-anything`, `CLI-Anything`, and `rea` under Sakana AI's Fugu
 *    (Conductor + TRINITY Thinker/Worker/Verifier) with quota-aware rotation.
 */

const TELEMETRY_URL_PATTERNS = [
  /sentry\.io/i,
  /ingest\.sentry\.io/i,
  /ab\.chatgpt\.com/i,
  /chatgpt\.com\/ces\/v1\//i,
  /chatgpt\.com\/backend-api\/lat\//i,
  /chatgpt\.com\/backend-api\/sentinel\/telemetry/i,
  /statsigapi\.net/i,
  /events\.statsigapi\.net/i,
  /featuregates\.org/i,
  /segment\.io/i,
  /segment\.com/i,
  /amplitude\.com/i,
  /datadoghq\.com/i,
  /browser-intake-datadoghq\.com/i,
  /intercom\.io/i,
  /intercomcdn\.com/i,
  /google-analytics\.com/i,
  /analytics\.google\.com/i,
  /googletagmanager\.com/i,
  /doubleclick\.net/i,
  /play\.google\.com\/log/i,
  /clarity\.ms/i,
  /hotjar\.com/i,
  /launchdarkly\.com/i,
];

const TELEMETRY_HEADERS_TO_STRIP = [
  "sentry-trace",
  "baggage",
  "x-statsig-id",
  "oai-telemetry",
  "x-datadog-trace-id",
  "x-datadog-parent-id",
  "x-datadog-sampling-priority",
];

const ASPACE_MULTI_PLATFORM_PROVIDERS = Object.freeze({
  chatgpt: {
    id: "chatgpt",
    name: "ChatGPT Web",
    origin: "https://chatgpt.com",
    newChatUrl: "https://chatgpt.com/",
    kind: "web",
    supportsContextExport: true,
  },
  gemini: {
    id: "gemini",
    name: "Google Gemini Web",
    origin: "https://gemini.google.com",
    newChatUrl: "https://gemini.google.com/app",
    kind: "web",
    supportsContextExport: true,
  },
  muse: {
    id: "muse",
    name: "Muse AI",
    origin: "https://muse.ai",
    newChatUrl: "https://muse.ai/",
    kind: "web",
    supportsContextExport: true,
  },
  claude: {
    id: "claude",
    name: "Claude Web",
    origin: "https://claude.ai",
    newChatUrl: "https://claude.ai/new",
    kind: "web",
    supportsContextExport: true,
  },
  deepseek: {
    id: "deepseek",
    name: "DeepSeek Chat",
    origin: "https://chat.deepseek.com",
    newChatUrl: "https://chat.deepseek.com/",
    kind: "web",
    supportsContextExport: true,
  },
  zai: {
    id: "zai",
    name: "Z.ai (GLM)",
    origin: "https://chat.z.ai",
    newChatUrl: "https://chat.z.ai/",
    kind: "web",
    supportsContextExport: true,
  },
  qwen: {
    id: "qwen",
    name: "Qwen Chat",
    origin: "https://chat.qwen.ai",
    newChatUrl: "https://chat.qwen.ai/",
    kind: "web",
    supportsContextExport: true,
  },
  sakana: {
    id: "sakana",
    name: "Sakana AI (Fugu / Namazu)",
    origin: "https://chat.sakana.ai",
    newChatUrl: "https://chat.sakana.ai/",
    kind: "web",
    supportsContextExport: true,
  },
  lfm3_local: {
    id: "lfm3_local",
    name: "Liquid AI LFM3-Omni-2B (Local llama.cpp :9931)",
    origin: "http://127.0.0.1:9931",
    apiBaseUrl: "http://127.0.0.1:9931/v1",
    modelId: "ggml-org/LFM3-Omni-2B-GGUF:Q8_0",
    kind: "local-api",
    supportsContextExport: true,
  },
  freellmapi: {
    id: "freellmapi",
    name: "FreeLLMAPI Sovereign Router (:31415)",
    origin: "http://127.0.0.1:31415",
    apiBaseUrl: "http://127.0.0.1:31415/v1",
    modelId: "freellmapi/auto",
    kind: "local-api",
    supportsContextExport: true,
  },
});

const ASPACE_AUTH_PROVIDER_HOSTS = new Set([
  "auth.openai.com",
  "auth0.openai.com",
  "login.openai.com",
  "accounts.openai.com",
  "accounts.google.com",
  "login.microsoftonline.com",
  "appleid.apple.com",
  "idmsa.apple.com",
  "chatgpt.com",
  "gemini.google.com",
  "claude.ai",
  "muse.ai",
  "chat.deepseek.com",
  "chat.z.ai",
  "chat.qwen.ai",
  "chat.sakana.ai",
]);

function isTelemetryUrl(url) {
  if (typeof url !== "string" || !url) return false;
  return TELEMETRY_URL_PATTERNS.some((pattern) => pattern.test(url));
}

function sanitizeTelemetryHeaders(requestHeaders = {}) {
  const cleaned = { ...requestHeaders };
  for (const key of Object.keys(cleaned)) {
    if (TELEMETRY_HEADERS_TO_STRIP.includes(key.toLowerCase())) {
      delete cleaned[key];
    }
  }
  cleaned["DNT"] = "1";
  cleaned["Sec-GPC"] = "1";
  return cleaned;
}

const ASPACE_DOM_TELEMETRY_SHIELD_SCRIPT = `(() => {
  if (globalThis.__ASPACE_TELEMETRY_SHIELD_ACTIVE__) return true;
  Object.defineProperty(globalThis, "__ASPACE_TELEMETRY_SHIELD_ACTIVE__", {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false,
  });
  if (typeof navigator !== "undefined") {
    try {
      navigator.sendBeacon = () => true;
    } catch {}
  }
  return true;
})()`;

const installedSessions = new WeakSet();

function installAspaceTelemetryShield(browserSession, logger) {
  if (!browserSession || installedSessions.has(browserSession)) {
    return { installed: Boolean(browserSession), blockedCount: () => 0 };
  }
  installedSessions.add(browserSession);
  let blockedRequests = 0;

  if (browserSession.webRequest && typeof browserSession.webRequest.onBeforeRequest === "function") {
    browserSession.webRequest.onBeforeRequest((details, callback) => {
      if (isTelemetryUrl(details?.url)) {
        blockedRequests += 1;
        logger?.info?.("aspace.telemetry_shield.blocked", {
          url: details.url.slice(0, 140),
          blockedRequests,
        });
        callback({ cancel: true });
        return;
      }
      callback({ cancel: false });
    });
  }

  if (browserSession.webRequest && typeof browserSession.webRequest.onBeforeSendHeaders === "function") {
    browserSession.webRequest.onBeforeSendHeaders((details, callback) => {
      const requestHeaders = sanitizeTelemetryHeaders(details?.requestHeaders || {});
      callback({ requestHeaders });
    });
  }

  return {
    installed: true,
    blockedCount: () => blockedRequests,
  };
}

/**
 * Sakana AI Fugu Conductor + TRINITY (Thinker / Worker / Verifier) Quota-Aware Router.
 * Selects the optimal inference source across local LFM3-Omni (:9931), FreeLLMAPI (:31415),
 * and the 8 Web platforms while cooling down any quota-exhausted provider.
 */
class AspaceFuguRouter {
  constructor() {
    this.cooldownUntil = new Map();
  }

  markQuotaExhausted(providerId, cooldownMs = 15 * 60 * 1000) {
    this.cooldownUntil.set(providerId, Date.now() + cooldownMs);
  }

  isAvailable(providerId, now = Date.now()) {
    const until = this.cooldownUntil.get(providerId);
    if (!until) return true;
    if (now >= until) {
      this.cooldownUntil.delete(providerId);
      return true;
    }
    return false;
  }

  planTrinityWorkflow(task, variant = "fugu") {
    const providers = Object.keys(ASPACE_MULTI_PLATFORM_PROVIDERS).filter((id) => this.isAvailable(id));
    const pickFirst = (candidates) => candidates.find((c) => providers.includes(c)) || providers[0] || "lfm3_local";

    const conductor = pickFirst(["lfm3_local", "freellmapi", "sakana"]);
    const thinker =
      variant === "fugu-cyber"
        ? pickFirst(["claude", "freellmapi", "deepseek", "lfm3_local"])
        : pickFirst(["claude", "chatgpt", "gemini", "freellmapi", "lfm3_local"]);
    const worker = pickFirst(["freellmapi", "deepseek", "qwen", "zai", "chatgpt", "lfm3_local"]);
    const verifier = pickFirst(["lfm3_local", "gemini", "claude", "freellmapi"]);

    return {
      orchestrator: "Sakana AI Fugu (Conductor 7B RL + TRINITY)",
      variant,
      task,
      conductor: {
        providerId: conductor,
        models: [
          "ggml-org/LFM3-Omni-2B-GGUF:Q8_0 (127.0.0.1:9931)",
          "LiquidAI/LFM3-Decision",
          "cactus-compute/needle-3",
          "fastino/GLiNER2.5-multi-Decide",
        ],
      },
      trinity: {
        thinker: {
          role: "Thinker (1D EGM Elephant + Architecture Spec)",
          providerId: thinker,
          instruction: `Produce Clean-Room specification and 3-OS Holon plan for: ${task}`,
        },
        worker: {
          role: "Worker (1D EGM Goldfish Isolated Execution)",
          providerId: worker,
          instruction: `Execute surgical implementation and automated tests for: ${task}`,
        },
        verifier: {
          role: "Verifier (Outside Judge + S1-RICK + S3-YAZ + Rory MiroFish Wargame)",
          providerId: verifier,
          instruction: `Audit output against raw sources, R10 receipt, and zero-telemetry policy for: ${task}`,
        },
      },
      recursiveTestTimeScaling: true,
      telemetryPurged: true,
    };
  }
}

module.exports = {
  ASPACE_AUTH_PROVIDER_HOSTS,
  ASPACE_DOM_TELEMETRY_SHIELD_SCRIPT,
  ASPACE_MULTI_PLATFORM_PROVIDERS,
  AspaceFuguRouter,
  installAspaceTelemetryShield,
  isTelemetryUrl,
  sanitizeTelemetryHeaders,
  TELEMETRY_HEADERS_TO_STRIP,
  TELEMETRY_URL_PATTERNS,
};
