import { createPeriodLibraryController } from "../src/period-library-controller.js";
import { createPeriodLibraryStorage } from "../src/period-library-storage.js";
import { queryPeriodLibrary, summarizePeriodLibrary } from "../src/period-library-query.js";
import { libraryEntryText, libraryErrorText, libraryReviewText, LIBRARY_STATUS_TEXT } from "../src/period-library-view.js";

/** Stored drafts are rendered as text and require another review in the acquisition panel. */
export function mountPeriodLibraryPanel({ document, parent, getCheckpoint, stageCheckpoint,
  storage = createPeriodLibraryStorage(), download = file => downloadLibrary(file, document), now, createId } = {}) {
  let disposed = false, view, renderedDocument = null, lastSelection = null, lastReview = null;
  const cleanup = [], nodes = {};
  function node(tag, name, text, parentNode = host) {
    const element = document.createElement(tag);
    element.className = "period-library-" + name;
    if (text !== undefined) element.textContent = text;
    parentNode?.append(element);
    nodes[name] = element;
    return element;
  }
  const host = node("section", "panel", undefined, null);
  host.setAttribute("aria-label", "期間の控えのPC内保存一覧");
  parent.append(host);
  node("p", "eyebrow", "THREECORE / SAVED PERIODS");
  node("h2", "heading", "途中の控えを、名前を付けて保管する");
  node("p", "intro", "DAT・EMA・CAWELONの期間取得の控えを保存し、画面を開き直した後に選び直せます。保存はボタンを押したときだけ行います。");
  node("p", "notice", "同じブラウザー・同じURLで利用するPC内保存です。ブラウザーデータを削除すると失われます。JSONも保全してください。公開アドレス・残高・履歴を含み、暗号化されていません。");
  function button(name, label, parentNode = host) {
    const element = node("button", name, label, parentNode);
    element.type = "button";
    return element;
  }
  function input(name, label, type = "text", parentNode = host) {
    const container = node("label", name + "-label", label, parentNode);
    const element = node("input", name, undefined, container);
    element.type = type;
    element.autocomplete = "off";
    return element;
  }
  function select(name, label, options, parentNode) {
    const container = node("label", name + "-label", label, parentNode);
    const element = node("select", name, undefined, container);
    for (const [value, text] of options) {
      const option = document.createElement("option");
      option.value = value; option.textContent = text; element.append(option);
    }
    element.value = options[0][0];
    return element;
  }
  const actions = node("div", "actions");
  button("refresh", "期間の保存一覧を開く・再読み込み", actions);
  button("cancel", "保存一覧の処理を中止", actions);
  const status = node("p", "status");
  status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
  node("p", "capacity");
  const saveForm = node("div", "save-form");
  const label = input("label", "控えの保存名（60文字以内）", "text", saveForm);
  label.maxLength = 60;
  button("save", "現在の控えの保存内容を確認", saveForm);
  const review = node("section", "review");
  node("h3", "review-title", "操作する内容の確認", review);
  node("pre", "review-text", "", review);
  button("apply", "確認した保存一覧の操作を実行", review);
  const summary = node("div", "summary");
  const filters = node("div", "filters");
  select("agent", "保存一覧のトークン", [["all", "すべて"], ["DAT", "DAT"], ["EMA", "EMA"], ["CAWELON", "CAWELON"]], filters);
  select("archive", "保存一覧の保管状態", [["active", "通常の控え"], ["archived", "非表示保管"], ["all", "すべて"]], filters);
  select("status-filter", "控えの取得状態", [["all", "すべて"], ["partial", "途中"], ["complete", "取得済み"], ["blocked", "再取得が必要"]], filters);
  select("order", "控えの並び順", [["newest", "更新が新しい順"], ["oldest", "更新が古い順"], ["name", "名前順"], ["progress", "取得工程の割合順"]], filters);
  input("search", "保存名・アドレス・ブロックで検索", "text", filters).maxLength = 100;
  node("p", "count");
  const table = node("table", "table");
  node("caption", "caption", "選択する期間の控え", table);
  const thead = node("thead", "thead", undefined, table), headRow = document.createElement("tr");
  for (const text of ["保存名", "対象・期間", "取得状態", "操作"]) {
    const cell = document.createElement("th"); cell.scope = "col"; cell.textContent = text; headRow.append(cell);
  }
  thead.append(headRow);
  const rows = node("tbody", "rows", undefined, table);
  const detail = node("section", "detail");
  node("h3", "detail-title", "選択した控え", detail);
  node("pre", "detail-text", "", detail);
  const selectedActions = node("div", "selected-actions", undefined, detail);
  button("restore", "選択した控えの復元内容を確認", selectedActions);
  button("compare", "現在の控えとの差を確認", selectedActions);
  button("selected-export", "選択した控えを一覧形式のJSONに保存", selectedActions);
  node("pre", "comparison", "", detail);
  const name = input("rename", "選択した控えの新しい名前", "text", detail); name.maxLength = 60;
  button("rename-save", "控えの名前を変更", detail);
  button("archive-save", "選択した控えを非表示保管", detail);
  button("unarchive", "選択した控えを通常一覧に戻す", detail);
  const purge = node("details", "purge-section", undefined, detail);
  node("summary", "purge-title", "非表示保管した控えの完全削除", purge);
  input("purge-ack", "この控えをJSONなどに保全済みで、完全に削除することを確認しました", "checkbox", purge);
  button("purge", "確認した非表示保管の控えを完全に削除", purge);
  const files = node("section", "files");
  node("h3", "files-title", "一覧をファイルへ保全する", files);
  button("export-all", "期間の保存一覧全体をJSON保存", files);
  button("export-csv", "検索条件に合う控えの一覧をCSV保存", files);
  input("file", "期間の保存一覧JSONを読み込む（最大64 MiB）", "file", files).accept = ".json,application/json";
  node("p", "file-note", "JSONは非表示保管と再取得が必要な状態も含みます。CSVは一覧の要約のみで復元には使えません。チェックサムは破損検出用で、記録の正しさを認証しません。", files);

  const query = () => ({ agent: nodes.agent.value, archive: nodes.archive.value,
    status: nodes["status-filter"].value, search: nodes.search.value, order: nodes.order.value });
  function renderList() {
    rows.replaceChildren();
    if (!view?.loaded) { nodes.count.textContent = "一覧を開くと保存済みの控えを表示します。"; return; }
    try {
      const result = queryPeriodLibrary(view.document, query());
      nodes.count.textContent = `${result.matched}件表示 / 保存総数${result.total}件`;
      for (const row of result.rows) {
        const tr = document.createElement("tr");
        tr.setAttribute("data-selected", String(row.id === view.selectedId));
        for (const text of [row.label, `${row.context.agent} / chain ${row.context.chainId}\n${row.earlierBlock} → ${row.laterBlock}`,
          `${LIBRARY_STATUS_TEXT[row.status]} · ${row.completed}/${row.total}工程${row.archived ? " · 非表示保管" : ""}`]) {
          const cell = document.createElement("td"); cell.textContent = text; tr.append(cell);
        }
        const cell = document.createElement("td"), pick = document.createElement("button");
        pick.type = "button"; pick.textContent = "選択";
        pick.setAttribute("aria-label", "控えを選択: " + row.label);
        pick.disabled = view.busy;
        pick.addEventListener("click", () => controller.select(row.id));
        cell.append(pick); tr.append(cell); rows.append(tr);
      }
    } catch (value) { nodes.count.textContent = libraryErrorText(value.code); }
  }
  function render(state) {
    if (disposed) return;
    view = state;
    host.setAttribute("aria-busy", String(state.busy));
    status.textContent = state.error ? libraryErrorText(state.error) : state.message;
    status.setAttribute("data-error", String(Boolean(state.error)));
    nodes.refresh.disabled = state.busy;
    nodes.cancel.disabled = !state.busy && !state.review;
    for (const key of ["save", "label", "file", "export-all", "export-csv"]) nodes[key].disabled = state.busy || !state.loaded;
    review.hidden = !state.review;
    nodes["review-text"].textContent = libraryReviewText(state.review);
    nodes.apply.disabled = state.busy || !state.review;
    if (state.document !== renderedDocument) {
      renderedDocument = state.document;
      const info = summarizePeriodLibrary(state.document);
      nodes.capacity.textContent = `${info.count} / 12件 · ${(info.bytes / 1024).toFixed(1)} KiB / 48 MiB`;
      summary.replaceChildren();
      for (const row of info.agents) {
        const card = document.createElement("article");
        const title = document.createElement("h3"), text = document.createElement("p");
        title.textContent = row.agent;
        text.textContent = `途中 ${row.partial} · 取得済み ${row.complete} · 再取得 ${row.blocked}\n非表示保管 ${row.archived} / 接続条件 ${row.contexts}種類`;
        card.append(title, text); summary.append(card);
      }
    }
    summary.hidden = !state.loaded;
    const entry = state.document.entries.find(row => row.id === state.selectedId);
    detail.hidden = !entry;
    if (lastSelection !== entry || lastReview !== state.review) nodes["purge-ack"].checked = false;
    if (lastSelection !== entry) { name.value = entry?.label ?? ""; lastSelection = entry; }
    lastReview = state.review;
    nodes["detail-text"].textContent = entry ? libraryEntryText(entry) : "";
    nodes.comparison.textContent = state.comparison;
    for (const key of ["restore", "compare", "selected-export", "rename", "rename-save"]) nodes[key].disabled = state.busy || !state.loaded || !entry;
    nodes["archive-save"].disabled = state.busy || !state.loaded || !entry || entry.archived;
    nodes.unarchive.disabled = state.busy || !state.loaded || !entry?.archived;
    nodes["purge-ack"].disabled = state.busy || !state.loaded || !entry?.archived;
    nodes.purge.disabled = state.busy || !state.loaded || !entry?.archived || !nodes["purge-ack"].checked;
    renderList();
  }
  const controller = createPeriodLibraryController({ storage, getCheckpoint, stageCheckpoint, onChange: render,
    ...(now ? { now } : {}), ...(createId ? { createId } : {}) });
  function listen(name, event, callback) {
    nodes[name].addEventListener(event, callback);
    cleanup.push(() => nodes[name].removeEventListener(event, callback));
  }
  listen("refresh", "click", () => { void controller.refresh(); });
  listen("cancel", "click", () => controller.cancel());
  listen("save", "click", () => controller.prepareSave(label.value));
  listen("apply", "click", () => { void controller.applyReview(); });
  listen("restore", "click", () => controller.prepareRestore());
  listen("compare", "click", () => controller.compare());
  listen("rename-save", "click", () => { void controller.edit("rename", name.value); });
  listen("archive-save", "click", () => { void controller.edit("archive", true); });
  listen("unarchive", "click", () => { void controller.edit("archive", false); });
  listen("purge-ack", "change", () => render(controller.state));
  listen("purge", "click", () => { void controller.edit("purge", nodes["purge-ack"].checked); });
  for (const [name, kind] of [["selected-export", "selected"], ["export-all", "all"], ["export-csv", "csv"]]) {
    listen(name, "click", () => { void controller.exportFile(kind, download, query()); });
  }
  listen("file", "change", () => {
    const file = nodes.file.files?.[0]; nodes.file.value = "";
    if (file) void controller.importFile(file);
  });
  for (const name of ["agent", "archive", "status-filter", "order"]) listen(name, "change", renderList);
  listen("search", "input", renderList);
  // Editing either name invalidates a previously reviewed save operation.
  listen("label", "input", () => { if (controller.state.review?.kind === "save") controller.cancel(); });
  render(controller.state);
  return Object.freeze({ getDocument: () => controller.state.document,
    dispose() {
      if (disposed) return;
      disposed = true; controller.dispose(); cleanup.forEach(remove => remove()); host.remove();
    },
  });
}

function downloadLibrary(file, document) {
  const url = URL.createObjectURL(new Blob([file.text], { type: file.mimeType }));
  const anchor = document.createElement("a");
  try { anchor.href = url; anchor.download = file.filename; document.body.append(anchor); anchor.click(); }
  finally { anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
}
