import { createSecureBackupController } from "../src/secure-backup-controller.js";
import { offerHistoryDownload } from "./history-files.js";

export const SECURE_BACKUP_MESSAGES = Object.freeze({
  SECURE_FORMAT: "対応する暗号化バックアップではありません。形式を確認してください。",
  SECURE_SIZE: "ファイルが空か、対応する容量を超えています。",
  SECURE_BASE64: "暗号化ファイルのデータ形式が壊れています。元のファイルを選んでください。",
  SECURE_PASSPHRASE: "合言葉は12文字以上、UTF-8で1,024バイト以内にしてください。改行・制御文字は使えません。",
  SECURE_MISMATCH: "2回入力した合言葉が一致しません。もう一度入力してください。",
  SECURE_UNAVAILABLE: "この環境で暗号化を利用できません。対応するローカル画面またはHTTPSで開いてください。",
  SECURE_AUTH: "合言葉が違うか、ファイルが変更・破損しています。復元は行っていません。",
  SECURE_CONTENT: "バックアップの内容を確認できませんでした。設定と履歴は変更していません。",
  SECURE_BUSY: "前の暗号処理が終了するまで少し待ち、もう一度操作してください。",
  SECURE_CANCELLED: "取り消しました。設定と履歴は変更していません。",
  SECURE_TIMEOUT: "時間内に暗号処理を完了できませんでした。少し待ってからやり直してください。",
  SECURE_STALE: "処理中に設定または履歴が変わりました。現在の内容で最初から確認してください。",
  SECURE_NOT_READY: "先にファイルの準備または読み込みを行ってください。",
  SECURE_STAGE: "復元用の入力欄へ渡せませんでした。設定と履歴は変更していません。",
  SECURE_DOWNLOAD: "ダウンロードを開始できませんでした。暗号化からやり直してください。",
  SECURE_READ: "ファイルを読み込めませんでした。元のファイルを選び直してください。",
  SECURE_DISPOSED: "画面を閉じたため処理を終了しました。",
  SECURE_INTERNAL: "処理を完了できませんでした。最初からやり直してください。",
});

/** Passwords only exist in input fields and the in-flight crypto call. */
export function mountSecureBackupPanel({ document, parent, readDraft, onStage,
  onProtect = () => {}, download = offerHistoryDownload,
  controllerOptions = {}, eventTarget = document.defaultView,
  plaintextLifetimeMs = 120_000,
} = {}) {
  if (!Number.isSafeInteger(plaintextLifetimeMs) || plaintextLifetimeMs < 1 || plaintextLifetimeMs > 120_000) {
    throw new Error("SECURE_INTERNAL");
  }
  let disposed = false;
  let expiryTimer = null;
  const cleanup = [];
  const section = document.createElement("section");
  section.className = "secure-backup-panel";
  section.setAttribute("aria-label", "合言葉付きバックアップ");
  function node(tag, name, text) {
    const item = document.createElement(tag);
    item.className = "secure-backup-" + name;
    if (text !== undefined) item.textContent = text;
    return item;
  }
  function listen(target, event, handler) {
    if (typeof target?.addEventListener !== "function") return;
    const action = () => { if (!disposed) handler(); };
    target.addEventListener(event, action);
    cleanup.push(() => target.removeEventListener(event, action));
  }
  function labelled(text, item) {
    const label = node("label", "label", text);
    label.append(item);
    return label;
  }
  function password(name, autocomplete) {
    const item = node("input", name);
    item.type = "password";
    item.autocomplete = autocomplete;
    item.maxLength = 1024;
    item.spellcheck = false;
    item.setAttribute("autocapitalize", "none");
    item.setAttribute("data-lpignore", "true");
    return item;
  }
  function button(name, text, handler) {
    const item = node("button", name, text);
    item.type = "button";
    listen(item, "click", handler);
    return item;
  }
  const title = node("h3", "heading", "合言葉付きでバックアップを守る");
  const note = node("p", "note", "DAT・EMA・CAWELONの設定・トークン一覧・保存残高履歴を暗号化します。合言葉を忘れると開けません。ウォレットの秘密鍵やシードフレーズは入力しないでください。");
  const scope = node("p", "scope", "このファイルに期間レポート・承認額・送金記録の別コレクションは含みません。既存の平文ファイルやブラウザー内の保存データは別に管理してください。");
  const first = password("password", "new-password");
  const second = password("confirmation", "new-password");
  const restorePassword = password("restore-password", "off");
  const acknowledged = node("input", "acknowledged");
  acknowledged.type = "checkbox";
  acknowledged.checked = false;
  const file = node("input", "file");
  file.type = "file";
  file.accept = ".json,application/json";
  const status = node("p", "status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const detail = node("p", "detail");
  let lastPhase = "idle";
  function clearPasswords() {
    first.value = second.value = restorePassword.value = "";
  }
  function protect() {
    if (disposed) return;
    clearTimeout(expiryTimer);
    expiryTimer = null;
    clearPasswords();
    file.value = "";
    acknowledged.checked = false;
    controller.cancel();
    onProtect();
  }
  function armExpiry() {
    clearTimeout(expiryTimer);
    expiryTimer = setTimeout(() => {
      protect();
      if (!disposed) status.textContent = "一定時間が経過したため、合言葉と復元待ちの内容を消去しました。必要ならファイルを開き直してください。";
    }, plaintextLifetimeMs);
  }
  const seal = button("encrypt", "暗号化ファイルを準備", () => {
    if (!acknowledged.checked) return;
    const passphrase = first.value;
    const confirmation = second.value;
    clearPasswords();
    acknowledged.checked = false;
    onProtect();
    void controller.seal(passphrase, confirmation);
  });
  const save = button("download", "暗号化ファイルをダウンロード", () => {
    controller.offer(prepared => download({ document, prepared }));
  });
  const unlock = button("decrypt", "合言葉でファイルを開く", () => {
    const passphrase = restorePassword.value;
    clearPasswords();
    void controller.unlock(passphrase);
  });
  const stage = button("stage", "復元用の入力欄へ渡す", () => { controller.stage(); });
  const cancel = button("cancel", "合言葉・読み込み内容を消去", protect);
  function render(state) {
    if (disposed) return;
    const busy = ["encrypting", "reading", "decrypting"].includes(state.phase);
    section.setAttribute("aria-busy", String(busy));
    first.disabled = second.disabled = acknowledged.disabled = busy;
    file.disabled = busy;
    seal.disabled = busy || !acknowledged.checked;
    save.disabled = !state.canDownload;
    unlock.disabled = !state.canDecrypt;
    restorePassword.disabled = !state.canDecrypt;
    stage.disabled = !state.canStage;
    if (state.phase !== lastPhase && ["error", "cancelled", "staged", "disposed"].includes(state.phase)) {
      clearPasswords();
    }
    if (state.phase !== lastPhase) {
      clearTimeout(expiryTimer);
      expiryTimer = null;
      if (["decrypted", "staged"].includes(state.phase)) armExpiry();
    }
    lastPhase = state.phase;
    detail.textContent = state.summary
      ? "3ウォレットの保存データを開きました。復元用の入力欄へ渡し、変更内容をプレビューしてから確認操作を行ってください。"
      : "";
    const messages = {
      idle: "合言葉はこの画面の処理だけに使用します。長く推測しにくいものを選び、安全な場所で管理してください。",
      encrypting: "PC内で暗号化しています。合言葉の入力欄は消去済みです。",
      encrypted: state.downloadOffered
        ? "ダウンロードを開始しました。PCへの保存完了はダウンロード一覧で確認してください。"
        : "暗号化ファイルを準備しました。ダウンロードボタンから保存してください。",
      reading: "暗号化ファイルの形式を確認しています。",
      selected: "形式を確認しました。保存時の合言葉を入力してください。内容の検証はまだ完了していません。",
      decrypting: "PC内でファイルを開いています。設定と履歴は変更していません。",
      decrypted: "暗号化と内容の検証が完了しました。まだ復元していません。",
      staged: "復元用の入力欄へ渡しました。下の「一括復元の変更内容を確認」へ進んでください。",
      staging: "復元用の入力欄へ渡しています。",
      cancelled: "読み込み内容と合言葉の入力欄を消去しました。設定と履歴は変更していません。",
      disposed: "画面を閉じました。",
    };
    status.textContent = state.errorCode
      ? SECURE_BACKUP_MESSAGES[state.errorCode] ?? SECURE_BACKUP_MESSAGES.SECURE_INTERNAL
      : messages[state.phase] ?? SECURE_BACKUP_MESSAGES.SECURE_INTERNAL;
  }
  const controller = createSecureBackupController({ ...controllerOptions,
    readDraft, onStage, onChange: render });
  listen(acknowledged, "change", () => render(controller.state()));
  for (const item of [first, second, restorePassword]) listen(item, "input", armExpiry);
  listen(file, "change", () => {
    const files = file.files;
    clearPasswords();
    acknowledged.checked = false;
    onProtect();
    if (files?.length === 1) void controller.select(files[0]);
    else {
      controller.cancel();
      status.textContent = "暗号化バックアップは1ファイルずつ選択してください。";
    }
    file.value = "";
  });
  listen(document, "visibilitychange", () => { if (document.hidden) protect(); });
  listen(eventTarget, "pagehide", protect);
  section.append(title, note, scope,
    labelled("保存用の合言葉（12文字以上）", first),
    labelled("同じ合言葉をもう一度", second),
    labelled("合言葉を別の安全な場所で管理し、忘れると復元できないことを理解しました", acknowledged),
    seal, save, labelled("保存済みの暗号化ファイル", file),
    labelled("保存時の合言葉", restorePassword), unlock, detail, stage, cancel, status);
  parent.append(section);
  render(controller.state());
  return Object.freeze({
    state: controller.state,
    protect,
    invalidate() {
      if (disposed) return;
      clearTimeout(expiryTimer);
      expiryTimer = null;
      clearPasswords();
      acknowledged.checked = false;
      controller.invalidate();
      onProtect();
    },
    dispose() {
      if (disposed) return;
      protect();
      disposed = true;
      controller.dispose();
      for (const stop of cleanup) stop();
      section.remove();
    },
  });
}
