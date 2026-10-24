import { mountSecureBackupPanel } from "./secure-backup-panel.js";
import { createWorkspaceController } from "../src/workspace-controller.js";
import { workspaceFromDraft, workspaceDraftKey, decodeWorkspace, WORKSPACE_TEXT_LIMIT } from "../src/workspace-format.js";
import { prepareWorkspaceFile, createWorkspaceFileReader, createWorkspaceBackupTracker } from "../src/workspace-file.js";
import { describeWorkspaceOverview, describeWorkspacePreview, describeWorkspaceUndo } from "../src/workspace-overview.js";
import { offerHistoryDownload } from "./history-files.js";

const ERRORS = Object.freeze({
  WORKSPACE_DUPLICATE: "複数のカードに同じ公開アドレスがあります。別々のアドレスを設定してください。",
  WORKSPACE_ADDRESS: "公開アドレスまたはトークンの契約アドレスの形式を確認してください。",
  WORKSPACE_TOKENS: "トークン一覧は重複なしの32件以内にしてください。",
  WORKSPACE_AGENT: "DAT・EMA・CAWELONと履歴の組み合わせを確認してください。",
  WORKSPACE_CHAIN: "設定のネットワークはBaseまたはBase Sepoliaを指定してください。",
  WORKSPACE_CONFLICT: "同じブロックの履歴が矛盾しています。既存履歴は変更していません。",
  WORKSPACE_CAPACITY: "追加後の履歴がカードごとの64件を超えます。必要な記録を保存して整理してください。",
  WORKSPACE_STALE: "プレビュー後に設定または履歴が変わりました。もう一度プレビューしてください。",
  WORKSPACE_REVIEW_REQUIRED: "現在の内容をプレビューして確認してください。",
  WORKSPACE_OPTIONS: "設定または履歴のどちらかを復元対象に選んでください。",
  WORKSPACE_CHECKSUM: "破損確認が一致しません。保存した元のバックアップを選んでください。",
  WORKSPACE_FILE_SCHEMA: "ThreeCoreの一括バックアップファイルを選んでください。",
  WORKSPACE_FILENAME: "拡張子が.jsonのバックアップを選んでください。",
  WORKSPACE_FILE_SIZE: "空のファイル、または大きすぎるファイルです。",
  WORKSPACE_FILE_ENCODING: "UTF-8形式のファイルを選んでください。",
  WORKSPACE_CRYPTO: "このブラウザーでは破損確認を実行できません。",
  WORKSPACE_UNDO_STALE: "一括復元の後に編集されています。直接戻すと編集が失われるため、控えを保存して確認してください。",
  WORKSPACE_NO_UNDO: "戻せる一括復元はまだありません。",
  WORKSPACE_ROLLED_BACK: "反映できなかったため、設定と履歴を操作前へ戻しました。接続は改めて確認してください。",
  WORKSPACE_RECOVERY_REQUIRED: "反映と差し戻しを完了できませんでした。操作前の控えをダウンロードして保全してください。",
});

/** One explicit local workflow for all three cards; no provider capability. */
export function mountWorkspacePanel({ document, parent, readDraft, writeDraft,
  download = offerHistoryDownload, readBytes, subtle, secureOptions = {} }) {
  const controller = createWorkspaceController({ readDraft, writeDraft,
    authorizeWrite: () => !secureStaged || securePanel.stagedReady() });
  const backup = createWorkspaceBackupTracker();
  const listeners = [];
  const section = document.createElement("section");
  section.className = "workspace-panel";
  let disposed = false;
  let preview = null;
  let undoReview = null;
  let reading = false;
  let saving = false;
  let saveGeneration = 0;
  let secureStaged = false;
  let securePanel;

  function node(tag, name, value) {
    const item = document.createElement(tag);
    item.className = name ? "workspace-" + name : "";
    if (value !== undefined) item.textContent = value;
    return item;
  }
  function listen(item, event, action) {
    const listener = () => { if (!disposed) action(); };
    item.addEventListener(event, listener);
    listeners.push(() => item.removeEventListener(event, listener));
  }
  function label(value, item) {
    const wrapper = node("label", "", value);
    wrapper.append(item);
    return wrapper;
  }
  function errorMessage(error) {
    return ERRORS[error?.code] ?? "バックアップの形式や入力を確認してください。操作は完了していません。";
  }
  function handle(action) {
    try { action(); }
    catch (error) {
      clearReview();
      status.textContent = errorMessage(error);
      controls();
    }
  }
  function button(name, value, action) {
    const item = node("button", name, value);
    item.type = "button";
    listen(item, "click", () => handle(action));
    return item;
  }
  function checkbox(name, value, checked = false) {
    const item = node("input", name);
    item.type = "checkbox";
    item.checked = checked;
    return { item, label: label(value, item) };
  }
  const heading = node("h2", "", "3ウォレットをまとめて保存・復元");
  const note = node("p", "note", "設定・トークン一覧・保存履歴を1ファイルにまとめます。公開アドレスと残高を含みます。秘密鍵・接続許可・承認先は保存しません。保存した履歴は現在の残高を証明しません。");
  const status = node("p", "status", "必要な履歴を追加してから一括バックアップを保存してください。");
  status.setAttribute("role", "status");
  const backupStatus = node("p", "backup-status");
  const overview = node("pre", "overview");
  const detail = node("pre", "detail");
  const undoDetail = node("pre", "undo-detail");
  const json = node("textarea", "json");
  json.rows = 4;
  json.maxLength = WORKSPACE_TEXT_LIMIT;
  json.spellcheck = false;
  json.setAttribute("aria-label", "一括復元のJSON");
  const file = node("input", "file");
  file.type = "file";
  file.accept = ".json,application/json";
  file.setAttribute("aria-label", "一括バックアップファイル");
  const settings = checkbox("settings", "設定とトークン一覧を復元する", true);
  const histories = checkbox("histories", "保存履歴を復元する", true);
  const replace = checkbox("replace", "既存の履歴を置き換える（未選択なら追加）");
  const confirmed = checkbox("confirmed", "変更する設定と履歴を確認しました");
  const removal = checkbox("removal", "プレビューに表示された既存記録の削除を確認しました");
  const undoConfirmed = checkbox("undo-confirmed", "直前の一括復元を戻す内容を確認しました");
  function options() {
    return { settings: settings.item.checked, histories: histories.item.checked,
      mode: replace.item.checked ? "replace" : "merge" };
  }
  const inspect = button("inspect", "3ウォレットの保存状況を見る", () => {
    overview.textContent = describeWorkspaceOverview(readDraft());
    updateBackup();
    status.textContent = "保存してある過去の記録を表示しました。残高照会は行っていません。";
  });
  const saveSummary = button("save-summary", "保存状況をテキスト保存", () => {
    const text = describeWorkspaceOverview(readDraft());
    download({ document, prepared: { text, filename: "ThreeCore-workspace-overview.txt", mimeType: "text/plain;charset=utf-8" } });
    status.textContent = "保存状況のダウンロードを開始しました。PCで保存完了を確認してください。";
  });
  const save = button("save", "3ウォレットの平文バックアップを保存", () => { void saveFile(); });
  const previewButton = button("preview", "一括復元の変更内容を確認", () => {
    if (!stagedReady()) return;
    clearReview();
    preview = controller.preview(json.value, options());
    detail.textContent = describeWorkspacePreview(preview);
    status.textContent = "まだ変更していません。各カードの変更内容を確認してください。";
    controls();
  });
  const apply = button("apply", "確認した内容を一括復元", () => {
    if (!stagedReady()) return;
    if (!preview || !confirmed.item.checked || (preview.removed && !removal.item.checked)) return;
    const candidate = preview;
    preview = null;
    confirmed.item.checked = removal.item.checked = false;
    const result = controller.apply(candidate.id, json.value, options());
    detail.textContent = "";
    overview.textContent = describeWorkspaceOverview(readDraft());
    status.textContent = result.changed ? "一括復元しました。必要なカードで改めて接続してください。" : "設定と履歴に変更はありませんでした。";
    updateBackup();
    controls();
  });
  const cancel = button("cancel", "読み込み・プレビューを取り消す", () => {
    if (secureStaged) securePanel.protect();
    saveGeneration++;
    saving = false;
    reader.cancel();
    clearReview();
    status.textContent = "取り消しました。設定と履歴は変更していません。";
  });
  const undoPreview = button("undo-preview", "直前の一括復元を戻す内容を確認", () => {
    clearReview();
    undoReview = controller.undoPreview();
    undoDetail.textContent = describeWorkspaceUndo(undoReview);
    status.textContent = "まだ戻していません。内容を確認してください。";
    controls();
  });
  const undoApply = button("undo-apply", "確認した操作前の状態へ戻す", () => {
    if (!undoReview || !undoConfirmed.item.checked) return;
    const id = undoReview.id;
    undoReview = null;
    undoConfirmed.item.checked = false;
    controller.undoApply(id);
    undoDetail.textContent = "";
    overview.textContent = describeWorkspaceOverview(readDraft());
    status.textContent = "一括復元前の設定と履歴へ戻しました。接続許可は復元していません。";
    updateBackup();
    controls();
  });
  const saveRecovery = button("recovery", "操作前の控えを保存", () => {
    const text = controller.recoveryText();
    download({ document, prepared: { text, filename: "ThreeCore-local-recovery-draft.json", mimeType: "application/json;charset=utf-8" } });
    status.textContent = "操作前の控えを保存します。これは確認・復旧作業用で、一括バックアップとは異なる形式です。";
  });
  const reader = createWorkspaceFileReader({ readBytes, subtle, onChange(state) {
    if (disposed) return;
    reading = state.phase === "reading";
    if (reading) {
      clearReview();
      status.textContent = "ファイルと破損確認を読み込んでいます。まだ変更していません。";
    } else if (state.phase === "ready") {
      secureStaged = false;
      clearReview();
      json.value = state.result.text;
      status.textContent = "ファイルの破損確認が一致しました。本人・所有・安全性の確認ではありません。変更内容をプレビューしてください。";
    } else if (state.phase === "error") {
      status.textContent = errorMessage({ code: state.errorCode });
    }
    controls();
  } });
  function clearReview() {
    controller.cancel();
    preview = undoReview = null;
    confirmed.item.checked = removal.item.checked = undoConfirmed.item.checked = false;
    detail.textContent = undoDetail.textContent = "";
    controls();
  }
  function updateBackup() {
    let phase = "changed";
    try { phase = backup.status(workspaceFromDraft(readDraft())).phase; } catch { /* Unfinished fields cannot be saved. */ }
    backupStatus.textContent = phase === "not-offered" ? "この画面からの一括バックアップ保存はまだ開始していません。"
      : phase === "current-offered" ? "現在の内容でダウンロードを開始済みです。PCへの保存完了を確認してください。"
        : "前回の保存開始時から内容が変わったか、入力に確認が必要です。必要な内容を再保存してください。";
  }
  function controls() {
    const state = controller.state();
    const busy = reading || saving;
    section.setAttribute("aria-busy", String(busy));
    file.disabled = save.disabled = busy;
    previewButton.disabled = busy || state.recoveryRequired;
    apply.disabled = busy || !preview || !confirmed.item.checked || (!!preview?.removed && !removal.item.checked) || state.recoveryRequired;
    confirmed.item.disabled = !preview || busy;
    removal.item.disabled = !preview?.removed || busy;
    undoPreview.disabled = busy || !state.undoAvailable;
    undoApply.disabled = busy || !undoReview || !undoConfirmed.item.checked;
    undoConfirmed.item.disabled = busy || !undoReview;
    saveRecovery.disabled = !state.hasUndo && !state.recoveryRequired;
  }
  async function saveFile() {
    if (saving || disposed) return;
    const id = ++saveGeneration;
    saving = true;
    controls();
    try {
      const draft = readDraft();
      const key = workspaceDraftKey(draft);
      const workspace = workspaceFromDraft(draft);
      const prepared = await prepareWorkspaceFile(workspace, { subtle });
      if (disposed || id !== saveGeneration) return;
      if (workspaceDraftKey(readDraft()) !== key) {
        status.textContent = "保存準備中に内容が変わりました。現在の内容で保存をやり直してください。";
        return;
      }
      download({ document, prepared });
      backup.offered(workspace);
      status.textContent = "一括バックアップのダウンロードを開始しました。PCへの保存完了を確認してください。";
    } catch (error) {
      if (!disposed && id === saveGeneration) status.textContent = errorMessage(error);
    } finally {
      if (!disposed && id === saveGeneration) {
        saving = false;
        updateBackup();
        controls();
      }
    }
  }
  for (const item of [settings.item, histories.item, replace.item]) listen(item, "change", clearReview);
  for (const item of [confirmed.item, removal.item, undoConfirmed.item]) listen(item, "change", controls);
  listen(json, "input", () => { reader.cancel(); clearReview(); });
  listen(file, "change", () => {
    const files = file.files;
    if (!files?.length) return;
    clearReview();
    if (files.length !== 1) {
      reader.cancel();
      status.textContent = "一括バックアップは1ファイルずつ選んでください。";
    } else void reader.load(files[0]);
    file.value = "";
  });
  const secureHost = node("div", "secure-host");
  section.append(heading, note, inspect, saveSummary, overview, save, backupStatus, secureHost,
    label("保存した一括バックアップを選択", file), label("読み込み用JSON（ファイル選択で入力されます）", json),
    settings.label, histories.label, replace.label, previewButton, detail,
    confirmed.label, removal.label, apply, cancel, undoPreview, undoDetail,
    undoConfirmed.label, undoApply, saveRecovery, status);
  parent.append(section);
  function clearSecureStage() {
    if (!secureStaged) return;
    secureStaged = false;
    json.value = "";
    clearReview();
  }
  function stagedReady() {
    if (!secureStaged) return true;
    if (securePanel.stagedReady()) return true;
    clearSecureStage();
    status.textContent = "保護の期限が過ぎたため復元待ちの内容を消去しました。暗号化ファイルを開き直してください。";
    return false;
  }
  function stageText(text) {
    if (disposed) return false;
    decodeWorkspace(text);
    secureStaged = false;
    saveGeneration++;
    saving = false;
    reader.cancel();
    clearReview();
    json.value = text;
    status.textContent = "入力しました。変更内容をプレビューしてから復元してください。";
    controls();
    return true;
  }
  securePanel = mountSecureBackupPanel({ ...secureOptions, document, parent: secureHost, readDraft, download,
    onStage(text) { const result = stageText(text); secureStaged = result; return result; },
    onProtect: clearSecureStage });
  updateBackup();
  controls();
  return Object.freeze({
    stageText,
    protect() { securePanel.protect(); },
    invalidate() {
      if (disposed) return;
      securePanel.invalidate();
      saveGeneration++;
      saving = false;
      reader.cancel();
      clearReview();
      overview.textContent = "";
      updateBackup();
    },
    dispose() {
      if (disposed) return;
      securePanel.dispose();
      disposed = true;
      saveGeneration++;
      reader.dispose();
      controller.dispose();
      backup.clear();
      for (const stop of listeners) stop();
      section.remove();
    },
  });
}
