/**
 * Aspace OS V5 · Phase 5 — Google Apps Script Poller (V0.1-P5-U1)
 *
 * Surveille récursivement les dossiers Drive LDo8 (`CPU-CLI` et `CPU CLI-Plateformes-Unifier`),
 * extrait le texte (Google Docs + fichiers texte/Markdown/JSON/GS, hors conteneurs Google),
 * gère un curseur idempotent borné à 80 entrées (< 9 KB quota ScriptProperties),
 * puis déclenche GitHub Actions (`repository_dispatch` -> `aspace_drive_manifest`)
 * et notifie Google Chat Space LD08 uniquement après succès GitHub.
 */

const DRIVE_ROOTS = [
  { label: "CPU-CLI", id: "1EVTFJOh66F2frvnapvMaUogcUt6EG2xC" },
  { label: "CPU CLI-Plateformes-Unifier", id: "18vnWORW2ZtWcB6wsYuuh472dir9_qy1T" },
];
const GITHUB_OWNER = "Amdkn";
const GITHUB_REPO = "codex-chatgpt-web";
const MAX_TRACKED_FILES = 80; // Reste strictement sous la limite 9 KB par ScriptProperty

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
  let entries = Object.entries(map);
  if (entries.length > MAX_TRACKED_FILES) {
    entries.sort((a, b) => String(b[1]).localeCompare(String(a[1])));
    entries = entries.slice(0, MAX_TRACKED_FILES);
  }
  let payload = JSON.stringify(Object.fromEntries(entries));
  while (payload.length > 8000 && entries.length > 10) {
    entries.pop();
    payload = JSON.stringify(Object.fromEntries(entries));
  }
  props.setProperty("PROCESSED_VERSIONS_JSON", payload);
}

function readManifestExcerpt_(file) {
  try {
    const mime = String(file.getMimeType() || "");
    if (mime === MimeType.GOOGLE_DOCS) {
      return DocumentApp.openById(file.getId()).getBody().getText().slice(0, 1200);
    }
    if (mime.indexOf("application/vnd.google-apps.") === 0) {
      return "";
    }
    if (
      mime.indexOf("text/") === 0 ||
      mime === "application/json" ||
      /\.(md|txt|json|yml|yaml|gs|ts|js|ps1)$/i.test(file.getName())
    ) {
      return file.getBlob().getDataAsString("UTF-8").slice(0, 1200);
    }
  } catch (err) {
    return "[Unreadable excerpt: " + err.message + "]";
  }
  return "";
}

function collectFolderFilesRecursive_(folder, labelPrefix, depth, collected) {
  const files = folder.getFiles();
  while (files.hasNext()) {
    collected.push({ file: files.next(), versionFolder: labelPrefix });
  }
  if (depth >= 4) return;
  const subfolders = folder.getFolders();
  while (subfolders.hasNext()) {
    const sub = subfolders.next();
    collectFolderFilesRecursive_(sub, labelPrefix + "/" + sub.getName(), depth + 1, collected);
  }
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
  if (webhookUrl.indexOf("https://chat.googleapis.com/") !== 0) {
    return { ok: false, status: 0, reason: "invalid_webhook_origin" };
  }
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

  const summary = { checked: 0, dispatched: [], skipped: [], warnings: [], errors: [] };

  try {
    for (let i = 0; i < DRIVE_ROOTS.length; i++) {
      const root = DRIVE_ROOTS[i];
      const entries = [];
      try {
        const rootFolder = DriveApp.getFolderById(root.id);
        collectFolderFilesRecursive_(rootFolder, root.label, 0, entries);
      } catch (folderErr) {
        summary.errors.push({ root: root.label, reason: folderErr.message });
        continue;
      }

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
        if (!ghOut.ok) {
          summary.errors.push({
            file: payload.manifest_name,
            ghStatus: ghOut.status || 0,
            reason: ghOut.reason || ghOut.body || "github_dispatch_failed",
          });
          continue;
        }

        processed[fileId] = updatedIso;
        const chatOut = notifyGoogleChatLd08_(gchatWebhook, payload);
        if (gchatWebhook && !chatOut.ok && !chatOut.skipped) {
          summary.warnings.push({ file: payload.manifest_name, chatStatus: chatOut.status || 0, reason: chatOut.reason || "chat_notify_failed" });
        }
        summary.dispatched.push({ file: payload.manifest_name, version: payload.version_folder, ghStatus: ghOut.status });
      }
    }
  } finally {
    if (!dryRun) {
      saveProcessedVersions_(props, processed);
      props.setProperty("LAST_POLL_ISO", nowIso);
    }
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
