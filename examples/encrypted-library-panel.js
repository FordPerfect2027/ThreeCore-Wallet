import { createEncryptedLibraryController } from "../src/encrypted-library-controller.js";
import { offerHistoryDownload } from "./history-files.js";

export const LIBRARY_MESSAGES = Object.freeze({
  LIBRARY_FORMAT: "対応する暗号化データではありません。元のファイルを保全してください。",
  LIBRARY_CAPACITY: "保管上限（10件・合計24MiB）を超えます。必要なファイルを別に保存してから整理してください。",
  LIBRARY_CONFLICT: "別の画面で保管内容が変わりました。一覧を読み直して、確認をやり直してください。",
  LIBRARY_SELECTION: "一覧から保管したバックアップを1件選んでください。",
  LIBRARY_CRYPTO: "この環境で暗号化ファイルの破損確認を利用できません。",
  LIBRARY_INTEGRITY: "保管した暗号化ファイルの破損確認が一致しません。別に保存したファイルを確認してください。",
  LIBRARY_UNAVAILABLE: "このブラウザーで保管領域を利用できません。ファイルのダウンロードをご利用ください。",
  LIBRARY_QUOTA: "ブラウザーの保存容量が不足しています。保存できていません。",
  LIBRARY_BLOCKED: "別のタブが保管領域を使用しています。対象タブを閉じて、一覧を読み直してください。",
  LIBRARY_TIMEOUT: "時間内に処理を確認できませんでした。保存状態は一覧を読み直して確認してください。",
  LIBRARY_CLOSED: "保管領域が閉じています。画面を開き直してください。",
  LIBRARY_CANCELLED: "操作を中断しました。保存状態は一覧を読み直して確認してください。",
  LIBRARY_STORAGE: "保管領域の処理を完了できませんでした。一覧を読み直して確認してください。",
  LIBRARY_REVIEW: "確認の有効時間が切れたか、確認内容が変わりました。もう一度確認してください。",
  LIBRARY_BUSY: "処理が終わるまでお待ちください。",
  LIBRARY_CONFIRM: "表示内容を確認し、確認欄にチェックを入れてください。",
  LIBRARY_EXPORT: "ダウンロードを開始できませんでした。選択したファイルの準備からやり直してください。",
  LIBRARY_STAGE: "合言葉の入力欄へ渡せませんでした。バックアップを選び直してください。",
  LIBRARY_INTERNAL: "処理を完了できませんでした。一覧を読み直してください。",
});

/** Renders metadata only. Ciphertext is kept out of the DOM and confirmation state. */
export function mountEncryptedLibraryPanel({ document, parent, readEncrypted, onOpen,
  download = offerHistoryDownload, controllerOptions = {} } = {}) {
  const section = document.createElement("section");
  section.className = "encrypted-library-panel";
  section.setAttribute("aria-label", "暗号化バックアップのPC内保管");
  let disposed = false, ready = false, controller;
  let priorTicket = null, lastState;
  const cleanup = [];
  function node(tag, name, text, host = section) {
    const element = document.createElement(tag);
    element.className = "encrypted-library-" + name;
    if (text !== undefined) element.textContent = text;
    host.append(element);
    return element;
  }
  function listen(item, type, handler) {
    const action = () => { if (!disposed) handler(); };
    item.addEventListener(type, action);
    cleanup.push(() => item.removeEventListener(type, action));
  }
  function button(name, text, handler) {
    const element = node("button", name, text);
    element.type = "button";
    listen(element, "click", handler);
    return element;
  }
  node("h4", "heading", "暗号化バックアップをこのPCのブラウザーに保管");
  node("p", "scope", "この保管箱には暗号化済みのファイルだけを保存します。合言葉・秘密鍵は保管しません。日時とファイル容量は暗号化されない管理情報です。");
  node("p", "origin", "同じブラウザー・同じアドレスでのみ利用できます。ポート番号が違う画面では別の保管箱になります。ブラウザーのデータ消去で失われるため、必要なファイルは別にもダウンロードしてください。");
  const load = button("load", "保管一覧を読み直す", () => { void controller.load(); });
  const save = button("save", "準備した暗号化ファイルの保管を確認", () => {
    if (!ready) return;
    try { void controller.prepareSave(readEncrypted()); }
    catch { status.textContent = "現在の設定で暗号化ファイルを準備し直してください。"; }
  });
  const capacity = node("p", "capacity");
  const label = node("label", "label", "保管したバックアップ");
  const select = node("select", "select", undefined, label);
  select.size = 4;
  const open = button("open", "選択したファイルを合言葉の入力欄へ", () => { void controller.open(); });
  const prepareExport = button("prepare-export", "選択したファイルのダウンロードを準備", () => { void controller.prepareExport(); });
  const archive = button("archive", "保管箱全体の暗号化ファイルを準備", () => { void controller.prepareArchive(); });
  const exportButton = button("export", "準備した暗号化ファイルをダウンロード", () => {
    controller.offer(prepared => download({ document, prepared }));
  });
  const remove = button("remove", "選択した保管データの削除を確認", () => { void controller.prepareRemove(); });
  const importLabel = node("label", "import-label", "別に保存した保管箱ファイルを取り込む（既存データは保持）");
  const file = node("input", "file", undefined, importLabel);
  file.type = "file";
  file.accept = ".json,application/json";
  const review = node("p", "review");
  review.setAttribute("aria-live", "polite");
  const acknowledgement = node("label", "acknowledgement");
  const checkbox = node("input", "ack", undefined, acknowledgement);
  checkbox.type = "checkbox";
  node("span", "ack-text", "対象と内容を確認しました。削除の場合、必要なファイルを別の場所に保存済みです。", acknowledgement);
  const commit = button("commit", "表示した操作を確定", () => {
    const ticket = controller.state().review?.ticket;
    const acknowledged = checkbox.checked;
    checkbox.checked = false;
    void controller.confirm(ticket, acknowledged);
  });
  const cancel = button("cancel", "保管操作の確認を取り消す", () => controller.cancel());
  const status = node("p", "status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  node("p", "limits", "開くには保存時の合言葉が必要です。内容は変更プレビュー後に復元します。既存の平文履歴はこの操作で暗号化・削除されません。削除はこの保管箱の1件だけが対象で、端末全体からの完全消去を保証しません。");
  function render(state) {
    if (disposed) return;
    lastState = state;
    const busy = state.busy || state.disposed;
    section.setAttribute("aria-busy", String(state.busy));
    load.disabled = busy;
    archive.disabled = busy;
    file.disabled = busy;
    save.disabled = busy || !ready;
    select.disabled = busy || !state.summary?.count;
    open.disabled = prepareExport.disabled = remove.disabled = busy || !state.selected;
    exportButton.disabled = busy || !state.canExport;
    checkbox.disabled = busy || !state.review;
    if (priorTicket !== (state.review?.ticket ?? null)) checkbox.checked = false;
    priorTicket = state.review?.ticket ?? null;
    commit.disabled = busy || !state.review || !checkbox.checked;
    cancel.disabled = state.disposed;
    select.replaceChildren();
    for (const [index, entry] of (state.summary?.entries ?? []).entries()) {
      const option = node("option", "option",
        `${index + 1}. ${new Date(entry.savedAt).toISOString()} / ${entry.bytes} bytes / ${entry.id.slice(0, 12)}`, select);
      option.value = entry.id;
      option.selected = entry.id === state.selected;
    }
    select.value = state.selected ?? "";
    capacity.textContent = state.summary
      ? `${state.summary.count} / ${state.summary.maxCount} 件、${state.summary.bytes} / ${state.summary.maxBytes} bytes`
      : "一覧はまだ読み込んでいません。";
    review.textContent = !state.review ? "" : state.review.kind === "merge"
      ? `保管箱へ ${state.review.merge.added} 件を追加し、重複 ${state.review.merge.duplicates} 件は保持します。追加容量 ${state.review.merge.addedBytes} bytes、合計 ${state.review.merge.total} 件。既存データは削除しません。確認の有効時間は1分です。`
      : state.review.kind === "add"
      ? (state.review.duplicate ? "同じ暗号化ファイルは既に保管されています。重複は追加しません。" :
        `暗号化ファイル ${state.review.bytes} bytes を保管します。`) + " 確認の有効時間は1分です。"
      : `識別子 ${state.review.id.slice(0, 12)} の1件（${state.review.bytes} bytes）を保管箱から削除します。確認の有効時間は1分です。`;
    const messages = {
      idle: "保管は自動では行いません。まず暗号化ファイルを準備してください。",
      loading: "暗号化ファイルの一覧と破損を確認しています。",
      preparing: "保管する内容と現在の一覧を確認しています。",
      review: "表示内容を確認してから確定してください。まだ変更していません。",
      committing: "保管領域の処理結果を確認しています。",
      opening: "保管内容の変更と破損を確認しています。",
      exporting: "ダウンロード用の暗号化ファイルを確認しています。",
      ready: "一覧を確認しました。開くには対象を選び、保存時の合言葉を入力してください。",
      cancelled: "確認を取り消しました。保存状態は一覧を読み直して確認してください。",
      disposed: "保管画面を閉じました。",
    };
    const outcomes = {
      saved: "暗号化ファイルの保管が完了しました。合言葉は保存していません。",
      removed: "選択した1件を保管箱から削除しました。",
      merged: "暗号化した保管データの取り込みが完了しました。既存データと重複分は保持しています。",
      duplicate: "同じ暗号化ファイルが既に保管されています。追加はしていません。",
      opened: "暗号化ファイルを上の合言葉入力欄へ渡しました。まだ復元していません。",
      "export-ready": "ダウンロードを準備しました。ダウンロードボタンで保存してください。",
      "archive-ready": "保管箱全体を暗号化された状態のファイルにまとめました。ダウンロードボタンで保存してください。",
      "export-offered": "ダウンロードを開始しました。完了はブラウザーのダウンロード一覧で確認してください。",
    };
    status.textContent = state.errorCode ? LIBRARY_MESSAGES[state.errorCode] ?? LIBRARY_MESSAGES.LIBRARY_INTERNAL
      : outcomes[state.result] ?? messages[state.phase] ?? LIBRARY_MESSAGES.LIBRARY_INTERNAL;
  }
  controller = createEncryptedLibraryController({ ...controllerOptions, onChange: render, onOpen });
  listen(select, "change", () => controller.select(select.value));
  listen(checkbox, "change", () => render(controller.state()));
  listen(file, "change", () => {
    const files = file.files;
    if (files?.length === 1) void controller.prepareImport(files[0]);
    else { controller.cancel(); status.textContent = "保管箱ファイルは1件ずつ選択してください。"; }
    file.value = "";
  });
  parent.append(section);
  render(controller.state());
  return Object.freeze({ state: controller.state,
    setReady(value) { ready = value === true; render(lastState); },
    protect() { if (!disposed) { ready = false; file.value = ""; checkbox.checked = false; controller.cancel(); } },
    dispose() {
      if (disposed) return;
      disposed = true;
      controller.dispose();
      for (const removeListener of cleanup) removeListener();
      section.remove();
    } });
}
