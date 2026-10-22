import { createAllowanceController } from "../src/allowance-controller.js";
import { formatAllowanceTargets, ALLOWANCE_DRAFT_LIMIT } from "../src/allowance-targets.js";
import { describeAllowanceTargets, describeAllowanceObservation, describeAllowanceComparison,
  describeAllowanceProgress, allowanceErrorMessage } from "../src/allowance-view.js";

/** Explicit local files and read-only requests, with no automatic provider access. */
export function mountAllowancePanel({ document, parent, getContext, read,
  downloadFile, subtle, onStateChange = () => {} } = {}) {
  const listeners = [];
  let disposed = false;
  let controller;
  const section = document.createElement("section");
  section.className = "allowance-panel";
  const element = (tag, name, text) => {
    const node = document.createElement(tag);
    node.className = "allowance-" + name;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const button = (name, text) => {
    const node = element("button", name, text);
    node.type = "button";
    return node;
  };
  const listen = (node, event, handler) => {
    node.addEventListener(event, handler);
    listeners.push(() => node.removeEventListener(event, handler));
  };
  const heading = element("h3", "heading", "指定した相手への承認額");
  const intro = element("p", "intro",
    "ERC-20トークンを使う許可がどれだけ残っているか、指定した相手について読み取ります。");
  const draftLabel = element("label", "draft-label",
    "確認する相手の公開アドレス（1行に1件、最大20件。名前は任意）");
  const draft = element("textarea", "draft");
  draft.rows = 4;
  draft.maxLength = ALLOWANCE_DRAFT_LIMIT;
  draft.placeholder = "0x… | 自分で付けた名前";
  draft.spellcheck = false;
  draft.setAttribute("aria-label", "確認する承認先の一覧");
  draftLabel.append(draft);
  const preview = button("preview", "確認先をプレビュー");
  const apply = button("apply", "この一覧を確認対象にする");
  const targets = element("pre", "targets");
  const inspect = button("inspect", "接続中のWalletで承認額を読む");
  const cancel = button("cancel", "読取り・読込みを中止");
  const clear = button("clear", "記録を画面から消す");
  const status = element("p", "status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const progress = element("p", "progress");
  progress.setAttribute("aria-live", "polite");
  const filterLabel = element("label", "filter-label", "表示する承認額");
  const filter = element("select", "filter");
  for (const [value, title] of [
    ["all", "すべて"], ["nonzero", "承認額あり"], ["maximum", "uint256最大値"],
    ["zero", "ゼロ"], ["unknown", "読取りできなかった相手"], ["code-absent", "コードがない相手"],
  ]) {
    const option = element("option", "filter-option", title);
    option.value = value;
    filter.append(option);
  }
  filter.value = "all";
  filterLabel.append(filter);
  const searchLabel = element("label", "search-label", "名前・公開アドレスで絞り込む");
  const search = element("input", "search");
  search.type = "search";
  search.maxLength = 128;
  search.value = "";
  searchLabel.append(search);
  const details = element("pre", "details");
  const saveTargets = button("save-targets", "確認先一覧をファイル保存");
  const save = button("save", "承認額の記録をファイル保存");
  const fileLabel = element("label", "file-label", "保存済みの一覧・承認額JSONを読み込む");
  const file = element("input", "file");
  file.type = "file";
  file.accept = ".json,application/json";
  file.setAttribute("aria-label", "承認額の記録または確認先一覧JSONファイル");
  fileLabel.append(file);
  const baseline = button("baseline", "この記録を比較の基準にする");
  const compare = button("compare", "基準記録と比較");
  const baselineStatus = element("p", "baseline-status");
  const comparison = element("pre", "comparison");
  const note = element("p", "note",
    "署名・送金・承認変更は行いません。指定した相手だけを調べます。保存ファイルには公開アドレスと残高が含まれます。");
  section.append(heading, intro, draftLabel, preview, apply, targets, inspect, cancel, clear,
    status, progress, filterLabel, searchLabel, details, saveTargets, save, fileLabel,
    baseline, compare, baselineStatus, comparison, note);
  parent.append(section);

  function renderDetails(state) {
    details.textContent = state.observation
      ? describeAllowanceObservation(state.observation, state.provenance,
        { status: filter.value, search: search.value }) : "";
  }
  function render(state) {
    if (disposed) return;
    try { onStateChange(state); } catch {}
    const busy = ["reading", "loading", "preparing"].includes(state.phase);
    section.setAttribute("aria-busy", String(busy));
    draft.disabled = busy;
    preview.disabled = busy;
    apply.disabled = busy || !state.preview;
    inspect.disabled = busy || !state.plan;
    cancel.disabled = !busy;
    file.disabled = busy;
    saveTargets.disabled = busy || !state.plan;
    save.disabled = busy || !state.observation;
    baseline.disabled = busy || !state.observation;
    compare.disabled = busy || !state.baseline || !state.observation;
    filter.disabled = !state.observation;
    search.disabled = !state.observation;
    const labels = {
      idle: "確認先を入力してください。",
      previewing: "確認先を検証しています。",
      preview: "一覧を確認し、確認対象にするボタンを押してください。",
      configured: "確認先を設定しました。読取りはまだ行っていません。",
      reading: "同じブロックで承認額を読み取っています…",
      loading: "ファイルの形式と破損を確認しています…",
      preparing: "保存ファイルを準備しています…",
      ready: state.provenance === "imported" ? "過去の保存記録を表示しています。" : "今回の読取り記録を表示しています。",
      cancelled: "処理を中止しました。",
      error: "処理できませんでした。",
    };
    status.textContent = state.errorCode ? allowanceErrorMessage(state.errorCode) : labels[state.phase] ?? "";
    targets.textContent = state.preview ? describeAllowanceTargets(state.preview.plan)
      : state.plan ? describeAllowanceTargets(state.plan) : "";
    progress.textContent = state.phase === "reading" ? describeAllowanceProgress(state.progress) : "";
    progress.hidden = !progress.textContent;
    renderDetails(state);
    const id = state.baseline?.identity;
    baselineStatus.textContent = id
      ? "比較の基準: " + id.agent + " / chain " + id.chainId + " / block " + id.blockNumber + " / " + id.account
      : "比較の基準は未設定です。";
    comparison.textContent = state.comparison
      ? describeAllowanceComparison(state.baseline, state.observation) : "";
  }
  controller = createAllowanceController({ getContext, read, onChange: render, subtle });
  const invalidate = () => {
    if (disposed) return;
    file.value = "";
    controller.invalidate();
  };
  listen(draft, "input", () => { if (!disposed) controller.editTargets(); });
  listen(preview, "click", () => { if (!disposed) controller.preview(draft.value); });
  listen(apply, "click", () => {
    if (!disposed && controller.apply()) draft.value = formatAllowanceTargets(controller.state().plan);
  });
  listen(inspect, "click", () => { if (!disposed) void controller.inspect(); });
  listen(cancel, "click", () => { if (!disposed) controller.cancel(); });
  listen(clear, "click", invalidate);
  for (const [node, event] of [[filter, "change"], [search, "input"]]) {
    listen(node, event, () => {
      if (disposed) return;
      try { renderDetails(controller.state()); }
      catch (error) { status.textContent = allowanceErrorMessage(error?.code); }
    });
  }
  listen(file, "change", () => {
    if (disposed) return;
    const selected = file.files?.[0];
    file.value = "";
    if (selected) void controller.load(selected);
  });
  listen(baseline, "click", () => { if (!disposed) controller.useAsBaseline(); });
  listen(compare, "click", () => { if (!disposed) controller.compare(); });

  function browserDownload(prepared) {
    const win = document.defaultView;
    if (!win?.URL?.createObjectURL || !win?.Blob) throw Error("Download unavailable");
    const url = win.URL.createObjectURL(new win.Blob([prepared.text], { type: prepared.mimeType }));
    const anchor = document.createElement("a");
    try {
      anchor.href = url;
      anchor.download = prepared.filename;
      anchor.hidden = true;
      section.append(anchor);
      anchor.click();
    } finally {
      anchor.remove();
      win.setTimeout(() => win.URL.revokeObjectURL(url), 1000);
    }
  }
  for (const [node, kind] of [[saveTargets, "targets"], [save, "observation"]]) {
    listen(node, "click", async () => {
      if (disposed || !await controller.prepare(kind) || disposed) return;
      const prepared = controller.state().file;
      if (!prepared) return;
      try {
        await (downloadFile ?? browserDownload)(prepared);
        if (!disposed && controller.state().file === prepared) {
          status.textContent = "保存ファイルを用意しました。ブラウザーのダウンロード完了を確認してください。";
        }
      } catch {
        if (!disposed && controller.state().file === prepared) status.textContent = "保存ファイルをダウンロードできませんでした。";
      }
    });
  }
  render(controller.state());
  return Object.freeze({
    invalidate,
    dispose() {
      if (disposed) return;
      disposed = true;
      controller.dispose();
      for (const stop of listeners) stop();
      section.remove();
    },
  });
}
