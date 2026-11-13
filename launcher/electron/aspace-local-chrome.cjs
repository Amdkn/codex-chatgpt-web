const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");
const { execFile, spawn } = require("node:child_process");

const DEFAULT_LOCAL_CHROME_CDP_PORT = 9222;
const DEFAULT_PROBE_TIMEOUT_MS = 600;
const DEFAULT_CHROME_PROFILE = process.env.ASPACE_CHROME_PROFILE || "Default";
const EMBED_HELPER_EXE = path.join(__dirname, "aspace-win32-embed.exe");

let embedDaemon = null;
let embedDaemonReady = null;
let embedDaemonBuffer = "";
let embedDaemonSeq = 0;
let embedDaemonClosing = false;
const embedPending = new Map();
const embedClosedListeners = new Set();

function rejectAllEmbedPending(error) {
  for (const [id, entry] of embedPending.entries()) {
    clearTimeout(entry.timer);
    entry.reject(error);
    embedPending.delete(id);
  }
}

function handleEmbedDaemonLine(rawLine) {
  const line = String(rawLine || "").trim();
  if (!line) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (msg.event === "closed" && msg.child) {
    const childHwnd = String(msg.child);
    for (const listener of [...embedClosedListeners]) {
      try {
        listener(childHwnd);
      } catch {}
    }
    return;
  }
  if (msg.id && embedPending.has(msg.id)) {
    const entry = embedPending.get(msg.id);
    embedPending.delete(msg.id);
    clearTimeout(entry.timer);
    if (msg.ok) {
      entry.resolve(msg);
    } else {
      const err = new Error(msg.error || "Win32 embed command failed");
      err.fromDaemon = true;
      entry.reject(err);
    }
  }
}

function startEmbedDaemon() {
  if (process.platform !== "win32" || !fs.existsSync(EMBED_HELPER_EXE)) {
    return Promise.reject(new Error("Win32 embed helper unavailable"));
  }
  if (embedDaemon && !embedDaemon.killed && embedDaemon.exitCode === null && embedDaemonReady) {
    return embedDaemonReady;
  }

  embedDaemonClosing = false;
  embedDaemonBuffer = "";
  const child = spawn(EMBED_HELPER_EXE, ["serve"], {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  embedDaemon = child;

  embedDaemonReady = new Promise((resolve, reject) => {
    let settled = false;
    const readyTimer = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error("Win32 embed daemon ready timeout"));
      }
    }, 4000);
    readyTimer.unref?.();

    const onStdoutChunk = (chunk) => {
      embedDaemonBuffer += chunk.toString("utf8");
      let idx;
      while ((idx = embedDaemonBuffer.indexOf("\n")) >= 0) {
        const line = embedDaemonBuffer.slice(0, idx);
        embedDaemonBuffer = embedDaemonBuffer.slice(idx + 1);
        const trimmed = line.trim();
        if (!settled && trimmed) {
          try {
            const parsed = JSON.parse(trimmed);
            if (parsed.event === "ready") {
              settled = true;
              clearTimeout(readyTimer);
              resolve();
              continue;
            }
          } catch {}
        }
        handleEmbedDaemonLine(line);
      }
    };

    child.stdout.on("data", onStdoutChunk);
    child.once("error", (err) => {
      clearTimeout(readyTimer);
      if (embedDaemon === child) {
        embedDaemon = null;
        embedDaemonReady = null;
      }
      rejectAllEmbedPending(err);
      if (!settled) {
        settled = true;
        reject(err);
      }
    });
    child.once("exit", (code) => {
      clearTimeout(readyTimer);
      if (embedDaemon === child) {
        embedDaemon = null;
        embedDaemonReady = null;
      }
      const err = new Error(embedDaemonClosing ? "Win32 embed daemon closed" : `Win32 embed daemon exited (${code})`);
      rejectAllEmbedPending(err);
      if (!settled) {
        settled = true;
        reject(err);
      }
    });
  });

  return embedDaemonReady;
}

async function callEmbedDaemon(cmd, payload = {}, timeoutMs = 4000) {
  await startEmbedDaemon();
  if (!embedDaemon || !embedDaemon.stdin || !embedDaemon.stdin.writable) {
    throw new Error("Win32 embed daemon stdin unavailable");
  }
  const id = `r${++embedDaemonSeq}`;
  const line = `${JSON.stringify({ id, cmd, ...payload })}\n`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      embedPending.delete(id);
      reject(new Error(`Win32 embed daemon timeout for ${cmd}`));
    }, timeoutMs);
    timer.unref?.();
    embedPending.set(id, { resolve, reject, timer });
    embedDaemon.stdin.write(line, (writeErr) => {
      if (writeErr) {
        embedPending.delete(id);
        clearTimeout(timer);
        reject(writeErr);
      }
    });
  });
}

function onEmbeddedChromeClosed(listener) {
  if (typeof listener !== "function") return () => {};
  embedClosedListeners.add(listener);
  return () => embedClosedListeners.delete(listener);
}

function shutdownEmbedDaemon() {
  embedDaemonClosing = true;
  rejectAllEmbedPending(new Error("Win32 embed daemon shutting down"));
  const proc = embedDaemon;
  embedDaemon = null;
  embedDaemonReady = null;
  if (!proc) return;
  try {
    proc.stdin?.end();
  } catch {}
  const killTimer = setTimeout(() => {
    try {
      if (proc.exitCode === null && !proc.killed) proc.kill();
    } catch {}
  }, 500);
  killTimer.unref?.();
}

function resolveLocalChromeCdpPort(explicitPort) {
  const raw = explicitPort ?? process.env.ASPACE_LOCAL_CHROME_CDP_PORT;
  const parsed = Number.parseInt(String(raw ?? ""), 10);
  if (Number.isInteger(parsed) && parsed > 0 && parsed <= 65535) {
    return parsed;
  }
  return DEFAULT_LOCAL_CHROME_CDP_PORT;
}

function getDefaultChromeUserDataDir(explicitDir) {
  if (explicitDir) return explicitDir;
  if (process.env.ASPACE_CHROME_USER_DATA_DIR) return process.env.ASPACE_CHROME_USER_DATA_DIR;
  if (process.env.LOCALAPPDATA) {
    return path.join(process.env.LOCALAPPDATA, "Google", "Chrome", "User Data");
  }
  return null;
}

function findLocalChromeExecutable(explicitPath) {
  const candidates = [
    explicitPath,
    process.env.ASPACE_CHROME_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe")
      : null,
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {}
  }
  return null;
}

function execEmbedHelper(args, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    if (process.platform !== "win32" || !fs.existsSync(EMBED_HELPER_EXE)) {
      reject(new Error("Win32 embed helper unavailable"));
      return;
    }
    execFile(EMBED_HELPER_EXE, args, { timeout: timeoutMs, windowsHide: true }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(stderr?.trim() || err.message));
        return;
      }
      resolve(stdout.trim());
    });
  });
}

function getNativeWindowHandleDecimal(browserWindow) {
  if (!browserWindow || typeof browserWindow.getNativeWindowHandle !== "function") {
    return null;
  }
  try {
    const buf = browserWindow.getNativeWindowHandle();
    if (!Buffer.isBuffer(buf) || buf.length < 4) return null;
    return buf.length >= 8 ? buf.readBigInt64LE(0).toString() : String(buf.readUInt32LE(0));
  } catch {
    return null;
  }
}

async function listChromeWindowHandles() {
  try {
    const res = await callEmbedDaemon("list-chrome");
    return Array.isArray(res?.handles) ? res.handles.map(String) : [];
  } catch (err) {
    if (err?.fromDaemon) throw err;
    const raw = await execEmbedHelper(["list-chrome"]);
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  }
}

function scaleRectForWin32(bounds, scaleFactor = 1) {
  const factor = Number.isFinite(scaleFactor) && scaleFactor > 0 ? scaleFactor : 1;
  return {
    x: Math.round((bounds?.x ?? 0) * factor),
    y: Math.round((bounds?.y ?? 0) * factor),
    width: Math.max(100, Math.round((bounds?.width ?? 900) * factor)),
    height: Math.max(100, Math.round((bounds?.height ?? 650) * factor)),
  };
}

async function embedPlatformInElectronWindow({
  parentHwndDec,
  targetUrl,
  bounds,
  scaleFactor = 1,
  chromeProfile = DEFAULT_CHROME_PROFILE,
  userDataDir,
  executablePath,
  timeoutMs = 7000,
}) {
  if (!parentHwndDec) throw new Error("Electron native HWND unavailable");
  const chromeExe = findLocalChromeExecutable(executablePath);
  if (!chromeExe) throw new Error("Chrome executable not found");

  const rect = scaleRectForWin32(bounds, scaleFactor);
  const before = new Set(await listChromeWindowHandles());

  const chromeArgs = [
    `--profile-directory=${chromeProfile}`,
    `--app=${targetUrl}`,
    "--new-window",
    "--window-position=-32000,-32000",
    `--window-size=${rect.width},${rect.height}`,
  ];
  if (userDataDir) {
    chromeArgs.push(`--user-data-dir=${userDataDir}`);
  }
  const child = spawn(
    chromeExe,
    chromeArgs,
    {
      detached: true,
      stdio: "ignore",
      windowsHide: false,
    },
  );
  child.unref();

  const deadline = Date.now() + timeoutMs;
  let newHwnd = null;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 50));
    const current = await listChromeWindowHandles();
    const diff = current.find((h) => !before.has(h));
    if (diff) {
      newHwnd = diff;
      break;
    }
  }
  if (!newHwnd) {
    throw new Error("Timed out waiting for embedded Local Chrome window handle");
  }

  let attachInfo = null;
  try {
    attachInfo = await callEmbedDaemon("attach", {
      parent: String(parentHwndDec),
      child: String(newHwnd),
      x: rect.x,
      y: rect.y,
      w: rect.width,
      h: rect.height,
      visible: true,
    });
  } catch (err) {
    if (err?.fromDaemon) throw err;
    await execEmbedHelper([
      "attach",
      String(parentHwndDec),
      String(newHwnd),
      String(rect.x),
      String(rect.y),
      String(rect.width),
      String(rect.height),
      "1",
    ]);
  }

  return {
    handled: true,
    mode: "embedded-local-chrome",
    transport: "win32-setparent",
    chromeHwnd: String(newHwnd),
    hostHwnd: attachInfo?.host ? String(attachInfo.host) : null,
    insets: attachInfo?.insets ?? null,
    profile: chromeProfile,
    url: targetUrl,
    pid: child.pid,
  };
}

async function syncEmbeddedChromeBounds(chromeHwndDec, bounds, visible, scaleFactor = 1) {
  if (!chromeHwndDec) return false;
  const rect = scaleRectForWin32(bounds, scaleFactor);
  try {
    await callEmbedDaemon("bounds", {
      child: String(chromeHwndDec),
      x: rect.x,
      y: rect.y,
      w: rect.width,
      h: rect.height,
      visible: visible === true,
    });
    return true;
  } catch (err) {
    if (err?.fromDaemon) return false;
    try {
      await execEmbedHelper([
        "bounds",
        String(chromeHwndDec),
        String(rect.x),
        String(rect.y),
        String(rect.width),
        String(rect.height),
        visible ? "1" : "0",
      ]);
      return true;
    } catch {
      return false;
    }
  }
}

async function focusEmbeddedChrome(chromeHwndDec) {
  if (!chromeHwndDec) return false;
  try {
    await callEmbedDaemon("focus", { child: String(chromeHwndDec) });
    return true;
  } catch {
    return false;
  }
}

async function isEmbeddedChromeAlive(chromeHwndDec) {
  if (!chromeHwndDec) return false;
  try {
    const res = await callEmbedDaemon("is-window", { child: String(chromeHwndDec) });
    return res?.alive === true;
  } catch (err) {
    if (err?.fromDaemon) return false;
    try {
      return (await execEmbedHelper(["is-window", String(chromeHwndDec)])) === "1";
    } catch {
      return false;
    }
  }
}

async function closeEmbeddedChrome(chromeHwndDec) {
  if (!chromeHwndDec) return false;
  try {
    await callEmbedDaemon("close", { child: String(chromeHwndDec) });
    return true;
  } catch (err) {
    if (err?.fromDaemon) return false;
    try {
      await execEmbedHelper(["close", String(chromeHwndDec)]);
      return true;
    } catch {
      return false;
    }
  }
}

function readDevToolsActivePort(userDataDir = getDefaultChromeUserDataDir()) {
  if (!userDataDir) return null;
  const portFile = path.join(userDataDir, "DevToolsActivePort");
  try {
    const content = fs.readFileSync(portFile, "utf8");
    const lines = content.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    if (lines.length === 0) return null;
    const port = Number.parseInt(lines[0], 10);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) return null;
    const wsPath = lines[1] || "/devtools/browser";
    return {
      port,
      wsPath,
      wsUrl: `ws://127.0.0.1:${port}${wsPath}`,
      portFile,
    };
  } catch {
    return null;
  }
}

function probeTcpPort(port, timeoutMs = 400) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    const done = (ok) => {
      try { socket.destroy(); } catch {}
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

function httpRequestJson(port, urlPath, method = "GET", timeoutMs = DEFAULT_PROBE_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: "127.0.0.1", port, path: urlPath, method, timeout: timeoutMs },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          if ((res.statusCode ?? 500) >= 400) {
            reject(new Error(`CDP HTTP ${res.statusCode}: ${text.slice(0, 120)}`));
            return;
          }
          try {
            resolve(text.trim() ? JSON.parse(text) : null);
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error(`CDP request timeout after ${timeoutMs}ms`)));
    req.on("error", reject);
    req.end();
  });
}

async function probeLocalChromeCdp(
  port = resolveLocalChromeCdpPort(),
  timeoutMs = DEFAULT_PROBE_TIMEOUT_MS,
  userDataDir = getDefaultChromeUserDataDir(),
) {
  const endpoint = `http://127.0.0.1:${port}`;
  try {
    const version = await httpRequestJson(port, "/json/version", "GET", timeoutMs);
    if (version && typeof version.webSocketDebuggerUrl === "string") {
      return {
        available: true,
        transport: "http-cdp",
        cdpPort: port,
        endpoint,
        browser: version.Browser ?? "Chrome",
        protocolVersion: version["Protocol-Version"] ?? null,
        webSocketDebuggerUrl: version.webSocketDebuggerUrl,
      };
    }
  } catch {}

  const active = readDevToolsActivePort(userDataDir);
  if (active && (await probeTcpPort(active.port, timeoutMs))) {
    return {
      available: true,
      transport: "devtools-active-port",
      cdpPort: active.port,
      endpoint: `http://127.0.0.1:${active.port}`,
      browser: "Chrome (DevToolsActivePort)",
      protocolVersion: "1.3",
      webSocketDebuggerUrl: active.wsUrl,
    };
  }

  return {
    available: false,
    transport: "none",
    cdpPort: port,
    endpoint,
    chromeInstalled: Boolean(findLocalChromeExecutable()),
    embedHelperReady: fs.existsSync(EMBED_HELPER_EXE),
    reason: "chrome-cdp-not-enabled",
  };
}

async function resolvePreferredCdpEndpoint(fallbackElectronCdpPort, localChromePort = resolveLocalChromeCdpPort()) {
  const preferLocal = process.env.ASPACE_PREFER_LOCAL_CHROME !== "0";
  if (preferLocal) {
    const probe = await probeLocalChromeCdp(localChromePort);
    if (probe.available) {
      return {
        mode: "local-chrome",
        transport: probe.transport,
        cdpPort: probe.cdpPort,
        endpoint: probe.endpoint,
        webSocketDebuggerUrl: probe.webSocketDebuggerUrl,
        browser: probe.browser,
      };
    }
  }
  return {
    mode: "electron-webview",
    transport: "electron",
    cdpPort: fallbackElectronCdpPort,
    endpoint: `http://127.0.0.1:${fallbackElectronCdpPort}`,
    webSocketDebuggerUrl: null,
    browser: "Electron",
  };
}

function sameOriginHost(targetUrl, desiredUrl) {
  try {
    const a = new URL(targetUrl);
    const b = new URL(desiredUrl);
    return a.hostname.replace(/^www\./, "") === b.hostname.replace(/^www\./, "");
  } catch {
    return false;
  }
}

async function openOrFocusLocalChromeTab(targetUrl, port = resolveLocalChromeCdpPort(), timeoutMs = 1500) {
  const targets = await httpRequestJson(port, "/json/list", "GET", timeoutMs);
  if (Array.isArray(targets)) {
    const existing = targets.find(
      (entry) =>
        entry &&
        entry.type === "page" &&
        typeof entry.url === "string" &&
        sameOriginHost(entry.url, targetUrl),
    );
    if (existing && existing.id) {
      await httpRequestJson(port, `/json/activate/${encodeURIComponent(existing.id)}`, "GET", timeoutMs).catch(() => null);
      return {
        action: "focused",
        transport: "http-cdp",
        targetId: existing.id,
        url: existing.url,
        cdpPort: port,
      };
    }
  }

  const encoded = encodeURIComponent(targetUrl);
  let created;
  try {
    created = await httpRequestJson(port, `/json/new?${encoded}`, "PUT", timeoutMs);
  } catch {
    created = await httpRequestJson(port, `/json/new?${encoded}`, "GET", timeoutMs);
  }
  return {
    action: "created",
    transport: "http-cdp",
    targetId: created?.id ?? null,
    url: created?.url ?? targetUrl,
    cdpPort: port,
  };
}

function openUrlInRunningLocalChromeShell(targetUrl, options = {}) {
  const chromeExe = findLocalChromeExecutable(options.executablePath);
  if (!chromeExe) {
    return { launched: false, reason: "chrome-executable-not-found" };
  }
  const profileDir = options.profileDirectory || DEFAULT_CHROME_PROFILE;
  const child = spawn(chromeExe, [`--profile-directory=${profileDir}`, targetUrl], {
    detached: true,
    stdio: "ignore",
    windowsHide: false,
  });
  child.unref();
  return {
    launched: true,
    action: "shell-open-in-local-chrome",
    transport: "chrome-profile-shell",
    profileDirectory: profileDir,
    url: targetUrl,
    pid: child.pid,
  };
}

function runAgentBrowserAutoConnectOpen(targetUrl) {
  return new Promise((resolve) => {
    const exe = process.platform === "win32" ? "agent-browser.cmd" : "agent-browser";
    const child = spawn(exe, ["--auto-connect", "open", targetUrl], {
      env: { ...process.env, DO_NOT_TRACK: "1", ASPACE_ZERO_TELEMETRY: "1" },
      stdio: "ignore",
      windowsHide: true,
      shell: process.platform === "win32",
    });
    const timer = setTimeout(() => {
      try { child.kill(); } catch {}
      resolve({ ok: false, reason: "agent-browser-timeout" });
    }, 5000);
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, code });
    });
    child.once("error", (err) => {
      clearTimeout(timer);
      resolve({ ok: false, reason: err.message });
    });
  });
}

async function openPlatformInLocalChrome(targetUrl, options = {}) {
  if (
    options.parentHwndDec &&
    process.platform === "win32" &&
    process.env.ASPACE_EMBED_LOCAL_CHROME !== "0" &&
    fs.existsSync(EMBED_HELPER_EXE)
  ) {
    try {
      const embedResult = await embedPlatformInElectronWindow({
        parentHwndDec: options.parentHwndDec,
        targetUrl,
        bounds: options.bounds,
        scaleFactor: options.scaleFactor ?? 1,
        chromeProfile: options.profileDirectory || DEFAULT_CHROME_PROFILE,
        executablePath: options.executablePath,
      });
      return { ...embedResult, probe: await probeLocalChromeCdp(resolveLocalChromeCdpPort(options.cdpPort)) };
    } catch (embedError) {
      options.logger?.warn?.("browser.local_chrome_embed_failed", {
        error: embedError instanceof Error ? embedError.message : String(embedError),
      });
      // Fallback to CDP/Shell if Win32 embed fails
    }
  }

  const port = resolveLocalChromeCdpPort(options.cdpPort);
  const probe = await probeLocalChromeCdp(port, options.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS, options.userDataDir);

  if (probe.available && probe.transport === "http-cdp") {
    try {
      const tabResult = await openOrFocusLocalChromeTab(targetUrl, probe.cdpPort);
      return { handled: true, probe, ...tabResult };
    } catch {}
  }

  if (probe.available && probe.transport === "devtools-active-port") {
    const abResult = await (options.autoConnectOpenFn ?? runAgentBrowserAutoConnectOpen)(targetUrl);
    if (abResult.ok) {
      return {
        handled: true,
        probe,
        action: "opened-via-auto-connect",
        transport: "devtools-active-port",
        url: targetUrl,
        cdpPort: probe.cdpPort,
      };
    }
  }

  const allowShellFallback =
    options.allowShellFallback ??
    (process.env.ASPACE_LOCAL_CHROME_SHELL_FALLBACK !== "0" && process.env.NODE_ENV !== "test");
  if (allowShellFallback) {
    const shellFn = options.shellOpenFn ?? openUrlInRunningLocalChromeShell;
    const shellRes = shellFn(targetUrl, options);
    if (shellRes.launched) {
      return { handled: true, probe, ...shellRes };
    }
  }

  return { handled: false, probe };
}

function launchLocalChromeWithCdp(options = {}) {
  const port = resolveLocalChromeCdpPort(options.cdpPort);
  const chromeExe = findLocalChromeExecutable(options.executablePath);
  if (!chromeExe) {
    throw new Error("Chrome executable not found on this machine");
  }
  const userDataDir = getDefaultChromeUserDataDir(options.userDataDir);

  const args = [
    `--remote-debugging-port=${port}`,
    "--no-first-run",
    "--no-default-browser-check",
  ];
  if (userDataDir) {
    args.push(`--user-data-dir=${userDataDir}`);
  }
  if (options.initialUrl) {
    args.push(options.initialUrl);
  }

  const child = spawn(chromeExe, args, {
    detached: true,
    stdio: "ignore",
    windowsHide: false,
  });
  child.unref();
  return {
    pid: child.pid,
    executablePath: chromeExe,
    cdpPort: port,
    userDataDir: userDataDir ?? null,
  };
}

module.exports = {
  DEFAULT_CHROME_PROFILE,
  DEFAULT_LOCAL_CHROME_CDP_PORT,
  closeEmbeddedChrome,
  embedPlatformInElectronWindow,
  findLocalChromeExecutable,
  focusEmbeddedChrome,
  getDefaultChromeUserDataDir,
  getNativeWindowHandleDecimal,
  isEmbeddedChromeAlive,
  launchLocalChromeWithCdp,
  listChromeWindowHandles,
  onEmbeddedChromeClosed,
  openOrFocusLocalChromeTab,
  openPlatformInLocalChrome,
  openUrlInRunningLocalChromeShell,
  probeLocalChromeCdp,
  readDevToolsActivePort,
  resolveLocalChromeCdpPort,
  resolvePreferredCdpEndpoint,
  scaleRectForWin32,
  shutdownEmbedDaemon,
  syncEmbeddedChromeBounds,
};
