const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const https = require("node:https");
const os = require("node:os");
const path = require("node:path");
const { execFile, spawn, spawnSync } = require("node:child_process");

const SUPERAGENT_PORT = Number.parseInt(process.env.ASPACE_SUPERAGENT_PORT || "3082", 10);
const SUPERAGENT_HOST = "127.0.0.1";
const SUPERAGENT_BASE_URL = `http://${SUPERAGENT_HOST}:${SUPERAGENT_PORT}`;
const SUPERAGENT_REPO_PATH =
  process.env.ASPACE_SUPERAGENT_PATH ||
  "C:\\Users\\amado\\Aspace OS V5\\00_Memoire\\dsh-superagent";

function getDshHome() {
  return process.env.DSH_HOME || path.join(os.homedir(), ".dsh");
}

function getSuperAgentProfileDir() {
  return path.join(getDshHome(), "profiles", "superagent");
}

function getSuperAgentStateDir() {
  return path.join(getDshHome(), "state", "superagent");
}

function getBridgeConfigPath() {
  return path.join(getSuperAgentStateDir(), "aspace-bridge.json");
}

function getGoldfishQueuePath() {
  return path.join(getSuperAgentStateDir(), "aspace-goldfish-queue.json");
}

function readBridgeConfig() {
  try {
    const raw = fs.readFileSync(getBridgeConfigPath(), "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeBridgeConfig(patch) {
  const stateDir = getSuperAgentStateDir();
  fs.mkdirSync(stateDir, { recursive: true });
  const next = { ...readBridgeConfig(), ...patch, updatedAt: new Date().toISOString() };
  fs.writeFileSync(getBridgeConfigPath(), JSON.stringify(next, null, 2) + "\n", "utf8");
  return next;
}

function ensureSuperAgentProfile() {
  const profileDir = getSuperAgentProfileDir();
  const stateDir = getSuperAgentStateDir();
  fs.mkdirSync(profileDir, { recursive: true });
  fs.mkdirSync(stateDir, { recursive: true });

  const patchPath = path.join(profileDir, "cordis.patch.yml");
  const normalizedStateDir = stateDir.replace(/\\/g, "/");
  const normalizedPluginPath = SUPERAGENT_REPO_PATH.replace(/\\/g, "/");

  if (!fs.existsSync(patchPath)) {
    const yaml = [
      "# Auto-provisioned by Aspace OS V5 CPU (CLI-Plateformes-Unifie)",
      "- id: webserver",
      "  config:",
      `    host: ${SUPERAGENT_HOST}`,
      `    port: ${SUPERAGENT_PORT}`,
      "- id: dsh-superagent",
      "  config:",
      `    stateDir: "${normalizedStateDir}"`,
      "- id: subagent-model-selection-settings",
      "  name: \"@deepseek-ai/dsh-tool-subagent/model-selection-settings\"",
      "  config:",
      "    enabled: true",
      "    allowedModels:",
      "      - provider: freellmapi",
      "        model: auto",
      "      - provider: freellmapi",
      "        model: fusion",
      "",
    ].join("\n");
    fs.writeFileSync(patchPath, yaml, "utf8");
  }

  return {
    profileDir,
    stateDir,
    patchPath,
    pluginPath: SUPERAGENT_REPO_PATH,
    pluginPresent: fs.existsSync(SUPERAGENT_REPO_PATH),
    endpoint: SUPERAGENT_BASE_URL,
  };
}

function orchestratorRequest(method, apiPath, body, timeoutMs = 1500) {
  return new Promise((resolve, reject) => {
    const payload = body !== undefined ? JSON.stringify(body) : null;
    const headers = {
      "x-orchestrator-request": "1",
      origin: SUPERAGENT_BASE_URL,
    };
    if (payload !== null) {
      headers["content-type"] = "application/json";
      headers["content-length"] = Buffer.byteLength(payload);
    }
    const req = http.request(
      {
        hostname: SUPERAGENT_HOST,
        port: SUPERAGENT_PORT,
        path: `/orchestrator/api/${apiPath.replace(/^\//, "")}`,
        method,
        headers,
        timeout: timeoutMs,
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let json = null;
          try { json = text.trim() ? JSON.parse(text) : null; } catch {}
          if ((res.statusCode ?? 500) >= 400) {
            reject(new Error(json?.error || `HTTP ${res.statusCode}: ${text.slice(0, 150)}`));
            return;
          }
          resolve(json);
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error(`dsh-superagent timeout (${timeoutMs}ms)`)));
    req.on("error", reject);
    if (payload !== null) req.write(payload);
    req.end();
  });
}

async function getSuperAgentSnapshot() {
  const profile = ensureSuperAgentProfile();
  const bridge = readBridgeConfig();
  try {
    const [state, overview, tickets, threads] = await Promise.all([
      orchestratorRequest("GET", "state"),
      orchestratorRequest("GET", "overview").catch(() => null),
      orchestratorRequest("GET", "tickets?state=open&limit=25").catch(() => null),
      orchestratorRequest("GET", "threads?filter=all&limit=25").catch(() => null),
    ]);
    return {
      online: true,
      endpoint: SUPERAGENT_BASE_URL,
      profile,
      bridge: {
        ld08WebhookConfigured: Boolean(bridge.ld08WebhookUrl || process.env.GCHAT_LD08_WEBHOOK_URL),
        devAutoMergeEnabled: bridge.devAutoMergeEnabled !== false,
      },
      goldfishMissions: listEgmGoldfishMissions().missions.slice(0, 15),
      state,
      overview,
      tickets,
      threads,
    };
  } catch (error) {
    return {
      online: false,
      endpoint: SUPERAGENT_BASE_URL,
      error: error instanceof Error ? error.message : String(error),
      profile,
      bridge: {
        ld08WebhookConfigured: Boolean(bridge.ld08WebhookUrl || process.env.GCHAT_LD08_WEBHOOK_URL),
        devAutoMergeEnabled: bridge.devAutoMergeEnabled !== false,
      },
      goldfishMissions: listEgmGoldfishMissions().missions.slice(0, 15),
      state: null,
      overview: null,
      tickets: null,
      threads: null,
    };
  }
}

function startSuperAgentDaemon() {
  const profile = ensureSuperAgentProfile();
  const logPath = path.join(profile.stateDir, "aspace-daemon.log");
  const out = fs.openSync(logPath, "a");
  const winNodeDsh =
    process.platform === "win32" && process.env.APPDATA
      ? path.join(process.env.APPDATA, "npm", "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js")
      : null;
  let command;
  let args;
  if (winNodeDsh && fs.existsSync(winNodeDsh)) {
    command = "node";
    args = [winNodeDsh, "--profile", "superagent", "--no-open"];
  } else if (process.platform === "win32") {
    command = "cmd.exe";
    args = ["/c", "dsh", "--profile", "superagent", "--no-open"];
  } else {
    command = "dsh";
    args = ["--profile", "superagent", "--no-open"];
  }
  const child = spawn(command, args, {
    detached: true,
    stdio: ["ignore", out, out],
    windowsHide: true,
    shell: false,
    env: {
      ...process.env,
      DSH_HOME: getDshHome(),
      DO_NOT_TRACK: "1",
    },
  });
  child.unref();
  writeBridgeConfig({ daemonPid: child.pid, lastStartedAt: new Date().toISOString() });
  return { started: true, pid: child.pid, logPath, endpoint: SUPERAGENT_BASE_URL };
}

function postJsonHttps(urlString, payloadObj, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const mod = url.protocol === "https:" ? https : http;
    const payload = JSON.stringify(payloadObj);
    const req = mod.request(
      url,
      {
        method: "POST",
        headers: {
          "content-type": "application/json; charset=utf-8",
          "content-length": Buffer.byteLength(payload),
        },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          if ((res.statusCode ?? 500) >= 400) {
            reject(new Error(`Webhook HTTP ${res.statusCode}: ${text.slice(0, 120)}`));
            return;
          }
          resolve({ status: res.statusCode, body: text });
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("Webhook timeout")));
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

async function notifyGoogleChatLD08(tag, message, explicitWebhookUrl) {
  const bridge = readBridgeConfig();
  const webhookUrl = (explicitWebhookUrl || bridge.ld08WebhookUrl || process.env.GCHAT_LD08_WEBHOOK_URL || "").trim();
  if (!webhookUrl) {
    throw new Error("Webhook Google Chat LD08 non configuré");
  }
  const res = await postJsonHttps(webhookUrl, { text: `[${tag}] ${message}` });
  return { delivered: true, tag, ...res };
}

function triggerDevAutoMerge(prUrlOrBranch, repoPath) {
  return new Promise((resolve, reject) => {
    const trimmed = String(prUrlOrBranch || "").trim();
    if (!trimmed || /^(main|master|prod|production)$/i.test(trimmed)) {
      reject(new Error("Auto-merge autorisé uniquement sur les branches/PR de Dev (Production isolée)"));
      return;
    }
    execFile(
      "gh",
      ["pr", "merge", "--auto", "--squash", trimmed],
      { cwd: repoPath || process.cwd(), timeout: 10_000, windowsHide: true },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error(stderr?.trim() || err.message));
          return;
        }
        resolve({ mergedOrQueued: true, target: trimmed, output: stdout.trim() });
      },
    );
  });
}

function sanitizeGoldfishSlug(rawName) {
  const base = path.basename(String(rawName || "")).replace(/\.[^.]+$/, "");
  const normalized = base.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized || "manifest";
}

function readGoldfishQueueFile() {
  const queuePath = getGoldfishQueuePath();
  try {
    const raw = fs.readFileSync(queuePath, "utf8");
    const parsed = JSON.parse(raw);
    return {
      version: typeof parsed?.version === "number" ? parsed.version : 1,
      updatedAt: typeof parsed?.updatedAt === "string" ? parsed.updatedAt : null,
      missions: Array.isArray(parsed?.missions) ? parsed.missions : [],
    };
  } catch {
    return { version: 1, updatedAt: null, missions: [] };
  }
}

function writeGoldfishQueueFile(missions) {
  const stateDir = getSuperAgentStateDir();
  const queuePath = getGoldfishQueuePath();
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(
    queuePath,
    JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), missions: missions.slice(0, 50) }, null, 2) + "\n",
    "utf8",
  );
  return queuePath;
}

function listEgmGoldfishMissions() {
  const queuePath = getGoldfishQueuePath();
  const queue = readGoldfishQueueFile();
  return { count: queue.missions.length, queuePath, missions: queue.missions };
}

function resolveAspaceRootForIntake(startDir) {
  const envRoot = process.env.ASPACE_OS_ROOT ? String(process.env.ASPACE_OS_ROOT).trim() : "";
  if (envRoot && fs.existsSync(path.join(envRoot, "02_Factory", "factory.ps1"))) return envRoot;
  let cursor = path.resolve(startDir || process.cwd());
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(cursor, "02_Factory", "factory.ps1"))) return cursor;
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  return null;
}

function buildGoldfishContractMarkdown(mission) {
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

function tryFactoryIntake(aspaceRoot, mission) {
  if (!aspaceRoot) {
    return { attempted: false, queued: false, reason: "aspace_factory_root_not_found" };
  }
  const factoryScript = path.join(aspaceRoot, "02_Factory", "factory.ps1");
  const requestId = `${mission.missionId}-${mission.checksumSha256.slice(0, 8)}`;
  const mandate = [
    `Phase 5 Drive->EGM Goldfish dispatch for ${mission.manifestName} (${mission.versionFolder}).`,
    `Contract: ${mission.contractPath}.`,
    mission.excerpt ? `Scope: ${mission.excerpt.slice(0, 280)}` : "",
  ].filter(Boolean).join(" ");
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
      reason: res.error ? res.error.message : String(res.stderr || res.stdout || `exit_${res.status}`).trim().slice(0, 180),
    };
  }
  const output = `${res.stdout || ""}\n${res.stderr || ""}`;
  const ticketMatch = output.match(/\b(tkt-[A-Za-z0-9_-]+)\b/i);
  return { attempted: true, queued: true, ...(ticketMatch ? { ticketId: ticketMatch[1] } : {}) };
}

function tryGithubRepositoryDispatch(repo, mission, repoRoot) {
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
      error: res.error ? res.error.message : String(res.stderr || res.stdout || `exit_${res.status}`).trim().slice(0, 180),
    };
  }
  return { attempted: true, dispatched: true, repo };
}

async function dispatchDriveManifestToEgmGoldfish(input = {}) {
  const manifestName = String(input.manifestName || "").trim();
  if (!manifestName) {
    throw new Error("manifestName is required for Phase 5 EGM Goldfish dispatch");
  }
  const versionFolder = String(input.versionFolder || "V0.1").trim() || "V0.1";
  const manifestId = String(input.manifestId || `local:${sanitizeGoldfishSlug(manifestName)}`).trim();
  const source = String(input.source || "cpu-phase5-ui").trim() || "cpu-phase5-ui";
  const excerpt = String(input.excerpt || "").trim();
  const manifestUrl = input.manifestUrl ? String(input.manifestUrl).trim() : undefined;
  const repoRoot = path.resolve(input.repoRoot || process.cwd());

  const idHash = crypto.createHash("sha256").update(`${manifestId}::${versionFolder}`).digest("hex").slice(0, 8);
  const slug = sanitizeGoldfishSlug(manifestName).slice(0, 28);
  const missionId = `egm-gf-${slug}-${idHash}`;
  const checksumSha256 = crypto
    .createHash("sha256")
    .update(JSON.stringify({ manifestId, manifestName, versionFolder, manifestUrl: manifestUrl || "", excerpt }))
    .digest("hex");

  const stateDir = getSuperAgentStateDir();
  const queuePath = getGoldfishQueuePath();
  const outDir = input.outDir && String(input.outDir).trim()
    ? path.resolve(String(input.outDir).trim())
    : process.env.ASPACE_GOLDFISH_OUT_DIR && String(process.env.ASPACE_GOLDFISH_OUT_DIR).trim()
      ? path.resolve(String(process.env.ASPACE_GOLDFISH_OUT_DIR).trim())
      : path.join(stateDir, "goldfish");
  const contractPath = path.join(outDir, `${missionId}.md`);

  const queue = readGoldfishQueueFile();
  const existing = queue.missions.find((item) => item.missionId === missionId);
  if (existing && existing.checksumSha256 === checksumSha256 && !input.force && fs.existsSync(existing.contractPath)) {
    return {
      ok: true,
      deduplicated: true,
      mission: existing,
      contractPath: existing.contractPath,
      queuePath,
    };
  }

  const now = new Date().toISOString();
  const mission = {
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
    dispatches: (existing?.dispatches || 0) + 1,
  };

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(contractPath, buildGoldfishContractMarkdown(mission), "utf8");

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
    const bridge = readBridgeConfig();
    const hasWebhook = Boolean((bridge.ld08WebhookUrl && String(bridge.ld08WebhookUrl).trim()) || process.env.GCHAT_LD08_WEBHOOK_URL);
    if (!hasWebhook && !input.requireLd08) {
      mission.ld08Notification = { attempted: false, delivered: false, tag, reason: "webhook_not_configured" };
    } else {
      const ld08Res = await notifyGoogleChatLD08(
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

module.exports = {
  SUPERAGENT_BASE_URL,
  SUPERAGENT_PORT,
  dispatchDriveManifestToEgmGoldfish,
  ensureSuperAgentProfile,
  getBridgeConfigPath,
  getDshHome,
  getGoldfishQueuePath,
  getSuperAgentProfileDir,
  getSuperAgentSnapshot,
  getSuperAgentStateDir,
  listEgmGoldfishMissions,
  notifyGoogleChatLD08,
  orchestratorRequest,
  readBridgeConfig,
  startSuperAgentDaemon,
  triggerDevAutoMerge,
  writeBridgeConfig,
};
