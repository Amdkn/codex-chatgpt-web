import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";

export type PalierStage = 1 | 2 | 3;

export interface Fkb04ToolStatus {
  id: "agent-browser" | "agent-desktop" | "api-anything" | "rea" | "CLI-Anything" | "hermes-agent";
  palier: PalierStage;
  repoPath: string;
  repoPresent: boolean;
  cliAvailable: boolean;
  cliVersion: string | null;
}

export interface SovereignWebPlatform {
  id: string;
  name: string;
  origin: string;
  newChatUrl: string;
  region: "western" | "chinese" | "local";
}

export type AgnosticCliHarness =
  | "codex"
  | "claude-code"
  | "opencode"
  | "hermes-agent"
  | "openclaw"
  | "pi"
  | "dsh";

export const SOVEREIGN_WEB_PLATFORMS: readonly SovereignWebPlatform[] = [
  { id: "chatgpt", name: "ChatGPT Web", origin: "https://chatgpt.com", newChatUrl: "https://chatgpt.com/", region: "western" },
  { id: "gemini", name: "Google Gemini Web", origin: "https://gemini.google.com", newChatUrl: "https://gemini.google.com/app", region: "western" },
  { id: "claude", name: "Claude Web", origin: "https://claude.ai", newChatUrl: "https://claude.ai/new", region: "western" },
  { id: "grok", name: "xAI Grok Web", origin: "https://grok.com", newChatUrl: "https://grok.com/", region: "western" },
  { id: "muse", name: "Muse AI", origin: "https://muse.ai", newChatUrl: "https://muse.ai/", region: "western" },
  { id: "deepseek", name: "DeepSeek Chat", origin: "https://chat.deepseek.com", newChatUrl: "https://chat.deepseek.com/", region: "chinese" },
  { id: "qwen", name: "Qwen Chat", origin: "https://chat.qwen.ai", newChatUrl: "https://chat.qwen.ai/", region: "chinese" },
  { id: "zai", name: "Z.ai (GLM)", origin: "https://chat.z.ai", newChatUrl: "https://chat.z.ai/", region: "chinese" },
  { id: "kimi", name: "Moonshot Kimi Web", origin: "https://kimi.moonshot.cn", newChatUrl: "https://kimi.moonshot.cn/", region: "chinese" },
  { id: "feishu", name: "Feishu Open / Bot", origin: "https://open.feishu.cn", newChatUrl: "https://open.feishu.cn/", region: "chinese" },
  { id: "lark", name: "Lark Suite (Global)", origin: "https://www.larksuite.com", newChatUrl: "https://www.larksuite.com/", region: "chinese" },
  { id: "sakana", name: "Sakana AI (Fugu)", origin: "https://chat.sakana.ai", newChatUrl: "https://chat.sakana.ai/", region: "local" },
];

export const SUPPORTED_CLI_HARNESSES: readonly AgnosticCliHarness[] = [
  "codex",
  "claude-code",
  "opencode",
  "hermes-agent",
  "openclaw",
  "pi",
  "dsh",
];

/** Resolve the FKB04_Tools_Anything directory inside the Aspace OS V5 workspace. */
export function resolveFkb04Root(startDir = import.meta.dir): string {
  const candidates = [
    process.env.ASPACE_FKB04_ROOT,
    resolve(startDir, "../../../../FKB04_Tools_Anything"),
    resolve(process.cwd(), "../../FKB04_Tools_Anything"),
    "C:\\Users\\amado\\Aspace OS V5\\01_Forkable\\FKB04_Tools_Anything",
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return candidates[0]!;
}

function probeCliVersion(command: string, args: string[] = ["--version"]): { available: boolean; version: string | null } {
  try {
    const result = spawnSync(command, args, {
      encoding: "utf8",
      timeout: 3000,
      windowsHide: true,
      shell: process.platform === "win32",
    });
    if (result.status !== 0) return { available: false, version: null };
    const line = (result.stdout || result.stderr || "").trim().split(/\r?\n/)[0] || null;
    return { available: true, version: line };
  } catch {
    return { available: false, version: null };
  }
}

/** Inspect readiness across Palier 1 (Web), Palier 2 (Plus Desktop), and Palier 3 (Pro Multi-CLI). */
export function collectPalierReadiness(fkb04Root = resolveFkb04Root()): {
  paliers: {
    palier1_web_stabilized: { ready: boolean; stack: string[] };
    palier2_plus_desktop: { ready: boolean; stack: string[] };
    palier3_pro_agnostic: { ready: boolean; endpoints: string[]; harnesses: readonly AgnosticCliHarness[] };
    phase4_local_chrome: { preferLocalChrome: boolean; cdpPort: number; endpoint: string };
    phase5_drive_egm: { ready: boolean; endpoints: string[]; cli: string; workflows: string[] };
  };
  tools: Fkb04ToolStatus[];
  platforms: readonly SovereignWebPlatform[];
} {
  const agentBrowserCli = probeCliVersion("agent-browser");
  const agentDesktopCli = probeCliVersion("agent-desktop");

  const tools: Fkb04ToolStatus[] = [
    {
      id: "agent-browser",
      palier: 1,
      repoPath: join(fkb04Root, "agent-browser"),
      repoPresent: existsSync(join(fkb04Root, "agent-browser")),
      cliAvailable: agentBrowserCli.available,
      cliVersion: agentBrowserCli.version,
    },
    {
      id: "api-anything",
      palier: 1,
      repoPath: join(fkb04Root, "api-anything"),
      repoPresent: existsSync(join(fkb04Root, "api-anything")),
      cliAvailable: existsSync(join(fkb04Root, "api-anything", "package.json")),
      cliVersion: null,
    },
    {
      id: "rea",
      palier: 1,
      repoPath: join(fkb04Root, "rea"),
      repoPresent: existsSync(join(fkb04Root, "rea")),
      cliAvailable: existsSync(join(fkb04Root, "rea", "package.json")),
      cliVersion: null,
    },
    {
      id: "agent-desktop",
      palier: 2,
      repoPath: join(fkb04Root, "agent-desktop"),
      repoPresent: existsSync(join(fkb04Root, "agent-desktop")),
      cliAvailable: agentDesktopCli.available,
      cliVersion: agentDesktopCli.version,
    },
    {
      id: "CLI-Anything",
      palier: 2,
      repoPath: join(fkb04Root, "CLI-Anything"),
      repoPresent: existsSync(join(fkb04Root, "CLI-Anything")),
      cliAvailable: existsSync(join(fkb04Root, "CLI-Anything", "README.md")),
      cliVersion: null,
    },
    {
      id: "hermes-agent",
      palier: 3,
      repoPath: join(fkb04Root, "hermes-agent"),
      repoPresent: existsSync(join(fkb04Root, "hermes-agent")),
      cliAvailable: existsSync(join(fkb04Root, "hermes-agent")),
      cliVersion: null,
    },
  ];

  const palier1Ready = tools.filter(t => t.palier === 1).every(t => t.repoPresent) && agentBrowserCli.available;
  const palier2Ready = tools.filter(t => t.palier === 2).every(t => t.repoPresent) && agentDesktopCli.available;

  return {
    paliers: {
      palier1_web_stabilized: {
        ready: palier1Ready,
        stack: ["agent-browser (CDP/@ref)", "api-anything (HTTP JSON)", "rea (protocol reverse)"],
      },
      palier2_plus_desktop: {
        ready: palier2Ready,
        stack: ["CLI-Anything (JSON harnesses)", "agent-desktop (OS AX Tree / MCP)"],
      },
      palier3_pro_agnostic: {
        ready: true,
        endpoints: ["/v1/responses", "/v1/chat/completions", "/v1/messages", "/v1/aspace/paliers"],
        harnesses: SUPPORTED_CLI_HARNESSES,
      },
      phase4_local_chrome: {
        preferLocalChrome: process.env.ASPACE_PREFER_LOCAL_CHROME !== "0",
        cdpPort: resolvePreferredCdpPort(),
        endpoint: `http://127.0.0.1:${resolvePreferredCdpPort()}`,
      },
      phase5_drive_egm: {
        ready: true,
        endpoints: ["/v1/aspace/egm/dispatch", "/v1/aspace/egm/missions"],
        cli: "palier dispatch-manifest",
        workflows: [".github/workflows/aspace-drive-dispatch.yml", "docs/egm/apps-script-drive-to-github-chat.gs"],
      },
    },
    tools,
    platforms: SOVEREIGN_WEB_PLATFORMS,
  };
}

/** Resolve preferred CDP port (Phase 4 Local Chrome 9222 by default). */
export function resolvePreferredCdpPort(fallbackPort = 9222): number {
  const raw = process.env.ASPACE_LOCAL_CHROME_CDP_PORT;
  const parsed = Number.parseInt(String(raw ?? ""), 10);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65535 ? parsed : fallbackPort;
}

/** Probe whether a Local Chrome CDP endpoint is reachable on 127.0.0.1:<port>. */
export async function probeLocalChromeCdpEndpoint(port = resolvePreferredCdpPort()): Promise<{
  available: boolean;
  cdpPort: number;
  endpoint: string;
  browser?: string;
  webSocketDebuggerUrl?: string;
  reason?: string;
}> {
  const endpoint = `http://127.0.0.1:${port}`;
  try {
    const res = await fetch(`${endpoint}/json/version`, { signal: AbortSignal.timeout(600) });
    if (!res.ok) return { available: false, cdpPort: port, endpoint, reason: `HTTP ${res.status}` };
    const data = (await res.json()) as Record<string, unknown>;
    if (typeof data.webSocketDebuggerUrl !== "string") {
      return { available: false, cdpPort: port, endpoint, reason: "invalid-version-payload" };
    }
    return {
      available: true,
      cdpPort: port,
      endpoint,
      browser: typeof data.Browser === "string" ? data.Browser : "Chrome",
      webSocketDebuggerUrl: data.webSocketDebuggerUrl,
    };
  } catch (error) {
    return { available: false, cdpPort: port, endpoint, reason: error instanceof Error ? error.message : String(error) };
  }
}

/** Build a zero-telemetry command invocation for Palier 1 `agent-browser`. */
export function buildAgentBrowserCommand(args: string[], cdpPort?: number): {
  command: string;
  args: string[];
  env: Record<string, string>;
} {
  const effectivePort = cdpPort ?? (process.env.ASPACE_PREFER_LOCAL_CHROME !== "0" ? resolvePreferredCdpPort() : undefined);
  const fullArgs = effectivePort ? ["--cdp", String(effectivePort), ...args] : [...args];
  return {
    command: "agent-browser",
    args: fullArgs,
    env: { DO_NOT_TRACK: "1", ASPACE_ZERO_TELEMETRY: "1" },
  };
}

/** Build a zero-telemetry command invocation for Palier 2 `agent-desktop`. */
export function buildAgentDesktopCommand(args: string[]): {
  command: string;
  args: string[];
  env: Record<string, string>;
} {
  return {
    command: "agent-desktop",
    args: [...args],
    env: { DO_NOT_TRACK: "1", ASPACE_ZERO_TELEMETRY: "1" },
  };
}

export const DEFAULT_CCW_WEB_MODEL = "chatgpt-web/gpt-5.6-sol";

function resolveAgnosticModelSlug(requested: unknown): string {
  if (typeof requested === "string" && requested.startsWith("chatgpt-web/")) {
    return requested;
  }
  return DEFAULT_CCW_WEB_MODEL;
}

/** Translate an OpenAI `/v1/chat/completions` payload into CCW's `/v1/responses` payload. */
export function normalizeChatCompletionsToResponsesRequest(body: Record<string, unknown>): Record<string, unknown> {
  const rawMessages = Array.isArray(body.messages) ? body.messages : [];
  const systemParts: string[] = [];
  const inputItems: Array<{ role: string; content: unknown }> = [];

  for (const msg of rawMessages) {
    if (!msg || typeof msg !== "object") continue;
    const record = msg as Record<string, unknown>;
    const role = typeof record.role === "string" ? record.role : "user";
    if (role === "system" || role === "developer") {
      if (typeof record.content === "string" && record.content.trim()) {
        systemParts.push(record.content);
      }
      continue;
    }
    inputItems.push({ role, content: record.content ?? "" });
  }

  return {
    model: resolveAgnosticModelSlug(body.model),
    instructions: systemParts.length > 0 ? systemParts.join("\n\n") : undefined,
    input: inputItems,
    stream: Boolean(body.stream),
    ...(Array.isArray(body.tools) ? { tools: body.tools } : {}),
  };
}

/** Extract plain assistant text from a `/v1/responses` JSON payload. */
export function extractTextFromResponsesJson(responseJson: Record<string, unknown>): string {
  if (typeof responseJson.output_text === "string" && responseJson.output_text) {
    return responseJson.output_text;
  }
  const output = Array.isArray(responseJson.output) ? responseJson.output : [];
  const chunks: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const content = (item as Record<string, unknown>).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (part && typeof part === "object" && typeof (part as Record<string, unknown>).text === "string") {
        chunks.push((part as Record<string, unknown>).text as string);
      }
    }
  }
  return chunks.join("");
}

/** Format a CCW `/v1/responses` JSON object into standard OpenAI `/v1/chat/completions` JSON. */
export function formatResponsesJsonAsChatCompletions(
  responseJson: Record<string, unknown>,
  fallbackModel = "gpt-5.4",
): Record<string, unknown> {
  const text = extractTextFromResponsesJson(responseJson);
  const model = typeof responseJson.model === "string" ? responseJson.model : fallbackModel;
  const usage = (responseJson.usage && typeof responseJson.usage === "object"
    ? responseJson.usage
    : {}) as Record<string, unknown>;
  return {
    id: `chatcmpl-${typeof responseJson.id === "string" ? responseJson.id : Date.now().toString(36)}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: text },
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: Number(usage.input_tokens ?? 0),
      completion_tokens: Number(usage.output_tokens ?? 0),
      total_tokens: Number(usage.total_tokens ?? 0),
    },
  };
}

/** Translate an Anthropic `/v1/messages` payload (Claude Code / Hermes) into `/v1/responses`. */
export function normalizeAnthropicMessagesToResponsesRequest(body: Record<string, unknown>): Record<string, unknown> {
  const rawMessages = Array.isArray(body.messages) ? body.messages : [];
  const inputItems = rawMessages
    .filter((m): m is Record<string, unknown> => Boolean(m && typeof m === "object"))
    .map(m => ({
      role: typeof m.role === "string" ? m.role : "user",
      content: Array.isArray(m.content)
        ? m.content
            .map(part => (part && typeof part === "object" && typeof (part as Record<string, unknown>).text === "string"
              ? (part as Record<string, unknown>).text
              : ""))
            .join("")
        : (m.content ?? ""),
    }));

  return {
    model: resolveAgnosticModelSlug(body.model),
    instructions: typeof body.system === "string" ? body.system : undefined,
    input: inputItems,
    stream: Boolean(body.stream),
  };
}

/** Format a CCW `/v1/responses` JSON object into standard Anthropic `/v1/messages` JSON. */
export function formatResponsesJsonAsAnthropicMessage(
  responseJson: Record<string, unknown>,
  fallbackModel = "gpt-5.4",
): Record<string, unknown> {
  const text = extractTextFromResponsesJson(responseJson);
  const usage = (responseJson.usage && typeof responseJson.usage === "object"
    ? responseJson.usage
    : {}) as Record<string, unknown>;
  return {
    id: `msg_${typeof responseJson.id === "string" ? responseJson.id : Date.now().toString(36)}`,
    type: "message",
    role: "assistant",
    model: typeof responseJson.model === "string" ? responseJson.model : fallbackModel,
    content: [{ type: "text", text }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: {
      input_tokens: Number(usage.input_tokens ?? 0),
      output_tokens: Number(usage.output_tokens ?? 0),
    },
  };
}

/** Generate ready-to-use Palier 3 integration config for any supported CLI harness. */
export function exportCliHarnessConfig(
  harness: AgnosticCliHarness,
  port = 17841,
): { harness: AgnosticCliHarness; protocol: string; baseUrl: string; env: Record<string, string>; notes: string } {
  const baseUrl = `http://127.0.0.1:${port}/v1`;
  switch (harness) {
    case "claude-code":
      return {
        harness,
        protocol: "anthropic-messages",
        baseUrl: `http://127.0.0.1:${port}`,
        env: { ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}`, ANTHROPIC_API_KEY: "ccw-local-sovereign" },
        notes: "Claude Code talks to CCW via /v1/messages (Palier 3 agnostic bridge).",
      };
    case "opencode":
    case "hermes-agent":
    case "openclaw":
    case "pi":
    case "dsh":
      return {
        harness,
        protocol: "openai-chat-completions",
        baseUrl,
        env: { OPENAI_BASE_URL: baseUrl, OPENAI_API_KEY: "ccw-local-sovereign" },
        notes: `${harness} talks to CCW via /v1/chat/completions or /v1/responses.`,
      };
    case "codex":
    default:
      return {
        harness: "codex",
        protocol: "openai-responses",
        baseUrl,
        env: { OPENAI_BASE_URL: baseUrl },
        notes: "Native Codex route via /v1/responses.",
      };
  }
}
