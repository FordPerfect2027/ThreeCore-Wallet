import { startPermittedAccountRead } from "../src/wallet-session.js";
import { setupFromFields, encodeWalletSetup, inspectWalletFields,
  createWalletSetupReview, describeWalletSetupReview, WALLET_SETUP_LIMIT } from "../src/wallet-setup.js";
import { prepareWalletSetupFile, createWalletSetupFileReader } from "../src/wallet-setup-file.js";
import { offerHistoryDownload } from "./history-files.js";
import { observeCallbackResult } from "../src/security-callback.js";
import { readOwnErrorCode } from "../src/provider-error.js";

const MESSAGES = Object.freeze({
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
  let refreshing = false;
  const current = id => !disposed && generation === id;
  const diagnostic = (code, fallback) => typeof code === "string" && Object.hasOwn(MESSAGES, code) ? MESSAGES[code] : fallback;
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
      const id = ++generation;
      try { action(id); }
      catch (error) {
        if (!current(id)) return;
        const code = readOwnErrorCode(error);
        if (!current(id)) return;
        cancelPreview(false);
        if (!current(id)) return;
        status.textContent = diagnostic(code, "設定の形式を確認してください。適用は完了していません。");
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
  const refreshButton = button("refresh", "カードの設定状況を確認", id => {
    if (refresh(id) && current(id)) status.textContent = "設定状況を確認しました。実ウォレットの所有・接続は別途確認してください。";
  });
  const exportButton = button("export", "現在の設定をJSONにする", id => {
    reader.cancel();
    if (!current(id)) return;
    cancelPreview(false);
    const prepared = encodeWalletSetup(setupFromFields(readCurrentFields()));
    if (!current(id)) return;
    text.value = prepared;
    status.textContent = "現在の設定をJSONにしました。まだファイル保存はしていません。";
  });
  const save = button("save", "現在の設定ファイルをダウンロード", id => {
    const prepared = prepareWalletSetupFile(setupFromFields(readCurrentFields()));
    if (disposed || generation !== id) return;
    const result = download({ document, prepared });
    const receipt = observeCallbackResult(result);
    if (disposed || generation !== id) return;
    if (receipt !== "synchronous" || result === false) throw { code: "SETUP_DOWNLOAD" };
    status.textContent = "設定ファイルのダウンロードを開始しました。PCへの保存完了を確認してください。";
  });
  const inspect = button("preview", "設定JSONの変更内容をプレビュー", id => {
    cancelPreview(false);
    const candidate = review.preview(text.value);
    if (!current(id)) return;
    preview = candidate;
    details.textContent = describeWalletSetupReview(preview);
    status.textContent = "まだ設定は変更していません。変更内容を確認してください。";
    controls();
  });
  const apply = button("apply", "確認した設定をカードへ反映", id => {
    if (!confirmed.checked || !preview) throw Error("Confirmation required");
    const candidate = preview;
    // Clear UI authorization before entering the application callback.
    preview = null;
    confirmed.checked = false;
    controls();
    const result = review.apply(candidate.id, text.value);
    if (!current(id)) return;
    details.textContent = "";
    if (!refresh(id) || !current(id)) return;
    status.textContent = result.changedAgents.length
      ? result.changedAgents.join("・") + "の設定を反映しました。必要なカードで改めてWalletを選び、接続してください。"
      : "設定の変更はありませんでした。既存の接続と履歴は維持しています。";
  });
  const cancel = button("cancel", "プレビューを取り消す", id => {
    reader.cancel();
    if (!current(id)) return;
    cancelPreview(false);
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
      status.textContent = diagnostic(state.errorCode, "設定ファイルを読み込めませんでした。カード設定は保持しています。");
    }
  } });
  function controls() {
    if (disposed) return;
    file.disabled = busy;
    inspect.disabled = busy;
    apply.disabled = busy || !preview || !confirmed.checked;
    confirmed.disabled = busy || !preview;
    section.setAttribute("aria-busy", String(busy));
  }
  function cancelPreview(advance = true) {
    if (advance) generation++;
    review.cancel();
    preview = null;
    confirmed.checked = false;
    details.textContent = "";
    controls();
  }
  function refresh(id = generation) {
    if (!current(id) || refreshing) return false;
    refreshing = true;
    try {
      const result = inspectWalletFields(readCurrentFields());
      if (!current(id)) return false;
      const labels = { missing: "未設定", invalid: "公開アドレスの形式が不正", configured: "設定済み・接続未確認" };
      readiness.textContent = "カードの設定: " + result.configured + " / 3\n異なる公開アドレス: " + result.distinctAccounts +
        "（同じ口座を複数カードで使えます）\n" +
        result.entries.map(row => row.agent + ": " + labels[row.status] + (row.sharedAccount ? "・他のカードと口座を共用" : "") + " / " +
          (row.chainId === 84532 ? "Base Sepolia" : "Base Mainnet")).join("\n");
      return true;
    } catch {
      if (current(id)) {
        readiness.textContent = "カード設定を確認できませんでした。入力を確認してください。";
        status.textContent = "設定状況を確認できませんでした。各カードの入力を確認してください。";
      }
      return false;
    } finally { refreshing = false; }
  }
  listen(confirmed, "change", controls);
  listen(text, "input", () => {
    const id = ++generation;
    busy = false;
    cancelPreview(false);
    if (!current(id)) return;
    status.textContent = "JSONが変わりました。もう一度プレビューしてください。";
    reader.cancel();
  });
  listen(file, "change", () => {
    const selected = file.files;
    if (!selected?.length) return;
    const count = selected.length, chosen = selected[0];
    const id = ++generation;
    busy = false;
    cancelPreview(false);
    if (!current(id)) return;
    reader.cancel();
    if (!current(id)) return;
    file.value = "";
    if (count !== 1) {
      status.textContent = "設定ファイルは1つずつ選んでください。";
    } else void reader.load(chosen);
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
      const id = ++generation;
      reader.cancel();
      if (!current(id)) return;
      cancelPreview(false);
      refresh(id);
      if (!current(id)) return;
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

const ACCOUNT_MESSAGES = Object.freeze({
  __proto__: null,
  NO_PROVIDER: '接続するWalletを選んでください。',
  NO_ACCOUNTS: 'このサイトで許可済みのアカウントはありません。Wallet側の接続許可を確認してください。',
  UNSUPPORTED_CHAIN: 'Walletのこのサイト向けネットワークは対応範囲外です。接続サイトの設定でBase MainnetまたはBase Sepoliaを選んでください。',
  WRONG_CHAIN: 'Walletのこのサイト向けネットワークと、このカードのチェーンが違います。確認したいネットワークに両方をそろえて、もう一度読み取ってください。',
  READ_TIMEOUT: 'Walletからの応答待ちを終了しました。接続状態を確認して再度読み取ってください。',
  RPC_CAPACITY: 'Walletに未完了の要求が残っています。完了後に読み直してください。',
  ACCESS_LOCKED: '読み取りを停止しました。接続保護とカードの状態を確認してください。',
  SESSION_CHANGED: '読み取り中に対象が変わりました。内容を確認して読み直してください。',
});

export function mountPermittedAccountPanel({ document, parent, siteOrigin,
  readContext, canRead, applyAccount, supervisor }) {
  const section = document.createElement('section');
  section.className = 'account-probe-panel';
  section.setAttribute('aria-label', '許可済みアカウントの確認');
  function node(tag, name, text) {
    const element = document.createElement(tag);
    element.className = 'account-probe-' + name;
    if (text) element.textContent = text;
    section.append(element);
    return element;
  }
  node('p', 'help', 'このサイトで許可済みの公開アドレスをWalletから読み取れます。表示と確認だけでは接続しません。');
  node('p', 'site-origin', 'この画面の接続先: ' + siteOrigin);
  node('p', 'site-help', 'MetaMaskでは、接続サイトのアイコンから、このサイト向けのネットワークと口座の許可を確認してください。資産一覧の表示を切り替えても、このサイトの接続先は変わらない場合があります。');
  const read = node('button', 'read', 'Walletの許可済みアドレスを確認');
  const details = node('pre', 'details');
  const apply = node('button', 'apply', '確認した公開アドレスを入力');
  const cancel = node('button', 'cancel', 'アドレス確認を取り消す');
  for (const button of [read, apply, cancel]) button.type = 'button';
  const status = node('p', 'status', '未確認です。アカウント名はWallet側で確認してください。');
  status.setAttribute('role', 'status');
  parent.append(section);
  let generation = 0, disposed = false, busy = false, preview = null, operation = null;
  const contextKeys = ['provider', 'account', 'chainId'];
  const same = (a, b) => !!a && !!b && contextKeys.every(key => a[key] === b[key]);
  function allowed() { try { const result = canRead(); return observeCallbackResult(result) === "synchronous" && result === true; } catch { return false; } }
  function refresh() {
    if (disposed) return;
    const access = allowed();
    read.disabled = busy || !access;
    apply.disabled = busy || !access || !preview || preview.result.chainId !== preview.context.chainId;
    cancel.disabled = !busy && !preview;
  }
  function invalidate(message = '確認内容を取り消しました。カードの設定は変更していません。') {
    generation++;
    const previous = operation;
    operation = null;
    preview = null;
    busy = false;
    details.textContent = '';
    previous?.cancel();
    if (!disposed) { status.textContent = message; refresh(); }
  }
  function current(id, context) {
    if (disposed || id !== generation || !allowed()) return false;
    const matches = same(context, readContext());
    return matches && !disposed && id === generation;
  }
  async function run(confirm) {
    if (disposed || busy || !allowed()) return;
    const reviewed = confirm ? preview : null;
    if (confirm && !reviewed) return;
    const id = ++generation;
    let context;
    try { context = { ...readContext() }; } catch { status.textContent = ACCOUNT_MESSAGES.NO_PROVIDER; return; }
    if (confirm && !same(context, reviewed.context)) { invalidate(ACCOUNT_MESSAGES.SESSION_CHANGED); return; }
    preview = null;
    busy = true;
    details.textContent = '';
    status.textContent = confirm ? '反映前に、許可済みの対象をもう一度確認しています。' : '許可済みの公開アドレスを読み取っています。';
    refresh();
    try {
      operation = startPermittedAccountRead({ provider: context.provider, siteOrigin, supervisor,
        isCurrent: () => current(id, context) });
      const result = await operation.promise;
      if (!current(id, context)) throw Object.assign(new Error("SESSION_CHANGED"), { code: "SESSION_CHANGED" });
      if (confirm) {
        if (result.account !== reviewed.result.account || result.chainId !== reviewed.result.chainId)
          throw Object.assign(new Error('SESSION_CHANGED'), { code: 'SESSION_CHANGED' });
        if (result.chainId !== context.chainId) throw Object.assign(new Error('WRONG_CHAIN'), { code: 'WRONG_CHAIN' });
        const checkCurrent = () => { if (!current(id, context)) throw Object.assign(new Error('SESSION_CHANGED'), { code: 'SESSION_CHANGED' }); };
        applyAccount(result, checkCurrent);
        if (!disposed && id === generation) status.textContent = '公開アドレスを入力しました。内容を確認して「接続」へ進めます。履歴は変更していません。';
      } else {
        preview = { context, result };
        details.textContent = '取得時点でWalletが最初に返した公開アドレス\n' + result.account +
          '\nWalletがこのサイトへ返したネットワーク: ' + (result.chainId === 8453 ? 'Base Mainnet' : 'Base Sepolia') +
          '\nこのカードで確認するネットワーク: ' + (context.chainId === 8453 ? 'Base Mainnet' : context.chainId === 84532 ? 'Base Sepolia' : '未選択・対応範囲外') +
          '\n許可済みアドレス数: ' + result.permittedAccountCount;
        status.textContent = result.chainId === context.chainId
          ? '公開アドレスを確認してください。入力欄と接続状態はまだ変更していません。'
          : ACCOUNT_MESSAGES.WRONG_CHAIN;
      }
    } catch (error) {
      if (!disposed && id === generation) {
        preview = null;
        details.textContent = '';
        status.textContent = ACCOUNT_MESSAGES[readOwnErrorCode(error)] ?? '許可済みアドレスを確認できませんでした。Walletの接続状態を確認してください。';
      }
    } finally {
      if (!disposed && id === generation) { busy = false; operation = null; refresh(); }
    }
  }
  const readAction = () => { void run(false); };
  const applyAction = () => { void run(true); };
  const cancelAction = () => invalidate();
  read.addEventListener('click', readAction);
  apply.addEventListener('click', applyAction);
  cancel.addEventListener('click', cancelAction);
  refresh();
  return Object.freeze({ element: section, refresh, invalidate, dispose() {
    disposed = true;
    invalidate();
    read.removeEventListener('click', readAction);
    apply.removeEventListener('click', applyAction);
    cancel.removeEventListener('click', cancelAction);
    section.remove();
  } });
}
