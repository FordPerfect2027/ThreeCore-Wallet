import { createCheckpointController } from "../src/checkpoint-controller.js";
import { createCheckpointStorage } from "../src/checkpoint-storage.js";
import { CHECKPOINT_LIMIT } from "../src/checkpoint-model.js";
import { offerHistoryDownload } from "./history-files.js";
import { createCheckpointCollectionReader } from "../src/checkpoint-transfer.js";

const ERRORS = Object.freeze({
  CHECKPOINT_CONFLICT: "同じIDで内容の異なる控えがあります。既存の控えは変更していません。",
  CHECKPOINT_TRANSFER_CHECKSUM: "控え一覧ファイルの破損確認が一致しません。",
  CHECKPOINT_IMPORT_REVIEW: "控え一覧ファイルを選び直し、追加内容を確認してください。",
  CHECKPOINT_UNAVAILABLE: "このブラウザーでは控えの保存領域を利用できません。ファイル保存を利用してください。",
  CHECKPOINT_QUOTA: "ブラウザーの保存容量が不足しています。既存の控えは自動で消しません。ファイル保存を利用してください。",
  CHECKPOINT_BLOCKED: "ほかのページが保存領域を使用しています。ほかの同じ画面を閉じてから再読み込みしてください。",
  CHECKPOINT_TIMEOUT: "保存領域を開けませんでした。ファイル保存を利用するか、後でもう一度一覧を読み込んでください。",
  CHECKPOINT_VERSION: "この画面より新しい形式の保存領域があります。ページを更新してください。",
  CHECKPOINT_STALE: "別の画面で控えが更新されました。一覧を読み直してから操作してください。",
  CHECKPOINT_CAPACITY: "控えは保管中を含めて5件、合計24MiBまでです。自動では上書き・削除しません。",
  CHECKPOINT_LABEL: "控えの名前を1〜60文字で入力してください。改行や制御文字は使えません。",
  CHECKPOINT_SELECTION: "操作する控えを選んでください。",
  CHECKPOINT_REFRESH_REQUIRED: "先に保存済みの控え一覧を読み込んでください。",
  CHECKPOINT_INSPECTION_REQUIRED: "先に控えの内容を確認してください。保管中の控えは一覧へ戻してから利用できます。",
  CHECKPOINT_CONFIRMATION: "保管中の控えを選び、完全削除の確認を行ってください。",
  CHECKPOINT_DRAFT_CHANGED: "保存準備中に画面の設定や履歴が変わりました。現在の内容で保存をやり直してください。",
  CHECKPOINT_CANCELLED: "保存処理を中断しました。必要なら一覧を読み直してください。",
  CHECKPOINT_ABORTED: "保存処理が完了しませんでした。既存の控えはそのまま残ります。",
  CHECKPOINT_SHAPE: "保存領域の形式を確認できません。既存データを上書きせず停止しました。",
  CHECKPOINT_SCHEMA: "保存領域の形式を確認できません。ファイルバックアップを利用してください。",
  WORKSPACE_CHECKSUM: "控えの破損確認が一致しません。元のファイルバックアップを利用してください。",
});
const MESSAGES = Object.freeze({
  refresh: "保存済みの控えを読み込みました。画面の設定・履歴は変更していません。",
  save: "このブラウザーに控えを保存しました。重要な内容はファイルにも保存してください。",
  inspect: "控えの内容と破損確認を表示しました。画面への復元はまだ行っていません。",
  stage: "一括復元の入力欄に控えを入れました。下の変更内容確認から進めてください。",
  rename: "控えの名前を更新しました。",
  archive: "控えを保管中に移しました。保管中の一覧から戻せます。",
  unarchive: "控えを使用中の一覧へ戻しました。",
  purge: "選んだ保管中の控えを完全削除しました。",
  export: "控えのファイルダウンロードを開始しました。PCへの保存完了を確認してください。",
  exportCollection: "控え一覧のダウンロードを開始しました。PCへの保存完了を確認してください。",
  importReview: "控え一覧への追加予定を表示しました。まだ保存していません。",
  importApply: "控え一覧へ追加しました。ウォレット画面の設定・履歴は変更していません。",
});

/** This panel stores public observation data only after an explicit save click. */
export function mountCheckpointPanel({ document, parent, readDraft, onStage,
  storage = createCheckpointStorage(), download = offerHistoryDownload,
  now, createId, subtle, readBytes } = {}) {
  const section = document.createElement("section");
  section.className = "checkpoint-panel";
  const listeners = [];
  let controller;
  let disposed = false;
  let renderedRevision;
  let reading = false;
  let importText = "";
  let readSequence = 0;
  const reader = createCheckpointCollectionReader({ readBytes });
  function element(tag, name, text) {
    const node = document.createElement(tag);
    node.className = name ? "checkpoint-" + name : "";
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function listen(node, event, action) {
    const listener = () => {
      if (disposed) return;
      try { action(); }
      catch { status.textContent = "入力と選択内容を確認してください。操作は完了していません。"; }
    };
    node.addEventListener(event, listener);
    listeners.push(() => node.removeEventListener(event, listener));
  }
  function button(name, text, action) {
    const node = element("button", name, text);
    node.type = "button";
    listen(node, "click", action);
    return node;
  }
  function label(text, node) {
    const wrapper = element("label", "", text);
    wrapper.append(node);
    return wrapper;
  }
  const heading = element("h2", "", "このブラウザーに控えを保存");
  const note = element("p", "note",
    "DAT・EMA・CAWELONの公開アドレス、設定、保存履歴をまとめて残せます。自動保存はしません。" +
    "このブラウザーの同じURLで利用できます。別のブラウザーやポート番号には引き継がれません。");
  const privacy = element("p", "privacy",
    "公開アドレスと残高を暗号化せずブラウザー内に保存します。秘密鍵や接続許可は含みません。" +
    "ブラウザーデータの削除・プライベートモード・容量整理で失われる場合があるため、ファイルも保存してください。");
  const status = element("p", "status", "「保存済みの控え一覧を読み込む」から始めてください。");
  status.setAttribute("role", "status");
  const count = element("p", "count", "保存領域はまだ開いていません。");
  const name = element("input", "name");
  name.type = "text";
  name.maxLength = 60;
  name.autocomplete = "off";
  name.setAttribute("aria-label", "新しい控えの名前");
  const rename = element("input", "rename");
  rename.type = "text";
  rename.maxLength = 60;
  rename.setAttribute("aria-label", "選んだ控えの新しい名前");
  const filter = element("input", "archived");
  filter.type = "checkbox";
  const select = element("select", "select");
  select.setAttribute("aria-label", "保存済みの控え");
  const confirmed = element("input", "confirmed");
  confirmed.type = "checkbox";
  const detail = element("pre", "detail");
  const refresh = button("refresh", "保存済みの控え一覧を読み込む", () => { void controller.refresh(); });
  const save = button("save", "現在の3ウォレットを新しい控えとして保存", () => { void controller.save(name.value); });
  const inspect = button("inspect", "選んだ控えの内容を確認", () => { void controller.inspect(); });
  const stage = button("stage", "確認した控えを一括復元の入力欄へ", () => { void controller.stage(); });
  const exportFile = button("export", "選んだ控えをファイル保存", () => { void controller.exportFile(); });
  const renameButton = button("rename-button", "控えの名前を変更", () => { void controller.rename(rename.value); });
  const archive = button("archive", "選んだ控えを保管中へ移す", () => { void controller.archive(); });
  const unarchive = button("unarchive", "保管中の控えを一覧へ戻す", () => { void controller.unarchive(); });
  const purge = button("purge", "選んだ保管中の控えを完全削除", () => {
    if (!confirmed.checked) return;
    confirmed.checked = false;
    void controller.purge(true);
  });
  const transferHeading = element("h3", "", "控え一覧を別のブラウザーへ持ち出す");
  const transferNote = element("p", "", "名前と保管状態を含め、すべての控えを1ファイルに保存できます。読み込みは既存の控えへの追加だけです。");
  const exportCollection = button("export-collection", "控え一覧をまとめてファイル保存", () => { void controller.exportCollection(); });
  const importFile = element("input", "import-file");
  importFile.type = "file";
  importFile.accept = ".json,application/json";
  importFile.setAttribute("aria-label", "控え一覧のバックアップファイル");
  const importConfirmed = element("input", "import-confirmed");
  importConfirmed.type = "checkbox";
  const importDetail = element("pre", "import-detail");
  const importApply = button("import-apply", "確認した控え一覧を追加", () => {
    if (!importConfirmed.checked) return;
    importConfirmed.checked = false;
    void controller.applyImport(importText);
  });
  const importCancel = button("import-cancel", "控え一覧の読み込みを取り消す", () => {
    readSequence++;
    reading = false;
    reader.cancel();
    importText = "";
    importConfirmed.checked = false;
    controller.cancelImport();
    render(controller.state());
    status.textContent = "控え一覧の読み込みを取り消しました。";
  });
  function list(state) {
    const entries = state.metadata?.entries.filter(entry => entry.archived === !!filter.checked) ?? [];
    select.replaceChildren();
    const placeholder = element("option", "", "控えを選択してください");
    placeholder.value = "";
    select.append(placeholder);
    for (const entry of entries) {
      const option = element("option", "", entry.label + " — " + entry.createdAt + "（PC時刻）");
      option.value = entry.id;
      select.append(option);
    }
    select.value = entries.some(entry => entry.id === state.selectedId) ? state.selectedId : "";
  }
  function render(state) {
    if (disposed) return;
    const selected = state.metadata?.entries.find(entry => entry.id === state.selectedId);
    const revision = state.metadata?.revision ?? null;
    if (renderedRevision !== revision) {
      confirmed.checked = false;
      renderedRevision = revision;
      if (selected) filter.checked = selected.archived;
      list(state);
    } else select.value = selected?.id ?? "";
    const locked = state.busy || reading;
    section.setAttribute("aria-busy", String(locked));
    refresh.disabled = locked;
    save.disabled = locked || !state.metadata || state.metadata.count >= CHECKPOINT_LIMIT;
    name.disabled = rename.disabled = filter.disabled = locked;
    select.disabled = locked || !state.metadata;
    inspect.disabled = exportFile.disabled = renameButton.disabled = locked || !selected;
    archive.disabled = locked || !selected || selected.archived;
    unarchive.disabled = locked || !selected?.archived;
    stage.disabled = locked || !state.canStage;
    confirmed.disabled = locked || !selected?.archived;
    purge.disabled = locked || !selected?.archived || !confirmed.checked;
    importFile.disabled = exportCollection.disabled = locked || !state.metadata;
    importConfirmed.disabled = locked || !state.canImport;
    importApply.disabled = locked || !state.canImport || !importConfirmed.checked;
    importCancel.disabled = state.busy && state.activeAction !== "importReview";
    importDetail.textContent = state.importDescription;
    detail.textContent = state.inspection;
    count.textContent = state.metadata ? "保存済み " + state.metadata.count + " / " + CHECKPOINT_LIMIT +
      "件（保管中も含む）・残り " + state.metadata.remaining + "件" : "保存領域はまだ読み込んでいません。";
    if (locked) status.textContent = "PC内の保存領域・ファイルを確認しています。";
    else if (state.errorCode) status.textContent = ERRORS[state.errorCode] ?? "操作を完了できませんでした。ファイルバックアップを保全し、一覧を読み直してください。";
    else if (state.lastAction) status.textContent = MESSAGES[state.lastAction] +
      (state.lastAction === "save" && state.currentDraftChanged ? " 保存処理の後に現在の入力が変わっています。" : "");
  }
  controller = createCheckpointController({ storage, readDraft, onStage, now, createId, subtle,
    download: prepared => download({ document, prepared }), onChange: render });
  listen(filter, "change", () => {
    confirmed.checked = false;
    controller.select(null);
    list(controller.state());
  });
  listen(select, "change", () => {
    confirmed.checked = false;
    rename.value = "";
    controller.select(select.value || null);
  });
  listen(confirmed, "change", () => render(controller.state()));
  listen(importConfirmed, "change", () => render(controller.state()));
  listen(importFile, "change", () => { void readCollection(); });
  async function readCollection() {
    const files = importFile.files;
    if (!files?.length) return;
    const token = ++readSequence;
    reader.cancel();
    controller.cancelImport();
    importConfirmed.checked = false;
    importText = "";
    reading = true;
    render(controller.state());
    try {
      if (files.length !== 1) throw Error("One file required");
      const text = await reader.read(files[0]);
      if (disposed || token !== readSequence) return;
      reading = false;
      importText = text;
      await controller.reviewImport(text);
    } catch {
      if (!disposed && token === readSequence) {
        reading = false;
        render(controller.state());
        status.textContent = "控え一覧のJSONファイルを読み込めませんでした。元の保存ファイルを確認してください。";
      }
    } finally {
      if (!disposed && token === readSequence) { reading = false; importFile.value = ""; }
    }
  }
  section.append(heading, note, privacy, refresh, count,
    label("新しい控えの名前（60文字まで）", name), save,
    label("保管中の控えを表示する", filter), label("保存済みの控え", select),
    inspect, detail, stage, exportFile, label("選んだ控えの新しい名前", rename), renameButton,
    archive, unarchive,
    label("選んだ保管中の控えを完全削除します。必要なファイルは保存済みです", confirmed),
    purge, transferHeading, transferNote, exportCollection,
    label("保存した控え一覧ファイル", importFile), importDetail,
    label("控え一覧への追加内容を確認しました", importConfirmed), importApply, importCancel, status);
  parent.append(section);
  render(controller.state());
  return Object.freeze({
    invalidateDraft() { controller.invalidateDraft(); },
    dispose() {
      if (disposed) return;
      disposed = true;
      readSequence++;
      reader.dispose();
      controller.dispose();
      for (const stop of listeners) stop();
      section.remove();
    },
  });
}
