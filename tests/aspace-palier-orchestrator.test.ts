import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildAgentBrowserCommand,
  buildAgentDesktopCommand,
  collectPalierReadiness,
  exportCliHarnessConfig,
  formatResponsesJsonAsAnthropicMessage,
  formatResponsesJsonAsChatCompletions,
  normalizeAnthropicMessagesToResponsesRequest,
  normalizeChatCompletionsToResponsesRequest,
  SOVEREIGN_WEB_PLATFORMS,
  SUPPORTED_CLI_HARNESSES,
} from "../src/adapters/aspace-palier-orchestrator";
import type { ProviderAdapter } from "../src/adapters/base";
import { defaultConfig } from "../src/config";
import { startServer } from "../src/server";

describe("Aspace Paliers 1-3 orchestrator", () => {
  test("collects Palier 1-3 readiness with FKB04 repos, Vercel CLIs, and Western+Chinese platforms", () => {
    const status = collectPalierReadiness();
    const hasFkb04Repos = status.tools.some(t => t.repoPresent);
    if (hasFkb04Repos && status.tools.find(t => t.id === "agent-browser")?.cliAvailable) {
      expect(status.paliers.palier1_web_stabilized.ready).toBe(true);
    } else {
      expect(typeof status.paliers.palier1_web_stabilized.ready).toBe("boolean");
    }
    if (hasFkb04Repos && status.tools.find(t => t.id === "agent-desktop")?.cliAvailable) {
      expect(status.paliers.palier2_plus_desktop.ready).toBe(true);
    } else {
      expect(typeof status.paliers.palier2_plus_desktop.ready).toBe("boolean");
    }
    expect(status.paliers.palier3_pro_agnostic.ready).toBe(true);
    expect(status.paliers.phase5_drive_egm.ready).toBe(true);

    const ids = new Set(status.platforms.map(p => p.id));
    for (const required of ["chatgpt", "gemini", "claude", "grok", "muse", "deepseek", "qwen", "zai", "kimi"]) {
      expect(ids.has(required)).toBe(true);
    }
    expect(SOVEREIGN_WEB_PLATFORMS.some(p => p.region === "chinese")).toBe(true);
  }, 15_000);

  test("builds zero-telemetry agent-browser and agent-desktop commands", () => {
    const browserCmd = buildAgentBrowserCommand(["snapshot", "-i"], 9222);
    expect(browserCmd.command).toBe("agent-browser");
    expect(browserCmd.args).toEqual(["--cdp", "9222", "snapshot", "-i"]);
    expect(browserCmd.env.DO_NOT_TRACK).toBe("1");

    const desktopCmd = buildAgentDesktopCommand(["snapshot", "--app", "ChatGPT"]);
    expect(desktopCmd.command).toBe("agent-desktop");
    expect(desktopCmd.args).toEqual(["snapshot", "--app", "ChatGPT"]);
    expect(desktopCmd.env.ASPACE_ZERO_TELEMETRY).toBe("1");
  });

  test("normalizes OpenAI chat.completions and Anthropic messages to Responses and back", () => {
    const openAiReq = normalizeChatCompletionsToResponsesRequest({
      model: "gpt-5.4",
      messages: [
        { role: "system", content: "Be concise." },
        { role: "user", content: "Ping" },
      ],
    });
    expect(openAiReq.instructions).toBe("Be concise.");
    expect(openAiReq.input).toEqual([{ role: "user", content: "Ping" }]);

    const chatJson = formatResponsesJsonAsChatCompletions({
      id: "resp_123",
      model: "gpt-5.4",
      output: [{ type: "message", content: [{ type: "output_text", text: "Pong" }] }],
      usage: { input_tokens: 4, output_tokens: 1, total_tokens: 5 },
    });
    expect((chatJson.choices as Array<{ message: { content: string } }>)[0]!.message.content).toBe("Pong");

    const anthropicReq = normalizeAnthropicMessagesToResponsesRequest({
      model: "claude-sonnet-4-5",
      system: "System prompt",
      messages: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
    });
    expect(anthropicReq.instructions).toBe("System prompt");
    expect(anthropicReq.input).toEqual([{ role: "user", content: "Hello" }]);

    const anthropicMsg = formatResponsesJsonAsAnthropicMessage({
      id: "resp_456",
      output: [{ type: "message", content: [{ type: "output_text", text: "World" }] }],
      usage: { input_tokens: 2, output_tokens: 1 },
    });
    expect(anthropicMsg.type).toBe("message");
    expect((anthropicMsg.content as Array<{ text: string }>)[0]!.text).toBe("World");
  });

  test("exports agnostic CLI configs for all supported harnesses", () => {
    for (const harness of SUPPORTED_CLI_HARNESSES) {
      const cfg = exportCliHarnessConfig(harness, 17841);
      expect(cfg.harness).toBe(harness);
      expect(cfg.baseUrl).toContain("127.0.0.1:17841");
    }
    expect(exportCliHarnessConfig("claude-code").protocol).toBe("anthropic-messages");
    expect(exportCliHarnessConfig("hermes-agent").protocol).toBe("openai-chat-completions");
  });

  test("serves /v1/aspace/paliers, /v1/chat/completions, and /v1/messages over HTTP", async () => {
    const tempHome = mkdtempSync(join(tmpdir(), "ccw-palier-test-"));
    const prevHome = process.env.CODEX_CHATGPT_WEB_HOME;
    process.env.CODEX_CHATGPT_WEB_HOME = tempHome;
    const mockAdapter: ProviderAdapter = {
      name: "mock-palier-adapter",
      async runTurn(_parsed, _incoming, emit) {
        emit({ type: "text_delta", text: "OK-AGNOSTIC" });
        emit({ type: "done", usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 } });
      },
    };
    const config = defaultConfig();
    config.port = 0;
    const server = startServer(config, { adapterFactory: () => mockAdapter });
    try {
      const base = `http://127.0.0.1:${server.port}`;
      const palierRes = await fetch(`${base}/v1/aspace/paliers`);
      expect(palierRes.status).toBe(200);
      const palierJson = await palierRes.json() as { paliers: { palier3_pro_agnostic: { ready: boolean } } };
      expect(palierJson.paliers.palier3_pro_agnostic.ready).toBe(true);

      const chatRes = await fetch(`${base}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "gpt-5.4", messages: [{ role: "user", content: "hi" }] }),
      });
      expect(chatRes.status).toBe(200);
      const chatJson = await chatRes.json() as { choices: Array<{ message: { content: string } }> };
      expect(chatJson.choices[0]!.message.content).toBe("OK-AGNOSTIC");

      const msgRes = await fetch(`${base}/v1/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "claude-sonnet-4-5", messages: [{ role: "user", content: "hi" }] }),
      });
      expect(msgRes.status).toBe(200);
      const msgJson = await msgRes.json() as { content: Array<{ text: string }> };
      expect(msgJson.content[0]!.text).toBe("OK-AGNOSTIC");

      const prevDsh = process.env.DSH_HOME;
      const tmpDsh = mkdtempSync(join(tmpdir(), "ccw-dsh-state-"));
      process.env.DSH_HOME = tmpDsh;
      try {
        const saRes = await fetch(`${base}/v1/aspace/superagent/state`);
        expect(saRes.status).toBe(200);
        const saJson = await saRes.json() as { profile: { patchPath: string }; bridge: { devAutoMergeEnabled: boolean } };
        expect(saJson.profile.patchPath).toContain("cordis.patch.yml");
        expect(typeof saJson.bridge.devAutoMergeEnabled).toBe("boolean");

        const hookRes = await fetch(`${base}/v1/aspace/superagent/ld08-webhook`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ devAutoMergeEnabled: true }),
        });
        expect(hookRes.status).toBe(200);

        const ssrfRes = await fetch(`${base}/v1/aspace/superagent/ld08-webhook`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ webhookUrl: "http://evil.example/hook" }),
        });
        expect(ssrfRes.status).toBe(400);

        const badEgmRes = await fetch(`${base}/v1/aspace/egm/dispatch`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
        });
        expect(badEgmRes.status).toBe(400);

        const traversalRes = await fetch(`${base}/v1/aspace/egm/dispatch`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            manifestName: "evil.md",
            outDir: join(import.meta.dir, "..", "src"),
            skipFactoryIntake: true,
          }),
        });
        expect(traversalRes.status).toBe(400);

        const receivedChatPayloads: Array<{ text?: string }> = [];
        const mockWebhook = Bun.serve({
          port: 0,
          async fetch(req) {
            receivedChatPayloads.push(await req.json() as { text?: string });
            return Response.json({ ok: true });
          },
        });
        const prevLoopbackTest = process.env.ASPACE_ALLOW_LOCALHOST_WEBHOOK_TEST;
        process.env.ASPACE_ALLOW_LOCALHOST_WEBHOOK_TEST = "1";
        try {
          const saveHookRes = await fetch(`${base}/v1/aspace/superagent/ld08-webhook`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ webhookUrl: `http://127.0.0.1:${mockWebhook.port}/ld08`, devAutoMergeEnabled: true }),
          });
          expect(saveHookRes.status).toBe(200);
          const saveHookJson = await saveHookRes.json() as { bridge: Record<string, unknown> };
          expect("ld08WebhookUrl" in saveHookJson.bridge).toBe(false);
          expect(saveHookJson.bridge.ld08WebhookConfigured).toBe(true);

          const gfOut = join(tmpDsh, "goldfish-http");
          const dispatchRes = await fetch(`${base}/v1/aspace/egm/dispatch`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              manifestId: "drive-file-001",
              manifestName: "V0.1_Test_Manifest.md",
              versionFolder: "V0.1",
              excerpt: "Validation Phase 5 Drive -> Goldfish",
              source: "test-suite",
              outDir: gfOut,
              notifyLd08: true,
              skipFactoryIntake: true,
            }),
          });
          expect(dispatchRes.status).toBe(200);
          const dispatchJson = await dispatchRes.json() as {
            ok: boolean;
            deduplicated: boolean;
            contractPath: string;
            mission: {
              missionId: string;
              branchPolicy: string;
              ld08Notification?: { delivered: boolean };
            };
          };
          expect(dispatchJson.ok).toBe(true);
          expect(dispatchJson.deduplicated).toBe(false);
          expect(dispatchJson.mission.branchPolicy).toBe("dev/* auto-merge:true");
          expect(dispatchJson.mission.ld08Notification?.delivered).toBe(true);
          expect(existsSync(dispatchJson.contractPath)).toBe(true);
          expect(readFileSync(dispatchJson.contractPath, "utf8")).toContain("Validation Phase 5 Drive -> Goldfish");
          expect(receivedChatPayloads[0]?.text).toContain("[person/delivery]");

          const dupRes = await fetch(`${base}/v1/aspace/egm/dispatch`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              manifestId: "drive-file-001",
              manifestName: "V0.1_Test_Manifest.md",
              versionFolder: "V0.1",
              excerpt: "Validation Phase 5 Drive -> Goldfish",
              outDir: gfOut,
              skipFactoryIntake: true,
            }),
          });
          const dupJson = await dupRes.json() as { deduplicated: boolean };
          expect(dupJson.deduplicated).toBe(true);

          const listRes = await fetch(`${base}/v1/aspace/egm/missions`);
          expect(listRes.status).toBe(200);
          const listJson = await listRes.json() as { count: number; missions: Array<{ missionId: string }> };
          expect(listJson.count).toBe(1);
          expect(listJson.missions[0]?.missionId).toBe(dispatchJson.mission.missionId);
        } finally {
          if (prevLoopbackTest === undefined) delete process.env.ASPACE_ALLOW_LOCALHOST_WEBHOOK_TEST;
          else process.env.ASPACE_ALLOW_LOCALHOST_WEBHOOK_TEST = prevLoopbackTest;
          mockWebhook.stop(true);
        }
      } finally {
        if (prevDsh === undefined) delete process.env.DSH_HOME;
        else process.env.DSH_HOME = prevDsh;
        rmSync(tmpDsh, { recursive: true, force: true });
      }
    } finally {
      await server.stop(true);
      if (prevHome === undefined) delete process.env.CODEX_CHATGPT_WEB_HOME;
      else process.env.CODEX_CHATGPT_WEB_HOME = prevHome;
      rmSync(tempHome, { recursive: true, force: true });
    }
  }, 20_000);

  test("CLI palier dispatch-manifest handles empty flags and --- frontmatter excerpts cleanly", () => {
    const tmpDsh = mkdtempSync(join(tmpdir(), "ccw-cli-goldfish-"));
    const gfOut = join(tmpDsh, "contracts");
    try {
      const res = Bun.spawnSync(
        [
          process.execPath,
          "run",
          "src/cli.ts",
          "palier",
          "dispatch-manifest",
          "--name",
          "V0.1_CLI_Manifest.md",
          "--id",
          "cli-001",
          "--folder",
          "V0.1",
          "--url",
          "",
          "--excerpt",
          "---\ntype: manifest\n---\nCLI Goldfish payload",
          "--out",
          gfOut,
          "--skip-factory-intake",
          "--json",
        ],
        {
          cwd: join(import.meta.dir, ".."),
          env: { ...process.env, DSH_HOME: tmpDsh },
        },
      );
      expect(res.exitCode).toBe(0);
      const parsed = JSON.parse(new TextDecoder().decode(res.stdout)) as {
        ok: boolean;
        contractPath: string;
        mission: { manifestName: string; versionFolder: string; excerpt: string };
      };
      expect(parsed.ok).toBe(true);
      expect(parsed.mission.manifestName).toBe("V0.1_CLI_Manifest.md");
      expect(parsed.mission.versionFolder).toBe("V0.1");
      expect(parsed.mission.excerpt).toContain("type: manifest");
      expect(existsSync(parsed.contractPath)).toBe(true);
    } finally {
      rmSync(tmpDsh, { recursive: true, force: true });
    }
  }, 15_000);
});
