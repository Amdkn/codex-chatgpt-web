const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const {
  closeEmbeddedChrome,
  focusEmbeddedChrome,
  getNativeWindowHandleDecimal,
  isEmbeddedChromeAlive,
  listChromeWindowHandles,
  onEmbeddedChromeClosed,
  openOrFocusLocalChromeTab,
  openPlatformInLocalChrome,
  probeLocalChromeCdp,
  readDevToolsActivePort,
  resolvePreferredCdpEndpoint,
  scaleRectForWin32,
  shutdownEmbedDaemon,
  syncEmbeddedChromeBounds,
} = require("../electron/aspace-local-chrome.cjs");
const {
  dispatchDriveManifestToEgmGoldfish,
  ensureSuperAgentProfile,
  listEgmGoldfishMissions,
  orchestratorRequest,
  readBridgeConfig,
  triggerDevAutoMerge,
  validateGoogleChatWebhookUrl,
  writeBridgeConfig,
} = require("../electron/aspace-superagent-bridge.cjs");

function startMockCdpServer() {
  const tabs = [
    { id: "tab-google", type: "page", url: "https://gemini.google.com/app", title: "Gemini" },
  ];
  const activated = [];
  const created = [];

  const server = http.createServer((req, res) => {
    const url = req.url || "/";
    res.setHeader("Content-Type", "application/json");
    if (url === "/json/version") {
      res.end(
        JSON.stringify({
          Browser: "Chrome/157.0.8103.52",
          "Protocol-Version": "1.3",
          webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/browser/mock",
        }),
      );
      return;
    }
    if (url === "/json/list") {
      res.end(JSON.stringify(tabs));
      return;
    }
    if (url.startsWith("/json/activate/")) {
      const id = decodeURIComponent(url.slice("/json/activate/".length));
      activated.push(id);
      res.end(JSON.stringify({ activated: id }));
      return;
    }
    if (url.startsWith("/json/new?")) {
      const targetUrl = decodeURIComponent(url.slice("/json/new?".length));
      const newTab = { id: `tab-${tabs.length + 1}`, type: "page", url: targetUrl };
      tabs.push(newTab);
      created.push(targetUrl);
      res.end(JSON.stringify(newTab));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not found" }));
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve({
        port: addr.port,
        activated,
        created,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

test("probeLocalChromeCdp detects running local Chrome CDP and resolves preferred endpoint", async () => {
  const mock = await startMockCdpServer();
  try {
    const probe = await probeLocalChromeCdp(mock.port);
    assert.equal(probe.available, true);
    assert.equal(probe.transport, "http-cdp");
    assert.equal(probe.cdpPort, mock.port);
    assert.match(probe.webSocketDebuggerUrl, /^ws:\/\/127\.0\.0\.1:/);

    const resolved = await resolvePreferredCdpEndpoint(45555, mock.port);
    assert.equal(resolved.mode, "local-chrome");
    assert.equal(resolved.cdpPort, mock.port);
  } finally {
    await mock.close();
  }
});

test("resolvePreferredCdpEndpoint falls back cleanly to electron-webview when Chrome CDP is absent", async () => {
  const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "aspace-no-cdp-"));
  const resolved = await resolvePreferredCdpEndpoint(45555, 59999);
  assert.equal(typeof resolved.mode, "string");
  assert.equal(readDevToolsActivePort(emptyDir), null);
  fs.rmSync(emptyDir, { recursive: true, force: true });
});

test("openOrFocusLocalChromeTab focuses existing origin tab and creates missing origin tab", async () => {
  const mock = await startMockCdpServer();
  try {
    const focused = await openOrFocusLocalChromeTab("https://gemini.google.com/", mock.port);
    assert.equal(focused.action, "focused");
    assert.equal(focused.targetId, "tab-google");
    assert.deepEqual(mock.activated, ["tab-google"]);

    const created = await openOrFocusLocalChromeTab("https://open.feishu.cn/", mock.port);
    assert.equal(created.action, "created");
    assert.equal(created.url, "https://open.feishu.cn/");
    assert.deepEqual(mock.created, ["https://open.feishu.cn/"]);
  } finally {
    await mock.close();
  }
});

test("openPlatformInLocalChrome detects Chrome M144-157 DevToolsActivePort and delegates to agent-browser auto-connect", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aspace-m157-"));
  const tcpServer = net.createServer();
  await new Promise((resolve) => tcpServer.listen(0, "127.0.0.1", resolve));
  const tcpPort = tcpServer.address().port;
  fs.writeFileSync(path.join(tmpDir, "DevToolsActivePort"), `${tcpPort}\n/devtools/browser/test-id\n`);

  const openedUrls = [];
  try {
    const result = await openPlatformInLocalChrome("https://studio.workspace.google.com/", {
      cdpPort: 59998,
      userDataDir: tmpDir,
      allowShellFallback: false,
      autoConnectOpenFn: async (u) => {
        openedUrls.push(u);
        return { ok: true, code: 0 };
      },
    });
    assert.equal(result.handled, true);
    assert.equal(result.transport, "devtools-active-port");
    assert.equal(result.action, "opened-via-auto-connect");
    assert.deepEqual(openedUrls, ["https://studio.workspace.google.com/"]);
  } finally {
    await new Promise((done) => tcpServer.close(done));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("openPlatformInLocalChrome falls back to opening URL in signed-in Chrome Local profile when CDP is disabled", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aspace-shell-"));
  const shellCalls = [];
  try {
    const result = await openPlatformInLocalChrome("https://aistudio.google.com/", {
      cdpPort: 59997,
      userDataDir: tmpDir,
      allowShellFallback: true,
      shellOpenFn: (url) => {
        shellCalls.push(url);
        return {
          launched: true,
          action: "shell-open-in-local-chrome",
          transport: "chrome-profile-shell",
          profileDirectory: "Default",
          url,
          pid: 99999,
        };
      },
    });
    assert.equal(result.handled, true);
    assert.equal(result.transport, "chrome-profile-shell");
    assert.equal(result.profileDirectory, "Default");
    assert.deepEqual(shellCalls, ["https://aistudio.google.com/"]);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("scaleRectForWin32 and getNativeWindowHandleDecimal convert Electron DIPs and HWND buffers", () => {
  assert.deepEqual(
    scaleRectForWin32({ x: 100, y: 80, width: 1000, height: 700 }, 1.5),
    { x: 150, y: 120, width: 1500, height: 1050 },
  );
  const buf = Buffer.alloc(8);
  buf.writeBigInt64LE(123456789n, 0);
  assert.equal(getNativeWindowHandleDecimal({ getNativeWindowHandle: () => buf }), "123456789");
  assert.equal(getNativeWindowHandleDecimal({}), null);
});

test("aspace-superagent-bridge provisions cordis.patch.yml and sends x-orchestrator-request header", async () => {
  const prevDshHome = process.env.DSH_HOME;
  const tmpDsh = fs.mkdtempSync(path.join(os.tmpdir(), "aspace-dsh-test-"));
  process.env.DSH_HOME = tmpDsh;
  try {
    const profile = ensureSuperAgentProfile();
    assert.equal(fs.existsSync(profile.patchPath), true);
    const yaml = fs.readFileSync(profile.patchPath, "utf8");
    assert.match(yaml, /port: 3082/);
    assert.match(yaml, /freellmapi/);

    const saved = writeBridgeConfig({ devAutoMergeEnabled: true, ld08WebhookUrl: "https://chat.googleapis.com/mock" });
    assert.equal(saved.devAutoMergeEnabled, true);
    assert.equal(readBridgeConfig().ld08WebhookUrl, "https://chat.googleapis.com/mock");
  } finally {
    if (prevDshHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = prevDshHome;
    fs.rmSync(tmpDsh, { recursive: true, force: true });
  }
  assert.equal(typeof orchestratorRequest, "function");
});

test("win32 embed daemon isolates child inside HostForm container with DPI awareness and clean lifecycle", async (t) => {
  assert.equal(typeof focusEmbeddedChrome, "function");
  assert.equal(typeof onEmbeddedChromeClosed, "function");
  assert.equal(typeof shutdownEmbedDaemon, "function");

  const embedExe = path.join(__dirname, "..", "electron", "aspace-win32-embed.exe");
  if (process.platform !== "win32" || !fs.existsSync(embedExe)) {
    t.skip("Windows Win32 embed helper not built on this host");
    return;
  }

  const { spawn } = require("node:child_process");
  const psScript = `
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    $parent = New-Object System.Windows.Forms.Form
    $parent.FormBorderStyle = 'None'
    $parent.ShowInTaskbar = $false
    $parent.StartPosition = 'Manual'
    $parent.Location = New-Object System.Drawing.Point(-32000, -32000)
    $parent.Size = New-Object System.Drawing.Size(1200, 800)
    $child = New-Object System.Windows.Forms.Form
    $child.ShowInTaskbar = $false
    $child.StartPosition = 'Manual'
    $child.Location = New-Object System.Drawing.Point(-32000, -32000)
    $child.Size = New-Object System.Drawing.Size(600, 400)
    $null = $parent.Handle
    $null = $child.Handle
    $parent.Show()
    $child.Show()
    [Console]::Out.WriteLine("HANDLES=$($parent.Handle.ToInt64()),$($child.Handle.ToInt64())")
    [Console]::Out.Flush()
    $timer = New-Object System.Windows.Forms.Timer
    $timer.Interval = 15000
    $timer.Add_Tick({ $parent.Close(); [System.Windows.Forms.Application]::ExitThread() })
    $timer.Start()
    [System.Windows.Forms.Application]::Run($parent)
  `;
  const fixture = spawn("pwsh", ["-NoProfile", "-STA", "-Command", psScript], {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const handles = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out launching Win32 test forms")), 15000);
    let buf = "";
    fixture.stdout.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      const m = buf.match(/HANDLES=(\d+),(\d+)/);
      if (m) {
        clearTimeout(timer);
        resolve({ parent: m[1], child: m[2] });
      }
    });
    fixture.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });

  const daemon = spawn(embedExe, ["serve"], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  let rpcSeq = 0;
  let daemonBuf = "";
  const pending = new Map();
  const events = [];
  const callDaemon = (cmd, payload = {}) => new Promise((resolve, reject) => {
    const id = `t${++rpcSeq}`;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Timeout waiting for ${cmd}`));
    }, 4000);
    pending.set(id, { resolve, reject, timer });
    daemon.stdin.write(`${JSON.stringify({ id, cmd, ...payload })}\n`);
  });

  await new Promise((resolve, reject) => {
    const readyTimer = setTimeout(() => reject(new Error("Daemon ready timeout")), 4000);
    daemon.stdout.on("data", (chunk) => {
      daemonBuf += chunk.toString("utf8");
      let idx;
      while ((idx = daemonBuf.indexOf("\n")) >= 0) {
        const line = daemonBuf.slice(0, idx).trim();
        daemonBuf = daemonBuf.slice(idx + 1);
        if (!line) continue;
        const msg = JSON.parse(line);
        if (msg.event === "ready") {
          clearTimeout(readyTimer);
          resolve();
          continue;
        }
        if (msg.event) {
          events.push(msg);
          continue;
        }
        if (msg.id && pending.has(msg.id)) {
          const entry = pending.get(msg.id);
          pending.delete(msg.id);
          clearTimeout(entry.timer);
          entry.resolve(msg);
        }
      }
    });
    daemon.once("error", reject);
  });

  try {
    const listRes = await callDaemon("list-chrome");
    assert.equal(listRes.ok, true);
    assert.equal(Array.isArray(listRes.handles), true);
    const handlesViaModule = await listChromeWindowHandles();
    assert.equal(Array.isArray(handlesViaModule), true);

    const attachRes = await callDaemon("attach", {
      parent: handles.parent,
      child: handles.child,
      x: 250,
      y: 90,
      w: 800,
      h: 500,
      visible: true,
    });
    assert.equal(attachRes.ok, true);
    assert.match(String(attachRes.host), /^\d+$/);

    const aliveRes = await callDaemon("is-window", { child: handles.child });
    assert.equal(aliveRes.ok, true);
    assert.equal(aliveRes.alive, true);
    assert.equal(await isEmbeddedChromeAlive(handles.child), true);

    const boundsRes = await callDaemon("bounds", {
      child: handles.child,
      x: 250,
      y: 90,
      w: 920,
      h: 610,
      visible: true,
    });
    assert.equal(boundsRes.ok, true);
    assert.equal(await syncEmbeddedChromeBounds(handles.child, { x: 250, y: 90, width: 800, height: 500 }, true, 1.5), true);

    const focusRes = await callDaemon("focus", { child: handles.child });
    assert.equal(focusRes.ok, true);

    const closeRes = await callDaemon("close", { child: handles.child });
    assert.equal(closeRes.ok, true);
    assert.equal(await closeEmbeddedChrome("999999999"), true);
  } finally {
    shutdownEmbedDaemon();
    try { daemon.stdin.end(); } catch {}
    setTimeout(() => { try { daemon.kill(); } catch {} try { fixture.kill(); } catch {} }, 150).unref?.();
    await new Promise((r) => setTimeout(r, 200));
    try { daemon.kill(); } catch {}
    try { fixture.kill(); } catch {}
  }
});

test("CJS Phase 5 dispatchDriveManifestToEgmGoldfish persists idempotent Goldfish mission", async () => {
  const prevDsh = process.env.DSH_HOME;
  const tmpDsh = fs.mkdtempSync(path.join(os.tmpdir(), "ccw-cjs-goldfish-"));
  process.env.DSH_HOME = tmpDsh;
  try {
    const outDir = path.join(tmpDsh, "goldfish");
    const first = await dispatchDriveManifestToEgmGoldfish({
      manifestId: "drive-cjs-001",
      manifestName: "V0.1_Phases_1_9_CPU_Contrat.md",
      versionFolder: "V0.1",
      excerpt: "Validation Phase 5 depuis bridge Electron CJS",
      outDir,
      skipFactoryIntake: true,
    });
    assert.equal(first.ok, true);
    assert.equal(first.deduplicated, false);
    assert.equal(fs.existsSync(first.contractPath), true);
    assert.match(fs.readFileSync(first.contractPath, "utf8"), /dev\/\* auto-merge:true/);

    const replay = await dispatchDriveManifestToEgmGoldfish({
      manifestId: "drive-cjs-001",
      manifestName: "V0.1_Phases_1_9_CPU_Contrat.md",
      versionFolder: "V0.1",
      excerpt: "Validation Phase 5 depuis bridge Electron CJS",
      outDir,
      skipFactoryIntake: true,
    });
    assert.equal(replay.deduplicated, true);

    const forced = await dispatchDriveManifestToEgmGoldfish({
      manifestId: "drive-cjs-001",
      manifestName: "V0.1_Phases_1_9_CPU_Contrat.md",
      versionFolder: "V0.1",
      excerpt: "Validation Phase 5 depuis bridge Electron CJS",
      outDir,
      skipFactoryIntake: true,
      force: true,
    });
    assert.equal(forced.deduplicated, false);
    assert.equal(forced.mission.dispatches, 2);

    const list = listEgmGoldfishMissions();
    assert.equal(list.count, 1);
    assert.equal(list.missions[0].missionId, first.mission.missionId);

    // Différent outDir -> ne déduplique pas sur l'ancien chemin
    const outDir2 = path.join(tmpDsh, "goldfish-alt");
    const alt = await dispatchDriveManifestToEgmGoldfish({
      manifestId: "drive-cjs-001",
      manifestName: "V0.1_Phases_1_9_CPU_Contrat.md",
      versionFolder: "V0.1",
      excerpt: "Validation Phase 5 depuis bridge Electron CJS",
      outDir: outDir2,
      skipFactoryIntake: true,
    });
    assert.equal(alt.deduplicated, false);
    assert.equal(fs.existsSync(alt.contractPath), true);

    // Validation Webhook LD08 & Isolation Prod/Dev
    assert.match(
      validateGoogleChatWebhookUrl("https://chat.googleapis.com/v1/spaces/ABC/messages?key=k&token=t"),
      /^https:\/\/chat\.googleapis\.com\//,
    );
    assert.throws(() => validateGoogleChatWebhookUrl("http://chat.googleapis.com/v1/spaces/x"), /HTTPS/);
    assert.throws(() => validateGoogleChatWebhookUrl("https://evil.example/hook"), /chat\.googleapis\.com/);

    for (const blocked of ["main", "master", "prod/v1", "production-hotfix", "release/1.0", "--admin", "aspace-v5-native"]) {
      await assert.rejects(() => triggerDevAutoMerge(blocked), /Auto-merge|invalide/i);
    }
  } finally {
    if (prevDsh === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = prevDsh;
    fs.rmSync(tmpDsh, { recursive: true, force: true });
  }
});
