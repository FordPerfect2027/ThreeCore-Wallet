import { vaultCollectionReviewText } from "../src/transfer-vault-collection.js";
import { createVaultController } from "../src/transfer-vault-controller.js";
import { createVaultStorage } from "../src/transfer-vault-storage.js";
import { VAULT_AGENTS } from "../src/transfer-vault-model.js";
import { activityRowText, queryVaultActivity, vaultActivityText, vaultCounterparties } from "../src/transfer-vault-analytics.js";
import { vaultErrorText, vaultReviewText } from "../src/transfer-vault-messages.js";
import { DIRECTION_LABELS, TRANSFER_DIRECTIONS } from "../src/transfer-view.js";

/** Public addresses are rendered as text, never HTML, hrefs, or provider requests. */
export function mountTransferVaultPanel({ document, parent, readCards, stageArchive, storage = createVaultStorage(),
  download = downloadFile, subtle, now, createId } = {}) {
  const cleanup = [];
  let disposed = false, state, page = 0, renderedWorking = null;
  let currentReview = null;
  function node(tag, name, text = "") {
    const element = document.createElement(tag);
    element.className = "transfer-vault-" + name;
    element.textContent = text;
    return element;
  }
  function listen(element, type, callback) {
    element.addEventListener(type, callback);
    cleanup.push(() => element.removeEventListener(type, callback));
  }
  function button(name, text) {
    const element = node("button", name, text);
    element.type = "button";
    return element;
  }
  function input(name, title, type = "text") {
    const label = node("label", name + "-label", title);
    const element = node("input", name);
    element.type = type;
    element.autocomplete = "off";
    label.append(element);
    return { label, element };
  }
  function select(name, title, values) {
    const label = node("label", name + "-label", title);
    const element = node("select", name);
    for (const [value, text] of values) {
      const option = node("option", name + "-option", text);
      option.value = value;
      element.append(option);
    }
    element.value = values[0][0];
    label.append(element);
    return { label, element };
  }
  const host = node("section", "panel");
  const title = node("h2", "title", "3トークンの履歴を保管・集計");
  const notice = node("p", "notice", "保存は操作したときだけ行います。公開アドレスと履歴が含まれます。PC内保存は同じブラウザー・同じURLでのみ利用でき、ブラウザーデータの削除で失われるため、JSONも保存してください。");
  const source = node("div", "actions");
  const capture = button("capture", "3枚のカードの履歴を確認");
  const strategy = select("strategy", "取り込み方法", [["replace", "作業用コピーを置き換える"], ["merge", "矛盾がない記録だけを追加する"]]);
  const cancel = button("cancel", "プレビュー・処理を中止");
  source.append(capture, strategy.label, cancel);
  const undo = button("undo", "作業用コピーを元に戻す");
  const redo = button("redo", "作業用コピーをやり直す");
  const undoNotice = node("p", "undo-notice");
  source.append(undo, redo, undoNotice);
  const status = node("p", "status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const review = node("pre", "review");
  const acknowledge = input("acknowledge", "作業用コピーから外れる記録を確認しました", "checkbox");
  const apply = button("apply", "確認した履歴を作業用コピーへ反映");
  const overview = node("pre", "overview");
  const restore = select("restore-agent", "個別カードへ戻すトークン", VAULT_AGENTS.map(agent => [agent, agent]));
  const stage = button("stage-card", "個別カードで復元内容を確認");
  const stageNotice = node("p", "stage-notice", "カードのアカウント・チェーンが一致するときだけプレビューします。カード側でも確認して反映してください。自動で接続・取得は行いません。");
  const files = node("details", "files");
  files.append(node("summary", "files-title", "JSONの保存・読み込みと旧形式の取り込み"));
  const exports = ["json", "csv", "txt"].map(kind => ({ kind, button: button("export-" + kind, ({ json: "一括JSONを保存", csv: "履歴CSVを保存", txt: "集計テキストを保存" })[kind]) }));
  const kind = select("file-kind", "読み込み形式", [["bundle", "3トークン一括JSON"], ["snapshot", "従来の1期間の履歴JSON"], ["archive", "従来の期間まとめJSON"]]);
  const legacyAgent = select("legacy-agent", "個別ファイルのトークン", VAULT_AGENTS.map(agent => [agent, agent]));
  const file = input("file", "保存JSONを開く（一括形式は最大20 MiB）", "file");
  file.element.accept = ".json,application/json";
  files.append(...exports.map(row => row.button), kind.label, legacyAgent.label, file.label,
    node("p", "checksum", "チェックサムは破損検出の補助です。作成者の認証やチェーン上の正しさを証明しません。旧形式は従来の容量上限で検査します。"));
  const saved = node("details", "saved");
  saved.append(node("summary", "saved-title", "PC内の保存一覧（最大5件・合計24 MiB）"));
  const refresh = button("refresh", "PC内の保存一覧を開く・再読み込み");
  const label = input("label", "保存名（60文字以内）");
  label.element.maxLength = 60;
  const save = button("save", "作業用コピーを新しい記録として保存");
  const storedList = select("stored", "保存記録", [["", "一覧を開いて選択してください"]]);
  const metadata = node("pre", "metadata");
  const inspect = button("inspect", "選択した保存内容を確認");
  const storedExport = button("stored-export", "選択した保存記録をJSONに書き出す");
  const rename = button("rename", "選択した記録の名前を変更");
  const archive = button("archive", "選択した記録を非表示保管にする");
  const unarchive = button("unarchive", "非表示保管から戻す");
  const purgeAck = input("purge-ack", "JSONなどに保全済みで、選択した非表示保管記録を完全に削除する", "checkbox");
  const purge = button("purge", "確認した非表示保管記録を完全に削除");
  saved.append(refresh, label.label, save, storedList.label, metadata, inspect, storedExport, rename, archive, unarchive, purgeAck.label, purge);
  const collectionExport = button("collection-export", "保存一覧全体をJSONに保全");
  const collectionFile = input("collection-file", "保存一覧の保全JSONを開く（最大40 MiB）", "file");
  collectionFile.element.accept = ".json,application/json";
  const collectionReview = node("pre", "collection-review");
  const collectionApply = button("collection-apply", "確認した保管記録をPC内の一覧へ追加");
  saved.append(collectionExport, collectionFile.label, collectionReview, collectionApply);
  const activity = node("details", "activity");
  activity.append(node("summary", "activity-title", "保存履歴を横断して確認"), node("p", "order-notice", "表示はチェーン別・ブロック順です。異なるチェーンを共通の時刻順に並べたものではありません。"));
  const agent = select("agent", "トークンで絞る", [["all", "すべて"], ...VAULT_AGENTS.map(value => [value, value])]);
  const direction = select("direction", "送受信の種類", TRANSFER_DIRECTIONS.map(value => [value, DIRECTION_LABELS[value]]));
  const search = input("search", "公開アドレス・取引ハッシュ・ブロックで検索");
  search.element.maxLength = 100;
  const order = select("order", "ブロック順", [["newest", "降順"], ["oldest", "昇順"]]);
  const previous = button("previous", "前の20件"), next = button("next", "次の20件");
  const counter = node("span", "counter"), rows = node("ol", "rows");
  const filteredExport = button("filtered-export", "表示条件に一致する全件をCSVに保存");
  const filteredNotice = node("p", "filtered-notice", "検索CSVは今のページだけでなく、一致した全件を含みます。PC内の保存一覧や元の履歴は変更しません。");
  const counterparties = node("pre", "counterparties");
  activity.append(agent.label, direction.label, search.label, order.label, previous, counter, next, filteredExport, filteredNotice, rows, counterparties);
  host.append(title, notice, source, status, review, acknowledge.label, apply, overview, restore.label, stage, stageNotice, files, saved, activity);
  parent.append(host);

  function renderActivity() {
    if (!state || disposed) return;
    rows.replaceChildren();
    counterparties.textContent = "";
    previous.disabled = true;
    next.disabled = true;
    filteredExport.disabled = true;
    try {
      const result = queryVaultActivity(state.working, { agent: agent.element.value, direction: direction.element.value,
        search: search.element.value, order: order.element.value, page, pageSize: 20 });
      page = result.query.page;
      counter.textContent = `${result.matched}件 / ${page + 1}ページ目（全${result.pages}ページ）`;
      previous.disabled = !result.hasPrevious;
      next.disabled = !result.hasNext;
      filteredExport.disabled = state.busy || result.matched === 0;
      for (const row of result.rows) rows.append(node("li", "row", activityRowText(row)));
      if (!result.rows.length) rows.append(node("li", "empty", "この条件に該当する記録はありません。"));
      if (VAULT_AGENTS.includes(agent.element.value)) {
        const groups = vaultCounterparties(state.working, agent.element.value);
        counterparties.textContent = ["相手先別（このトークンの全保存履歴・上位20件）", "発行・焼却・自己送信は除きます。本人確認や信用評価ではありません。",
          ...groups.slice(0, 20).map(row => `${row.address}\n${row.events}イベント / 受信 ${row.received} / 送信 ${row.sent}`)].join("\n");
      }
    } catch {
      counter.textContent = "検索条件を確認してください。";
    }
  }

  const success = { undo: "作業用コピーを前の状態に戻しました。保存済みの記録は変更していません。", redo: "作業用コピーの変更をやり直しました。", collectionApply: "確認した保管記録をPC内の保存一覧に追加しました。", save: "PC内への保存が完了しました。JSONも保存して保全できます。", apply: "確認した過去の記録を表示しています。現在のチェーン状態は未確認です。",
    stageCard: "個別カードにプレビューを用意しました。カードの期間まとめ欄で内容を確認してください。",
    refresh: "PC内の保存一覧を読み込みました。", archive: "選択した記録を非表示保管にしました。", unarchive: "記録を非表示保管から戻しました。",
    purge: "確認した保管記録を削除しました。", rename: "保存名を変更しました。", cancel: "処理を中止しました。保存中だった場合は一覧を再読み込みして結果を確認できます。" };
  function render(value) {
    state = value;
    host.setAttribute("aria-busy", String(value.busy));
    if (renderedWorking !== value.working) { page = 0; renderedWorking = value.working; }
    if (currentReview !== value.review?.id) { acknowledge.element.checked = false; currentReview = value.review?.id; }
    status.textContent = value.error ? vaultErrorText(value.error) : value.busy ? "処理しています。" :
      value.review ? "取り込む内容と、作業用コピーから外れる記録を確認してください。" :
      success[value.lastAction] ?? (value.hasRecords ? "作業用コピーがあります。保存ボタンで保管できます。" : "履歴を取り込んでください。起動時の自動読み込み・保存は行いません。");
    if (value.cardsChanged) status.textContent += " カードの状態が変わっています。作業用コピーは過去の記録として保持しています。";
    review.textContent = vaultReviewText(value.review);
    overview.textContent = vaultActivityText(value.working);
    acknowledge.label.hidden = !value.review?.removesRecords;
    apply.disabled = value.busy || !value.review || (value.review.removesRecords && !acknowledge.element.checked);
    capture.disabled = value.busy;
    undo.disabled = value.busy || value.timeline.undoCount === 0;
    redo.disabled = value.busy || value.timeline.redoCount === 0;
    undoNotice.textContent = `元に戻せる操作 ${value.timeline.undoCount}件 / やり直せる操作 ${value.timeline.redoCount}件。最大5操作・24 MiBまで、画面を閉じると消えます。保存一覧は変更しません。` +
      (value.timeline.truncated ? " 容量上限のため古い操作の復元履歴は保持していません。" : "");
    cancel.disabled = !value.busy && !value.review;
    strategy.element.disabled = value.busy;
    file.element.disabled = value.busy;
    kind.element.disabled = value.busy;
    legacyAgent.element.disabled = value.busy || kind.element.value === "bundle";
    for (const row of exports) row.button.disabled = value.busy || !value.hasRecords;
    stage.disabled = value.busy || !value.working.slots.find(slot => slot.agent === restore.element.value)?.archive;
    refresh.disabled = value.busy;
    save.disabled = value.busy || !value.hasRecords || !value.metadata || value.metadata.remaining === 0;
    const previousId = storedList.element.value;
    storedList.element.replaceChildren();
    const empty = node("option", "stored-option", "保存記録を選択してください");
    empty.value = "";
    storedList.element.append(empty);
    for (const row of value.metadata?.entries ?? []) {
      const option = node("option", "stored-option", (row.archived ? "[非表示保管] " : "") + row.label + " / " + row.records + "期間");
      option.value = row.id;
      storedList.element.append(option);
    }
    storedList.element.value = value.selectedId ?? "";
    if (previousId !== storedList.element.value) purgeAck.element.checked = false;
    storedList.element.disabled = value.busy || !value.metadata;
    metadata.textContent = value.metadata ? `${value.metadata.count} / 5件、${value.metadata.bytes.toLocaleString()} bytes\n更新番号 ${value.metadata.revision}` : "保存一覧はまだ開いていません。";
    const selected = Boolean(value.selectedId);
    inspect.disabled = value.busy || !selected || value.selectedArchived;
    storedExport.disabled = value.busy || !selected;
    rename.disabled = value.busy || !selected;
    archive.disabled = value.busy || !selected || value.selectedArchived;
    unarchive.disabled = value.busy || !selected || !value.selectedArchived;
    purge.disabled = value.busy || !selected || !value.selectedArchived || !purgeAck.element.checked;
    collectionExport.disabled = value.busy || !value.metadata?.count;
    collectionFile.element.disabled = value.busy || !value.metadata;
    collectionReview.textContent = vaultCollectionReviewText(value.collectionReview);
    collectionApply.disabled = value.busy || !value.collectionReview;
    if (value.collectionReview) cancel.disabled = false;
    renderActivity();
  }
  const controller = createVaultController({ storage, readCards, stageArchive, onChange: render, subtle, now, createId });
  const merge = () => strategy.element.value === "merge";
  listen(capture, "click", () => controller.capture(merge()));
  listen(undo, "click", () => controller.undo());
  listen(redo, "click", () => controller.redo());
  listen(cancel, "click", () => controller.cancel());
  listen(strategy.element, "change", () => controller.cancel());
  listen(acknowledge.element, "change", () => render(controller.state));
  listen(apply, "click", () => controller.apply(state.review?.id, { acknowledgeRemoval: acknowledge.element.checked }));
  listen(restore.element, "change", () => render(controller.state));
  listen(stage, "click", () => controller.stageCard(restore.element.value));
  listen(kind.element, "change", () => { controller.cancel(); render(controller.state); });
  listen(legacyAgent.element, "change", () => controller.cancel());
  listen(file.element, "change", () => {
    const selected = file.element.files?.[0];
    file.element.value = "";
    if (!selected) return;
    if (kind.element.value === "bundle") controller.load(selected, merge());
    else controller.loadLegacy(selected, kind.element.value, legacyAgent.element.value, merge());
  });
  async function exportFile(kind, stored = false, query) {
    const file = await controller.prepare(kind, stored, query);
    if (!file || disposed) return;
    try { await download(file, document); }
    catch { if (!disposed) status.textContent = "ファイルを保存できませんでした。ダウンロード先を確認してください。"; }
  }
  for (const row of exports) listen(row.button, "click", () => exportFile(row.kind));
  listen(filteredExport, "click", () => exportFile("filtered-csv", false, {
    agent: agent.element.value, direction: direction.element.value, search: search.element.value,
    order: order.element.value, page: 0, pageSize: 20,
  }));
  listen(collectionExport, "click", async () => {
    const file = await controller.prepareCollection();
    if (!file || disposed) return;
    try { await download(file, document); }
    catch { if (!disposed) status.textContent = "保存一覧を書き出せませんでした。保存先を確認してください。"; }
  });
  listen(collectionFile.element, "change", () => {
    const selected = collectionFile.element.files?.[0];
    collectionFile.element.value = "";
    if (selected) controller.loadCollection(selected);
  });
  listen(collectionApply, "click", () => controller.applyCollection(state.collectionReview?.id));
  listen(refresh, "click", () => controller.refresh());
  listen(save, "click", () => controller.save(label.element.value));
  listen(storedList.element, "change", () => { purgeAck.element.checked = false; controller.select(storedList.element.value); });
  listen(inspect, "click", () => controller.inspectSelected(merge()));
  listen(storedExport, "click", () => exportFile("json", true));
  listen(rename, "click", () => controller.editSelected("rename", label.element.value));
  listen(archive, "click", () => { purgeAck.element.checked = false; controller.editSelected("archive"); });
  listen(unarchive, "click", () => { purgeAck.element.checked = false; controller.editSelected("unarchive"); });
  listen(purgeAck.element, "change", () => render(controller.state));
  listen(purge, "click", () => { const confirmed = purgeAck.element.checked; purgeAck.element.checked = false; controller.editSelected("purge", confirmed); });
  for (const control of [agent.element, direction.element, order.element]) listen(control, "change", () => { page = 0; renderActivity(); });
  listen(search.element, "input", () => { page = 0; renderActivity(); });
  listen(previous, "click", () => { page--; renderActivity(); });
  listen(next, "click", () => { page++; renderActivity(); });
  render(controller.state);
  return Object.freeze({ invalidateCards: () => controller.invalidateCards(),
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const stop of cleanup) stop();
      controller.dispose();
      host.remove();
    } });
}

function downloadFile(file, document) {
  const url = URL.createObjectURL(new Blob([file.text], { type: file.mimeType }));
  const anchor = document.createElement("a");
  try {
    anchor.href = url;
    anchor.download = file.filename;
    document.body.append(anchor);
    anchor.click();
  } finally {
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
