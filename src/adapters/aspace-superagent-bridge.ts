/**
 * Runtime Bridge entre CPU (CLI-Plateformes-Unifié) et DeepSeek Superagent (:3082).
 * Expose l'API orchestrateur (`/orchestrator/api/*`), le provisionnement du profil
 * `superagent`, le pont Google Chat Space LD08 et l'auto-merge Dev.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

export const SUPERAGENT_PORT = Number.parseInt(process.env.ASPACE_SUPERAGENT_PORT || "3082", 10);
export const SUPERAGENT_BASE_URL = `http://127.0.0.1:${SUPERAGENT_PORT}`;
export const SUPERAGENT_REPO_PATH =
  process.env.ASPACE_SUPERAGENT_PATH ||
  "C:\\Users\\amado\\Aspace OS V5\\00_Memoire\\dsh-superagent";

export function getSuperAgentPaths() {
  const dshHome = process.env.DSH_HOME || join(homedir(), ".dsh");
  const profileDir = join(dshHome, "profiles", "superagent");
  const stateDir = join(dshHome, "state", "superagent");
  return {
    dshHome,
    profileDir,
    stateDir,
    patchPath: join(profileDir, "cordis.patch.yml"),
    bridgeConfigPath: join(stateDir, "aspace-bridge.json"),
    goldfishQueuePath: join(stateDir, "aspace-goldfish-queue.json"),
  };
}

export function readSuperAgentBridgeConfig(): Record<string, unknown> {
  try {
    const raw = readFileSync(getSuperAgentPaths().bridgeConfigPath, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function writeSuperAgentBridgeConfig(patch: Record<string, unknown>): Record<string, unknown> {
  const { stateDir, bridgeConfigPath } = getSuperAgentPaths();
  mkdirSync(stateDir, { recursive: true });
  const next = { ...readSuperAgentBridgeConfig(), ...patch, updatedAt: new Date().toISOString() };
  writeFileSync(bridgeConfigPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

export function ensureSuperAgentProfileProvisioned(): {
  profileDir: string;
  stateDir: string;
  patchPath: string;
  pluginPresent: boolean;
  endpoint: string;
} {
  const { profileDir, stateDir, patchPath } = getSuperAgentPaths();
  mkdirSync(profileDir, { recursive: true });
  mkdirSync(stateDir, { recursive: true });
  if (!existsSync(patchPath)) {
    const normalizedState = stateDir.replace(/\\/g, "/");
    const yaml = [
      "# Auto-provisioned by Aspace OS V5 CPU (CLI-Plateformes-Unifie)",
      "- id: webserver",
      "  config:",
      "    host: 127.0.0.1",
      `    port: ${SUPERAGENT_PORT}`,
      "- id: dsh-superagent",
      "  config:",
      `    stateDir: "${normalizedState}"`,
      "- id: subagent-model-selection-settings",
      '  name: "@deepseek-ai/dsh-tool-subagent/model-selection-settings"',
      "  config:",
      "    enabled: true",
      "    allowedModels:",
      "      - provider: freellmapi",
      "        model: auto",
      "      - provider: freellmapi",
      "        model: fusion",
      "",
    ].join("\n");
    writeFileSync(patchPath, yaml, "utf8");
  }
  return {
    profileDir,
    stateDir,
    patchPath,
    pluginPresent: existsSync(SUPERAGENT_REPO_PATH),
    endpoint: SUPERAGENT_BASE_URL,
  };
}

export async function callSuperAgentOrchestrator(
  method: "GET" | "POST" | "PUT",
  apiPath: string,
  body?: unknown,
  baseUrl = SUPERAGENT_BASE_URL,
): Promise<unknown> {
  const target = `${baseUrl.replace(/\/$/, "")}/orchestrator/api/${apiPath.replace(/^\//, "")}`;
  const res = await fetch(target, {
    method,
    headers: {
      "x-orchestrator-request": "1",
      origin: baseUrl.replace(/\/$/, ""),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(1500),
  });
  const text = await res.text();
  const parsed = text.trim() ? JSON.parse(text) : null;
  if (!res.ok) {
    const errMsg = parsed && typeof parsed === "object" && "error" in parsed ? String((parsed as Record<string, unknown>).error) : `HTTP ${res.status}`;
    throw new Error(errMsg);
  }
  return parsed;
}

export async function collectSuperAgentStatus(baseUrl = SUPERAGENT_BASE_URL): Promise<Record<string, unknown>> {
  const profile = ensureSuperAgentProfileProvisioned();
  const bridge = readSuperAgentBridgeConfig();
  const ld08WebhookConfigured = Boolean(
    (typeof bridge.ld08WebhookUrl === "string" && bridge.ld08WebhookUrl.trim()) ||
    process.env.GCHAT_LD08_WEBHOOK_URL,
  );
  try {
    const [state, overview, tickets, threads] = await Promise.all([
      callSuperAgentOrchestrator("GET", "state", undefined, baseUrl),
      callSuperAgentOrchestrator("GET", "overview", undefined, baseUrl).catch(() => null),
      callSuperAgentOrchestrator("GET", "tickets?state=open&limit=25", undefined, baseUrl).catch(() => null),
      callSuperAgentOrchestrator("GET", "threads?filter=all&limit=25", undefined, baseUrl).catch(() => null),
    ]);
    return {
      online: true,
      endpoint: baseUrl,
      profile,
      bridge: { ld08WebhookConfigured, devAutoMergeEnabled: bridge.devAutoMergeEnabled !== false },
      goldfishMissions: listEgmGoldfishMissions().missions.slice(0, 15),
      state,
      overview,
      tickets,
      threads,
    };
  } catch (error) {
    return {
      online: false,
      endpoint: baseUrl,
      error: error instanceof Error ? error.message : String(error),
      profile,
      bridge: { ld08WebhookConfigured, devAutoMergeEnabled: bridge.devAutoMergeEnabled !== false },
      goldfishMissions: listEgmGoldfishMissions().missions.slice(0, 15),
      state: null,
      overview: null,
      tickets: null,
      threads: null,
    };
  }
}

export interface EgmGoldfishMission {
  missionId: string;
  manifestId: string;
  manifestName: string;
  versionFolder: string;
  manifestUrl?: string;
  source: string;
  checksumSha256: string;
  excerpt: string;
  branchPolicy: string;
  prodIsolation: boolean;
  contractPath: string;
  createdAt: string;
  updatedAt: string;
  dispatches: number;
  factoryIntake?: {
    attempted: boolean;
    queued: boolean;
    ticketId?: string;
    reason?: string;
  };
  githubDispatch?: {
    attempted: boolean;
    dispatched: boolean;
    repo?: string;
    error?: string;
  };
  ld08Notification?: {
    attempted: boolean;
    delivered: boolean;
    tag?: string;
    status?: number;
    reason?: string;
  };
}

export interface DriveManifestDispatchInput {
  manifestId?: string;
  manifestName: string;
  versionFolder?: string;
  manifestUrl?: string;
  excerpt?: string;
  source?: string;
  outDir?: string;
  repoRoot?: string;
  repo?: string;
  notifyLd08?: boolean;
  requireLd08?: boolean;
  triggerGithubDispatch?: boolean;
  skipFactoryIntake?: boolean;
  force?: boolean;
  tag?: string;
}

function sanitizeGoldfishSlug(rawName: string): string {
  const base = basename(rawName).replace(/\.[^.]+$/, "");
  const normalized = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "manifest";
}

function readGoldfishQueueFile(): { version: number; updatedAt: string | null; missions: EgmGoldfishMission[] } {
  const { goldfishQueuePath } = getSuperAgentPaths();
  try {
    const raw = readFileSync(goldfishQueuePath, "utf8");
    const parsed = JSON.parse(raw) as { version?: number; updatedAt?: string | null; missions?: unknown };
    return {
      version: typeof parsed.version === "number" ? parsed.version : 1,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : null,
      missions: Array.isArray(parsed.missions) ? (parsed.missions as EgmGoldfishMission[]) : [],
    };
  } catch {
    return { version: 1, updatedAt: null, missions: [] };
  }
}

function writeGoldfishQueueFile(missions: EgmGoldfishMission[]): string {
  const { stateDir, goldfishQueuePath } = getSuperAgentPaths();
  mkdirSync(stateDir, { recursive: true });
  const payload = {
    version: 1,
    updatedAt: new Date().toISOString(),
    missions: missions.slice(0, 50),
  };
  writeFileSync(goldfishQueuePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return goldfishQueuePath;
}

export function listEgmGoldfishMissions(): {
  count: number;
  queuePath: string;
  missions: EgmGoldfishMission[];
} {
  const { goldfishQueuePath } = getSuperAgentPaths();
  const queue = readGoldfishQueueFile();
  return {
    count: queue.missions.length,
    queuePath: goldfishQueuePath,
    missions: queue.missions,
  };
}

function resolveAspaceRootForIntake(startDir: string): string | null {
  const envRoot = process.env.ASPACE_OS_ROOT?.trim();
  if (envRoot && existsSync(join(envRoot, "02_Factory", "factory.ps1"))) {
    return envRoot;
  }
  let cursor = resolve(startDir);
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(cursor, "02_Factory", "factory.ps1"))) {
      return cursor;
    }
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  return null;
}

function buildGoldfishContractMarkdown(mission: EgmGoldfishMission): string {
  return [
    `# EGM Goldfish Contract · ${mission.missionId}`,
    "",
    "> **Modèle Éléphant–Poisson Rouge (EGM)** : *Design with an elephant, review with a goldfish — contrat autonome, déterministe et vérifiable sans contexte caché.*",
    "",
    `- **Mission ID** : \`${mission.missionId}\``,
    `- **Manifest ID** : \`${mission.manifestId}\``,
    `- **Manifest Name** : \`${mission.manifestName}\``,
    `- **Version Drive** : \`${mission.versionFolder}\``,
    `- **Source** : \`${mission.source}\``,
    `- **Checksum SHA-256** : \`${mission.checksumSha256}\``,
    `- **Politique Dev vs Prod** : \`${mission.branchPolicy}\` (Production \`main\` / \`prod\` strictement isolée)`,
    ...(mission.manifestUrl ? [`- **URL Drive** : ${mission.manifestUrl}`] : []),
    `- **Horodatage** : \`${mission.updatedAt}\``,
    "",
    "## Périmètre / Extrait du Manifest",
    mission.excerpt || "_Aucun extrait textuel fourni — lire le manifest Drive source._",
    "",
    "## Portes d'Acceptation Goldfish",
    "- [ ] Execution sur clone Dev (`dev/*`) ou worktree Orca isolé (jamais `main` / `prod` directement).",
    "- [ ] Vérification unitaire : `bun test ./tests/aspace-palier-orchestrator.test.ts` + `node --test launcher/tests/*.test.cjs`.",
    "- [ ] Audit Outside Judge (`S1-RICK` / `reviewer-code` en lecture seule) + `02_Factory/checks.ps1` avant promotion `main`.",
    "",
  ].join("\n");
}

function tryFactoryIntake(
  aspaceRoot: string | null,
  mission: EgmGoldfishMission,
): NonNullable<EgmGoldfishMission["factoryIntake"]> {
  if (!aspaceRoot) {
    return { attempted: false, queued: false, reason: "aspace_factory_root_not_found" };
  }
  const factoryScript = join(aspaceRoot, "02_Factory", "factory.ps1");
  const requestId = `${mission.missionId}-${mission.checksumSha256.slice(0, 8)}`;
  const mandate = [
    `Phase 5 Drive->EGM Goldfish dispatch for ${mission.manifestName} (${mission.versionFolder}).`,
    `Contract: ${mission.contractPath}.`,
    mission.excerpt ? `Scope: ${mission.excerpt.slice(0, 280)}` : "",
  ]
    .filter(Boolean)
    .join(" ");
  const res = spawnSync(
    "pwsh",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      factoryScript,
      "intake",
      "-Title",
      `EGM Goldfish: ${mission.manifestName}`,
      "-Mandate",
      mandate,
      "-Harness",
      "cpu-phase5",
      "-RequestId",
      requestId,
    ],
    { cwd: aspaceRoot, encoding: "utf8", timeout: 8000, windowsHide: true },
  );
  if (res.error || res.status !== 0) {
    return {
      attempted: true,
      queued: false,
      reason: res.error ? res.error.message : (res.stderr || res.stdout || `exit_${res.status}`).trim().slice(0, 180),
    };
  }
  const output = `${res.stdout ?? ""}\n${res.stderr ?? ""}`;
  const ticketMatch = output.match(/\b(tkt-[A-Za-z0-9_-]+)\b/i);
  return {
    attempted: true,
    queued: true,
    ...(ticketMatch ? { ticketId: ticketMatch[1] } : {}),
  };
}

function tryGithubRepositoryDispatch(
  repo: string,
  mission: EgmGoldfishMission,
  repoRoot: string,
): NonNullable<EgmGoldfishMission["githubDispatch"]> {
  const payload = JSON.stringify({
    event_type: "aspace_drive_manifest",
    client_payload: {
      manifest_id: mission.manifestId,
      manifest_name: mission.manifestName,
      version_folder: mission.versionFolder,
      manifest_url: mission.manifestUrl || "",
      excerpt: mission.excerpt.slice(0, 600),
      mission_id: mission.missionId,
      source: mission.source,
    },
  });
  const res = spawnSync(
    "gh",
    ["api", `repos/${repo}/dispatches`, "--method", "POST", "--input", "-"],
    { cwd: repoRoot, input: payload, encoding: "utf8", timeout: 8000, windowsHide: true },
  );
  if (res.error || res.status !== 0) {
    return {
      attempted: true,
      dispatched: false,
      repo,
      error: res.error ? res.error.message : (res.stderr || res.stdout || `exit_${res.status}`).trim().slice(0, 180),
    };
  }
  return { attempted: true, dispatched: true, repo };
}

export async function dispatchDriveManifestToEgmGoldfish(input: DriveManifestDispatchInput): Promise<{
  ok: boolean;
  deduplicated: boolean;
  mission: EgmGoldfishMission;
  contractPath: string;
  queuePath: string;
}> {
  const manifestName = String(input.manifestName || "").trim();
  if (!manifestName) {
    throw new Error("manifestName is required for Phase 5 EGM Goldfish dispatch");
  }
  const versionFolder = String(input.versionFolder || "V0.1").trim() || "V0.1";
  const manifestId = String(input.manifestId || `local:${sanitizeGoldfishSlug(manifestName)}`).trim();
  const source = String(input.source || "cpu-phase5").trim() || "cpu-phase5";
  const excerpt = String(input.excerpt || "").trim();
  const manifestUrl = input.manifestUrl?.trim() || undefined;
  const repoRoot = resolve(input.repoRoot || process.cwd());

  const idHash = createHash("sha256").update(`${manifestId}::${versionFolder}`).digest("hex").slice(0, 8);
  const slug = sanitizeGoldfishSlug(manifestName).slice(0, 28);
  const missionId = `egm-gf-${slug}-${idHash}`;
  const checksumSha256 = createHash("sha256")
    .update(JSON.stringify({ manifestId, manifestName, versionFolder, manifestUrl: manifestUrl ?? "", excerpt }))
    .digest("hex");

  const { stateDir, goldfishQueuePath } = getSuperAgentPaths();
  const outDir = input.outDir?.trim()
    ? resolve(input.outDir.trim())
    : process.env.ASPACE_GOLDFISH_OUT_DIR?.trim()
      ? resolve(process.env.ASPACE_GOLDFISH_OUT_DIR.trim())
      : join(stateDir, "goldfish");
  const contractPath = join(outDir, `${missionId}.md`);

  const queue = readGoldfishQueueFile();
  const existing = queue.missions.find((item) => item.missionId === missionId);
  if (existing && existing.checksumSha256 === checksumSha256 && !input.force && existsSync(existing.contractPath)) {
    return {
      ok: true,
      deduplicated: true,
      mission: existing,
      contractPath: existing.contractPath,
      queuePath: goldfishQueuePath,
    };
  }

  const now = new Date().toISOString();
  const mission: EgmGoldfishMission = {
    missionId,
    manifestId,
    manifestName,
    versionFolder,
    ...(manifestUrl ? { manifestUrl } : {}),
    source,
    checksumSha256,
    excerpt,
    branchPolicy: "dev/* auto-merge:true",
    prodIsolation: true,
    contractPath,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    dispatches: (existing?.dispatches ?? 0) + 1,
  };

  mkdirSync(outDir, { recursive: true });
  writeFileSync(contractPath, buildGoldfishContractMarkdown(mission), "utf8");

  if (input.skipFactoryIntake || process.env.ASPACE_SKIP_FACTORY_INTAKE === "1") {
    mission.factoryIntake = { attempted: false, queued: false, reason: "skipped_by_flag" };
  } else {
    mission.factoryIntake = tryFactoryIntake(resolveAspaceRootForIntake(repoRoot), mission);
  }

  if (input.triggerGithubDispatch) {
    const repo = String(input.repo || process.env.ASPACE_GITHUB_REPO || "Amdkn/codex-chatgpt-web").trim();
    mission.githubDispatch = tryGithubRepositoryDispatch(repo, mission, repoRoot);
  }

  if (input.notifyLd08 || input.requireLd08) {
    const tag = String(input.tag || "person/delivery").trim() || "person/delivery";
    const bridge = readSuperAgentBridgeConfig();
    const hasWebhook = Boolean(
      (typeof bridge.ld08WebhookUrl === "string" && bridge.ld08WebhookUrl.trim()) ||
      process.env.GCHAT_LD08_WEBHOOK_URL,
    );
    if (!hasWebhook && !input.requireLd08) {
      mission.ld08Notification = { attempted: false, delivered: false, tag, reason: "webhook_not_configured" };
    } else {
      const ld08Res = await dispatchGoogleChatLD08(
        tag,
        `EGM Goldfish [${mission.missionId}] (${mission.versionFolder}) : ${mission.manifestName} [${mission.branchPolicy}]`,
      );
      mission.ld08Notification = {
        attempted: true,
        delivered: ld08Res.delivered,
        tag: ld08Res.tag,
        status: ld08Res.status,
      };
    }
  }

  const nextMissions = [mission, ...queue.missions.filter((item) => item.missionId !== missionId)];
  const savedQueuePath = writeGoldfishQueueFile(nextMissions);

  return {
    ok: true,
    deduplicated: false,
    mission,
    contractPath,
    queuePath: savedQueuePath,
  };
}

export async function dispatchGoogleChatLD08(
  tag: string,
  message: string,
  explicitWebhookUrl?: string,
): Promise<{ delivered: boolean; tag: string; status: number }> {
  const bridge = readSuperAgentBridgeConfig();
  const webhookUrl = (
    explicitWebhookUrl ||
    (typeof bridge.ld08WebhookUrl === "string" ? bridge.ld08WebhookUrl : "") ||
    process.env.GCHAT_LD08_WEBHOOK_URL ||
    ""
  ).trim();
  if (!webhookUrl) {
    throw new Error("Webhook Google Chat LD08 non configuré");
  }
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({ text: `[${tag}] ${message}` }),
    signal: AbortSignal.timeout(4000),
  });
  if (!res.ok) {
    throw new Error(`Google Chat Webhook HTTP ${res.status}`);
  }
  return { delivered: true, tag, status: res.status };
}
