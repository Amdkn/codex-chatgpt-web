/**
 * Aspace OS V5 · Phase 5 — Google Apps Script Poller (V0.1-P5-U1)
 *
 * Surveille les dossiers Drive LDo8 (`CPU-CLI` et `CPU CLI-Plateformes-Unifier`),
 * extrait le contenu texte (Google Docs + Markdown/JSON/GS) avec curseur
 * idempotent par fichier (`PROCESSED_VERSIONS_JSON`), et déclenche :
 *   1. GitHub Actions (`repository_dispatch` -> `aspace_drive_manifest`)
 *   2. Google Chat Space LD08 (si `GCHAT_LD08_WEBHOOK_URL` est défini)
 *
 * Installation (1 fois dans script.google.com) :
 *   1. Propriétés du script -> ajouter `GITHUB_PAT` (scope repo)
 *      et optionnellement `GCHAT_LD08_WEBHOOK_URL`
 *   2. Exécuter `testDryRunPoll()` puis `installEveryMinuteTrigger()`
 */

const DRIVE_ROOTS = [
  { label: "CPU-CLI", id: "1EVTFJOh66F2frvnapvMaUogcUt6EG2xC" },
  { label: "CPU CLI-Plateformes-Unifier", id: "18vnWORW2ZtWcB6wsYuuh472dir9_qy1T" },
];
const GITHUB_OWNER = "Amdkn";
const GITHUB_REPO = "codex-chatgpt-web";

function loadProcessedVersions_(props) {
  try {
    const raw = props.getProperty("PROCESSED_VERSIONS_JSON");
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (err) {
    return {};
  }
}

function saveProcessedVersions_(props, map) {
  const entries = Object.entries(map);
  if (entries.length > 200) {
    entries.sort((a, b) => String(b[1]).localeCompare(String(a[1])));
    map = Object.fromEntries(entries.slice(0, 200));
  }
  props.setProperty("PROCESSED_VERSIONS_JSON", JSON.stringify(map));
}

function readManifestExcerpt_(file) {
  try {
    const mime = file.getMimeType();
    if (mime === MimeType.GOOGLE_DOCS) {
      return DocumentApp.openById(file.getId()).getBody().getText().slice(0, 1200);
    }
    if (
      mime.indexOf("text/") === 0 ||
      mime === "application/json" ||
      mime === "application/vnd.google-apps.script" ||
      /\.(md|txt|json|yml|yaml|gs|ts|js|ps1)$/i.test(file.getName())
    ) {
      return file.getBlob().getDataAsString("UTF-8").slice(0, 1200);
    }
  } catch (err) {
    return "[Unreadable excerpt: " + err.message + "]";
  }
  return "";
}

function collectDriveFiles_(root) {
  const collected = [];
  const rootFolder = DriveApp.getFolderById(root.id);

  const rootFiles = rootFolder.getFiles();
  while (rootFiles.hasNext()) {
    collected.push({ file: rootFiles.next(), versionFolder: root.label });
  }

  const subfolders = rootFolder.getFolders();
  while (subfolders.hasNext()) {
    const sub = subfolders.next();
    const versionFolder = root.label + "/" + sub.getName();
    const files = sub.getFiles();
    while (files.hasNext()) {
      collected.push({ file: files.next(), versionFolder: versionFolder });
    }
  }
  return collected;
}

function dispatchToGitHub_(pat, payload) {
  if (!pat) return { ok: false, skipped: true, reason: "GITHUB_PAT missing" };
  const ghRes = UrlFetchApp.fetch(
    "https://api.github.com/repos/" + GITHUB_OWNER + "/" + GITHUB_REPO + "/dispatches",
    {
      method: "post",
      contentType: "application/json",
      muteHttpExceptions: true,
      headers: {
        Authorization: "Bearer " + pat,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "Aspace-OS-V5-Drive-Poller",
      },
      payload: JSON.stringify({
        event_type: "aspace_drive_manifest",
        client_payload: payload,
      }),
    },
  );
  const code = ghRes.getResponseCode();
  return {
    ok: code >= 200 && code < 300,
    status: code,
    body: String(ghRes.getContentText() || "").slice(0, 200),
  };
}

function notifyGoogleChatLd08_(webhookUrl, payload) {
  if (!webhookUrl) return { ok: false, skipped: true };
  const res = UrlFetchApp.fetch(webhookUrl, {
    method: "post",
    contentType: "application/json",
    muteHttpExceptions: true,
    payload: JSON.stringify({
      text:
        "[person/delivery] Drive Manifest -> EGM Goldfish (" +
        payload.version_folder +
        ") : " +
        payload.manifest_name +
        "\n" +
        payload.manifest_url,
    }),
  });
  const code = res.getResponseCode();
  return { ok: code >= 200 && code < 300, status: code };
}

function pollLDo8ManifestsAndDispatch(options) {
  const dryRun = options && options.dryRun === true;
  const props = PropertiesService.getScriptProperties();
  const pat = props.getProperty("GITHUB_PAT");
  const gchatWebhook = props.getProperty("GCHAT_LD08_WEBHOOK_URL");
  const processed = loadProcessedVersions_(props);
  const nowIso = new Date().toISOString();

  const summary = { checked: 0, dispatched: [], skipped: [], errors: [] };

  for (let i = 0; i < DRIVE_ROOTS.length; i++) {
    const entries = collectDriveFiles_(DRIVE_ROOTS[i]);
    for (let j = 0; j < entries.length; j++) {
      const entry = entries[j];
      const file = entry.file;
      const fileId = file.getId();
      const updatedIso = file.getLastUpdated().toISOString();
      summary.checked++;

      if (processed[fileId] === updatedIso) {
        summary.skipped.push(file.getName());
        continue;
      }

      const payload = {
        manifest_id: fileId,
        manifest_name: file.getName(),
        version_folder: entry.versionFolder,
        manifest_url: file.getUrl(),
        updated_at: updatedIso,
        excerpt: readManifestExcerpt_(file),
        source: "apps-script-drive-poll",
      };

      if (dryRun) {
        summary.dispatched.push({ file: payload.manifest_name, version: payload.version_folder, dryRun: true });
        continue;
      }

      const ghOut = dispatchToGitHub_(pat, payload);
      const chatOut = notifyGoogleChatLd08_(gchatWebhook, payload);

      if (ghOut.ok || (!pat && chatOut.ok)) {
        processed[fileId] = updatedIso;
        summary.dispatched.push({ file: payload.manifest_name, version: payload.version_folder, ghStatus: ghOut.status });
      } else {
        summary.errors.push({
          file: payload.manifest_name,
          ghStatus: ghOut.status || 0,
          reason: ghOut.reason || ghOut.body || "dispatch_failed",
        });
      }
    }
  }

  if (!dryRun) {
    saveProcessedVersions_(props, processed);
    props.setProperty("LAST_POLL_ISO", nowIso);
  }
  Logger.log(JSON.stringify(summary));
  return summary;
}

function testDryRunPoll() {
  return pollLDo8ManifestsAndDispatch({ dryRun: true });
}

function resetPollState() {
  const props = PropertiesService.getScriptProperties();
  props.deleteProperty("PROCESSED_VERSIONS_JSON");
  props.deleteProperty("LAST_POLL_ISO");
}

function installEveryMinuteTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  for (let i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === "pollLDo8ManifestsAndDispatch") {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  ScriptApp.newTrigger("pollLDo8ManifestsAndDispatch")
    .timeBased()
    .everyMinutes(1)
    .create();
}
