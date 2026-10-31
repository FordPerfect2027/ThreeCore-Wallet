import { mountSecureBackupPanel } from "./secure-backup-panel.js";
import { createWorkspaceController } from "../src/workspace-controller.js";
import { workspaceFromDraft, workspaceDraftKey, decodeWorkspace, WORKSPACE_TEXT_LIMIT } from "../src/workspace-format.js";
import { prepareWorkspaceFile, createWorkspaceFileReader, createWorkspaceBackupTracker } from "../src/workspace-file.js";
import { describeWorkspaceOverview, describeWorkspacePreview, describeWorkspaceUndo } from "../src/workspace-overview.js";
import { offerHistoryDownload } from "./history-files.js";
import { observeCallbackResult } from "../src/security-callback.js";
import { readOwnErrorCode } from "../src/provider-error.js";

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
  WORKSPACE_DOWNLOAD: "ダウンロードを開始できませんでした。操作前の控えと保存履歴は保持しています。もう一度保存を試してください。",
});

/** One explicit local workflow for all three cards; no provider capability. */
export function mountWorkspacePanel({ document, parent, readDraft, writeDraft, prepareWrite,
  download = offerHistoryDownload, readBytes, subtle, secureOptions = {} }) {
  const controller = createWorkspaceController({ readDraft, writeDraft, prepareWrite,
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
  let saveAbort = null;
  let inspectingBackup = false;
  let writeAttempt = null;
  let secureStaged = false;
  let secureStaging = false;
  let securePanel;
  const current = id => !disposed && id === saveGeneration;
  function retireSave() {
    const id = ++saveGeneration;
    const previous = saveAbort;
    saveAbort = null;
    saving = false;
    previous?.abort();
    return id;
  }

  function readCurrentDraft() {
    const result = readDraft();
    if (observeCallbackResult(result) !== "synchronous") throw { code: "WORKSPACE_ADAPTER" };
    return result;
  }
  function deliver(prepared, id) {
    const receipt = download({ document, prepared });
    const kind = observeCallbackResult(receipt);
    if (!current(id)) return false;
    if (kind !== "synchronous" || receipt === false) throw { code: "WORKSPACE_DOWNLOAD" };
    return true;
  }

  function node(tag, name, value) {
    const item = document.createElement(tag);
    item.className = name ? "workspace-" + name : "";
    if (value !== undefined) item.textContent = value;
    return item;
  }
  function listen(item, event, action) {
    const listener = () => { if (!disposed) return action(); };
    item.addEventListener(event, listener);
    listeners.push(() => item.removeEventListener(event, listener));
  }
  function label(value, item) {
    const wrapper = node("label", "", value);
    wrapper.append(item);
    return wrapper;
  }
  function errorMessage(error) {
    const code = readOwnErrorCode(error);
    return typeof code === "string" && Object.hasOwn(ERRORS, code) ? ERRORS[code]
      : "バックアップの形式や入力を確認してください。操作は完了していません。";
  }
  function handle(action) {
    const id = saveGeneration;
    try { return action(); }
    catch (error) {
      if (!current(id)) return;
      const message = errorMessage(error);
      if (!current(id)) return;
      clearReview();
      if (!current(id)) return;
      status.textContent = message;
      controls();
    }
  }
  function mutate(action) {
    const attempt = { cancelledAt: null };
    writeAttempt = attempt;
    try { return action(); }
    catch (error) {
      // Cancellation retires exports immediately, but a synchronous restore
      // must finish rollback before its final guidance and controls are known.
      const id = saveGeneration;
      if (!current(id)) throw error;
      const state = controller.state();
      if (!current(id)) throw error;
      if (state.recoveryRequired || (attempt.cancelledAt === id && !state.pending && !reading && !saving)) {
        const message = state.recoveryRequired ? ERRORS.WORKSPACE_RECOVERY_REQUIRED : errorMessage(error);
        if (!current(id)) throw error;
        clearReview();
        if (!current(id)) throw error;
        status.textContent = message;
        controls();
      }
      throw error;
    } finally { if (writeAttempt === attempt) writeAttempt = null; }
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
    const id = saveGeneration;
    const text = describeWorkspaceOverview(readCurrentDraft());
    if (!current(id)) return;
    overview.textContent = text;
    updateBackup();
    if (!current(id)) return;
    status.textContent = "保存してある過去の記録を表示しました。残高照会は行っていません。";
  });
  const saveSummary = button("save-summary", "保存状況をテキスト保存", () => {
    const id = saveGeneration;
    const text = describeWorkspaceOverview(readCurrentDraft());
    if (!current(id)) return;
    if (!deliver({ text, filename: "ThreeCore-workspace-overview.txt", mimeType: "text/plain;charset=utf-8" }, id)) return;
    status.textContent = "保存状況のダウンロードを開始しました。PCで保存完了を確認してください。";
  });
  const save = button("save", "3ウォレットの平文バックアップを保存", saveFile);
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
    const result = mutate(() => controller.apply(candidate.id, json.value, options()));
    detail.textContent = "";
    overview.textContent = describeWorkspaceOverview(readCurrentDraft());
    status.textContent = result.changed ? "一括復元しました。必要なカードで改めて接続してください。" : "設定と履歴に変更はありませんでした。";
    updateBackup();
    controls();
  });
  const cancel = button("cancel", "読み込み・プレビューを取り消す", () => {
    const id = retireSave();
    if (!current(id)) return;
    if (secureStaged || secureStaging) securePanel.protect();
    if (!current(id)) return;
    reader.cancel();
    if (!current(id)) return;
    clearReview();
    if (!current(id)) return;
    if (writeAttempt) {
      writeAttempt.cancelledAt = id;
      status.textContent = "取り消しを受け付けました。復元処理の結果を確認しています。";
    } else status.textContent = "取り消しました。設定と履歴は変更していません。";
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
    mutate(() => controller.undoApply(id));
    undoDetail.textContent = "";
    overview.textContent = describeWorkspaceOverview(readCurrentDraft());
    status.textContent = "一括復元前の設定と履歴へ戻しました。接続許可は復元していません。";
    updateBackup();
    controls();
  });
  const saveRecovery = button("recovery", "操作前の控えを保存", () => {
    const id = saveGeneration;
    const text = controller.recoveryText();
    if (!deliver({ text, filename: "ThreeCore-local-recovery-draft.json", mimeType: "application/json;charset=utf-8" }, id)) return;
    status.textContent = "操作前の控えを保存します。これは確認・復旧作業用で、一括バックアップとは異なる形式です。";
  });
  const reader = createWorkspaceFileReader({ readBytes, subtle, onChange(state) {
    if (disposed) return;
    const id = saveGeneration;
    reading = state.phase === "reading";
    if (reading) {
      clearReview();
      if (!current(id) || state !== reader.state()) return;
      status.textContent = "ファイルと破損確認を読み込んでいます。まだ変更していません。";
    } else if (state.phase === "ready") {
      secureStaged = false;
      clearReview();
      if (!current(id) || state !== reader.state()) return;
      json.value = state.result.text;
      status.textContent = "ファイルの破損確認が一致しました。本人・所有・安全性の確認ではありません。変更内容をプレビューしてください。";
    } else if (state.phase === "error") {
      status.textContent = errorMessage({ code: state.errorCode });
    }
    controls();
  } });
  function clearReview() {
    if (writeAttempt) writeAttempt.cancelledAt = null;
    controller.cancel();
    preview = undoReview = null;
    confirmed.item.checked = removal.item.checked = undoConfirmed.item.checked = false;
    detail.textContent = undoDetail.textContent = "";
    controls();
  }
  function updateBackup() {
    if (disposed || inspectingBackup) return;
    const id = saveGeneration;
    inspectingBackup = true;
    let phase = "changed";
    try { phase = backup.status(workspaceFromDraft(readCurrentDraft())).phase; } catch { /* Unfinished fields cannot be saved. */ }
    finally { inspectingBackup = false; }
    if (!current(id)) return;
    backupStatus.textContent = phase === "not-offered" ? "この画面からの一括バックアップ保存はまだ開始していません。"
      : phase === "current-offered" ? "現在の内容でダウンロードを開始済みです。PCへの保存完了を確認してください。"
        : "前回の保存開始時から内容が変わったか、入力に確認が必要です。必要な内容を再保存してください。";
  }
  function controls() {
    if (disposed) return;
    const id = saveGeneration;
    const state = controller.state();
    if (!current(id)) return;
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
    const own = new AbortController();
    saveAbort = own;
    saving = true;
    try {
      controls();
      if (!current(id)) return;
      const draft = readCurrentDraft();
      if (!current(id)) return;
      const key = workspaceDraftKey(draft);
      const workspace = workspaceFromDraft(draft);
      if (!current(id)) return;
      const prepared = await prepareWorkspaceFile(workspace, { subtle, signal: own.signal });
      if (!current(id)) return;
      // Reading the destination can run application callbacks, including stop.
      // Identical data is not permission to resume an interrupted export.
      const latest = readCurrentDraft();
      if (!current(id)) return;
      if (workspaceDraftKey(latest) !== key) {
        status.textContent = "保存準備中に内容が変わりました。現在の内容で保存をやり直してください。";
        return;
      }
      if (!deliver(prepared, id)) return;
      backup.offered(workspace);
      status.textContent = "一括バックアップのダウンロードを開始しました。PCへの保存完了を確認してください。";
    } catch (error) {
      if (!current(id)) return;
      const message = errorMessage(error);
      if (current(id)) status.textContent = message;
    } finally {
      if (saveAbort === own) saveAbort = null;
      if (current(id)) {
        saving = false;
        updateBackup();
        if (current(id)) controls();
      }
    }
  }
  for (const item of [settings.item, histories.item, replace.item]) listen(item, "change", clearReview);
  for (const item of [confirmed.item, removal.item, undoConfirmed.item]) listen(item, "change", controls);
  listen(json, "input", () => {
    const id = retireSave();
    if (!current(id)) return;
    reading = false;
    clearReview();
    if (!current(id)) return;
    reader.cancel();
  });
  listen(file, "change", () => {
    const files = file.files;
    if (!files?.length) return;
    const id = retireSave();
    if (!current(id)) return;
    reading = false;
    clearReview();
    if (!current(id)) return;
    reader.cancel();
    if (!current(id)) return;
    file.value = "";
    if (files.length !== 1) {
      status.textContent = "一括バックアップは1ファイルずつ選んでください。";
    } else void reader.load(files[0]);
  });
  const secureHost = node("div", "secure-host");
  section.append(heading, note, inspect, saveSummary, overview, save, backupStatus, secureHost,
    label("保存した一括バックアップを選択", file), label("読み込み用JSON（ファイル選択で入力されます）", json),
    settings.label, histories.label, replace.label, previewButton, detail,
    confirmed.label, removal.label, apply, cancel, undoPreview, undoDetail,
    undoConfirmed.label, undoApply, saveRecovery, status);
  parent.append(section);
  function clearSecureStage() {
    if (!secureStaged && !secureStaging) return;
    // Protection can arrive while decrypted text is still being handed over.
    // Revoke that handoff before clearing, so its callback cannot refill JSON.
    if (secureStaging && !current(retireSave())) return;
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
    const id = retireSave();
    if (!current(id)) return false;
    reader.cancel();
    if (!current(id)) return false;
    clearReview();
    if (!current(id)) return false;
    json.value = text;
    status.textContent = "入力しました。変更内容をプレビューしてから復元してください。";
    controls();
    return current(id);
  }
  securePanel = mountSecureBackupPanel({ ...secureOptions, document, parent: secureHost, readDraft, download,
    onStage(text) {
      secureStaging = true;
      try { const result = stageText(text); secureStaged = result; return result; }
      finally { secureStaging = false; }
    },
    onProtect: clearSecureStage });
  updateBackup();
  controls();
  return Object.freeze({
    stageText,
    protect() { securePanel.protect(); },
    invalidate() {
      if (disposed) return;
      const id = retireSave();
      if (!current(id)) return;
      securePanel.invalidate();
      if (!current(id)) return;
      reader.cancel();
      if (!current(id)) return;
      clearReview();
      if (!current(id)) return;
      overview.textContent = "";
      updateBackup();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      retireSave();
      securePanel.dispose();
      reader.dispose();
      controller.dispose();
      backup.clear();
      for (const stop of listeners) stop();
      section.remove();
    },
  });
}
