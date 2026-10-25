import { setupFromFields, encodeWalletSetup, inspectWalletFields,
  createWalletSetupReview, describeWalletSetupReview, WALLET_SETUP_LIMIT } from "../src/wallet-setup.js";
import { prepareWalletSetupFile, createWalletSetupFileReader } from "../src/wallet-setup-file.js";
import { offerHistoryDownload } from "./history-files.js";
import { observeCallbackResult } from "../src/security-callback.js";

const MESSAGES = Object.freeze({
  SETUP_DUPLICATE: "同じ公開アドレスが複数のカードにあります。別々のアドレスを設定してください。",
  SETUP_ADDRESS: "公開アドレスの形式を確認してください。未設定なら空欄にできます。",
  SETUP_CHAIN: "Base SepoliaまたはBase Mainnetを指定してください。",
  SETUP_STALE: "プレビュー後に画面の設定が変わりました。もう一度確認してください。",
  SETUP_REVIEW_REQUIRED: "設定JSONの内容をプレビューしてから適用してください。",
  SETUP_ADAPTER: "設定の反映処理を完了できませんでした。カードの設定を確認してください。",
  SETUP_WRITE_MISMATCH: "3枚すべての設定反映を確認できませんでした。各カードの現在値を確認し、もう一度プレビューしてください。",
  SETUP_RECOVERY_REQUIRED: "設定の反映状態を確認できないため、この画面での復元を停止しました。元の設定ファイルを保全してください。",
  SETUP_DOWNLOAD: "設定ファイルのダウンロードを開始できませんでした。現在の設定は保持しています。",
  SETUP_SIZE: "設定ファイルが空、または大きすぎます。",
  SETUP_ENCODING: "UTF-8形式のJSONファイルを選んでください。",
  SETUP_FILENAME: "設定を保存した.jsonファイルを選んでください。",
});

/** Explicit local configuration workflow. No wallet object is accepted here. */
export function mountWalletSetupPanel({ document, parent, readFields, applyPlan, prepareApply,
  download = offerHistoryDownload, readBytes }) {
  const cleanup = [];
  let disposed = false;
  let preview = null;
  let busy = false;
  let generation = 0;
  function readCurrentFields() {
    const value = readFields();
    if (observeCallbackResult(value) !== "synchronous") throw { code: "SETUP_ADAPTER" };
    return value;
  }
  const review = createWalletSetupReview({ readFields: readCurrentFields, applyPlan, prepareApply });
  const section = document.createElement("section");
  section.className = "wallet-setup-panel";
  function node(tag, name, text) {
    const item = document.createElement(tag);
    item.className = name;
    if (text !== undefined) item.textContent = text;
    return item;
  }
  function listen(item, event, action) {
    const handler = () => { if (!disposed) action(); };
    item.addEventListener(event, handler);
    cleanup.push(() => item.removeEventListener(event, handler));
  }
  function label(text, item) {
    const wrapper = node("label", "", text);
    wrapper.append(item);
    return wrapper;
  }
  function button(name, text, action) {
    const item = node("button", "wallet-setup-" + name, text);
    item.type = "button";
    listen(item, "click", () => {
      try { action(); }
      catch (error) {
        if (disposed) return;
        cancelPreview();
        status.textContent = MESSAGES[error?.code] ?? "設定の形式を確認してください。適用は完了していません。";
      }
    });
    return item;
  }
  const heading = node("h2", "", "3ウォレットの設定を保存・復元");
  const note = node("p", "notice", "保存するのは各カードの公開アドレスとネットワークです。秘密鍵・接続許可・残高履歴は含みません。設定の復元だけでWalletは接続されません。");
  const readiness = node("pre", "wallet-setup-readiness");
  readiness.setAttribute("aria-live", "polite");
  const status = node("p", "wallet-setup-status", "各カードの設定を確認してから保存できます。");
  status.setAttribute("role", "status");
  const text = node("textarea", "wallet-setup-json");
  text.rows = 5;
  text.maxLength = WALLET_SETUP_LIMIT;
  text.spellcheck = false;
  text.setAttribute("aria-label", "3ウォレットの設定JSON");
  const details = node("pre", "wallet-setup-details");
  const confirmed = node("input", "wallet-setup-confirm");
  confirmed.type = "checkbox";
  confirmed.checked = false;
  const checkLabel = label("変更対象の切断・残高表示の消去を確認しました（保存履歴は残ります）", confirmed);
  const refreshButton = button("refresh", "カードの設定状況を確認", () => {
    refresh();
    status.textContent = "設定状況を確認しました。実ウォレットの所有・接続は別途確認してください。";
  });
  const exportButton = button("export", "現在の設定をJSONにする", () => {
    reader.cancel();
    cancelPreview();
    text.value = encodeWalletSetup(setupFromFields(readCurrentFields()));
    status.textContent = "現在の設定をJSONにしました。まだファイル保存はしていません。";
  });
  const save = button("save", "現在の設定ファイルをダウンロード", () => {
    const id = ++generation;
    const prepared = prepareWalletSetupFile(setupFromFields(readCurrentFields()));
    if (disposed || generation !== id) return;
    const result = download({ document, prepared });
    const receipt = observeCallbackResult(result);
    if (disposed || generation !== id) return;
    if (receipt !== "synchronous" || result === false) throw { code: "SETUP_DOWNLOAD" };
    status.textContent = "設定ファイルのダウンロードを開始しました。PCへの保存完了を確認してください。";
  });
  const inspect = button("preview", "設定JSONの変更内容をプレビュー", () => {
    cancelPreview();
    preview = review.preview(text.value);
    details.textContent = describeWalletSetupReview(preview);
    status.textContent = "まだ設定は変更していません。変更内容を確認してください。";
    controls();
  });
  const apply = button("apply", "確認した設定をカードへ反映", () => {
    if (!confirmed.checked || !preview) throw Error("Confirmation required");
    const candidate = preview;
    // Clear UI authorization before entering the application callback.
    preview = null;
    confirmed.checked = false;
    controls();
    const result = review.apply(candidate.id, text.value);
    if (disposed) return;
    details.textContent = "";
    refresh();
    status.textContent = result.changedAgents.length
      ? result.changedAgents.join("・") + "の設定を反映しました。必要なカードで改めてWalletを選び、接続してください。"
      : "設定の変更はありませんでした。既存の接続と履歴は維持しています。";
  });
  const cancel = button("cancel", "プレビューを取り消す", () => {
    reader.cancel();
    cancelPreview();
    status.textContent = "プレビューを取り消しました。カード設定と保存履歴は変更していません。";
  });
  const file = node("input", "wallet-setup-file");
  file.type = "file";
  file.accept = ".json,application/json";
  file.setAttribute("aria-label", "読み込むウォレット設定ファイル");
  const reader = createWalletSetupFileReader({ readBytes, onChange(state) {
    if (disposed) return;
    busy = state.phase === "reading";
    controls();
    if (state.phase === "reading") {
      cancelPreview();
      status.textContent = "設定ファイルを読み込んでいます。カード設定は変更していません。";
    } else if (state.phase === "ready") {
      cancelPreview();
      text.value = state.text;
      status.textContent = "設定JSONを読み込みました。プレビューしてから適用してください。";
    } else if (state.phase === "error") {
      status.textContent = MESSAGES[state.errorCode] ?? "設定ファイルを読み込めませんでした。カード設定は保持しています。";
    }
  } });
  function controls() {
    file.disabled = busy;
    inspect.disabled = busy;
    apply.disabled = busy || !preview || !confirmed.checked;
    confirmed.disabled = busy || !preview;
    section.setAttribute("aria-busy", String(busy));
  }
  function cancelPreview() {
    generation++;
    review.cancel();
    preview = null;
    confirmed.checked = false;
    details.textContent = "";
    controls();
  }
  function refresh() {
    try {
      const result = inspectWalletFields(readCurrentFields());
      const labels = { missing: "未設定", invalid: "公開アドレスの形式が不正", duplicate: "他のカードと同じアドレス", configured: "設定済み・接続未確認" };
      readiness.textContent = "別アドレスの設定: " + result.configured + " / 3\n" +
        result.entries.map(row => row.agent + ": " + labels[row.status] + " / " +
          (row.chainId === 84532 ? "Base Sepolia" : "Base Mainnet")).join("\n");
    } catch { readiness.textContent = "カード設定を確認できませんでした。入力を確認してください。"; }
  }
  listen(confirmed, "change", controls);
  listen(text, "input", () => {
    reader.cancel();
    cancelPreview();
    status.textContent = "JSONが変わりました。もう一度プレビューしてください。";
  });
  listen(file, "change", () => {
    const selected = file.files;
    if (!selected?.length) return;
    cancelPreview();
    if (selected.length !== 1) {
      reader.cancel();
      status.textContent = "設定ファイルは1つずつ選んでください。";
    } else void reader.load(selected[0]);
    file.value = "";
  });
  section.append(heading, note, readiness, refreshButton, exportButton, save,
    label("設定ファイルを選択", file), label("保存・読み込み用の設定JSON", text),
    inspect, details, checkLabel, apply, cancel, status);
  parent.append(section);
  controls();
  refresh();
  return Object.freeze({
    invalidate() {
      if (disposed) return;
      reader.cancel();
      cancelPreview();
      refresh();
      status.textContent = "カード設定が変わりました。必要な場合はプレビューをやり直してください。";
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      generation++;
      reader.dispose();
      review.dispose();
      for (const stop of cleanup) stop();
      section.remove();
    },
  });
}
