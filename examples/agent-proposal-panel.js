import { assessAgentReadProposal } from "../src/agent-read-proposal.js";
import { offerWalletDownload } from "./export-download.js";
import { readErrorCode } from "../src/provider-error.js";
import { normalizeAddress } from "../src/wallet-session.js";
import { readSynchronousClock, observeCallbackResult, consumeCallback } from "../src/security-callback.js";
import { parseAgentProposalRecord, AGENT_PROPOSAL_RECORD_LIMIT } from "../src/agent-proposal-record.js";
import { readSecurityFileText } from "../src/security-file.js";
import { createAgentProposalClient } from "../src/agent-proposal-client.js";
import { captureDataRecord } from "../src/security-data.js";
import { parseSecurityJson } from "../src/security-json.js";

const CONTEXT_STATE_KEYS = ["agent", "account", "chainId", "siteOrigin", "connected", "connectionEpoch",
  "canSign", "canSendTransactions", "canBridge"];

/** Explicit read-only UI; no model, wallet connection or network call on mount. */
export function mountAgentProposalPanel({ document, parent, agent, registry, getContext,
  read, onCancel, now = Date.now, readFile = readSecurityFileText,
  proposalTransport = null, newRequestId = () => globalThis.crypto.randomUUID(),
  downloadFile = prepared => offerWalletDownload({ document, prepared }) }) {
  let disposed = false, busy = false, saving = false, importing = false, generation = 0, sequence = 0;
  let lastReport = null, pendingRecord = null, fileAbort = null;
  let modelClient = null, modelBusy = false, lastAttempt = null, modelOperation = null, readingContext = false;
  const listeners = [];
  const make = (tag, name, text) => {
    const node = document.createElement(tag); node.className = "agent-proposal-" + name;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const button = (name, text) => { const node = make("button", name, text); node.type = "button"; return node; };
  const section = make("details", "panel");
  const heading = make("summary", "heading", "AI行動提案の検証（読み取り専用）");
  const note = make("p", "note", "AI自体は未接続です。ローカルの確認用提案、または外部で作った提案JSONを検証します。署名・送金・売買は行いません。");
  const modelSection = make("div", "model-section");
  const objectiveLabel = make("label", "objective-label", "提案サービスへの依頼（秘密情報は入力しないでください）");
  const objective = make("textarea", "objective");objective.maxLength = 2048;objective.rows = 3;
  objective.setAttribute("aria-label",agent + "の提案サービスへの依頼");objectiveLabel.append(objective);
  const modelRequest = button("model-request", "提案を取得する（読取りはまだ実行しない）");
  const modelStatus = make("p", "model-status", "提案サービスは未接続です。");modelStatus.setAttribute("role","status");
  const modelNotice = make("p", "model-notice", "同じ依頼の再確認には同じIDを使います。本文を変更すると別依頼になります。接続だけで通信・署名・送金は開始しません。");
  modelSection.append(objectiveLabel,modelRequest,modelStatus,modelNotice);
  const ageLabel = make("label", "age-label", "提案の有効時間（秒、1～600）");
  const age = make("input", "age"); age.type = "number"; age.min = "1"; age.max = "600"; age.value = "60";
  ageLabel.append(age);
  const apply = button("apply", "上の接続・契約アドレスを読取り範囲として登録");
  const revoke = button("revoke", "このAIの読取り範囲を撤回");
  const policy = make("pre", "policy");
  const build = button("build", "現在の設定から確認用提案を作成");
  const draftLabel = make("label", "draft-label", "提案JSON（確認用提案はAIの判断ではありません）");
  const draft = make("textarea", "draft"); draft.rows = 7; draft.maxLength = 32768; draft.spellcheck = false;
  draft.setAttribute("aria-label", agent + "の行動提案JSON"); draftLabel.append(draft);
  const inspect = button("inspect", "提案を検証して読み取る");
  const cancel = button("cancel", "この読取りを中止");
  const save = button("save", "最後の確認結果をJSONで保存");
  const status = make("p", "status", "読取り範囲は未登録です。");
  status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
  const result = make("pre", "result");
  const fileLabel = make("label", "file-label", "保存した提案記録を読み込む（過去の記録のみ）");
  const file = make("input", "file"); file.type = "file"; file.accept = ".json,application/json";
  file.setAttribute("aria-label", agent + "の保存済み提案記録JSON"); fileLabel.append(file);
  const preview = make("pre", "import-preview");
  const restore = button("restore", "確認した過去の記録を表示");
  const privacy = make("p", "privacy", "結果はこの画面内のみです。保存JSONには公開アドレス・残高・提案が含まれます。既存の一括保存には含まれません。過去の結果は現在の接続や残高を証明しません。");
  section.append(heading, note, ageLabel, apply, revoke, policy, build, draftLabel, inspect, cancel, status, result, save,
    fileLabel, preview, restore, privacy);
  if (proposalTransport !== null) {
    note.textContent = "提案サービスはアプリ側で接続を設定した場合のみ利用できます。受け取った提案はこの画面で照合します。取得だけではWalletを操作しません。";
    section.append(modelSection);
  }
  parent.append(section);
  const listen = (node, type, fn) => {
    node.addEventListener(type, fn); listeners.push(() => node.removeEventListener(type, fn));
  };
  const refresh = () => {
    if (disposed) return;
    const current = registry.read(agent);
    policy.textContent = current ? JSON.stringify(current, null, 2) : "読取り範囲は未登録です。";
    section.setAttribute("aria-busy", String(busy || saving || importing || modelBusy));
    apply.disabled = busy || importing || modelBusy; build.disabled = busy || importing || modelBusy || !current; inspect.disabled = busy || importing || modelBusy || !current || !draft.value;
    revoke.disabled = !current; cancel.disabled = !busy && !importing && !modelBusy; draft.disabled = busy || importing || modelBusy; age.disabled = busy || importing || modelBusy;
    save.disabled = saving || !lastReport;
    file.disabled = busy || saving || importing || modelBusy; restore.disabled = busy || saving || importing || modelBusy || !pendingRecord;
    const sourceReady = modelClient && !["disabled","unavailable","revoked","disposed"].includes(modelClient.state.status);
    modelRequest.disabled = !sourceReady || !current || !objective.value.trim() || modelBusy || busy || importing || saving;
    objective.disabled = modelBusy || busy || importing;
    modelRequest.textContent = lastAttempt?.objective === objective.value ? "同じ依頼の結果を再確認" : "提案を取得する（読取りはまだ実行しない）";
  };
  const stop = () => {
    generation++;
    fileAbort?.abort(); fileAbort = null; importing = false;
    modelClient?.cancel();modelBusy = false;modelOperation = null;
    const wasBusy = busy; busy = false;
    if (wasBusy) consumeCallback(() => onCancel());
  };
  const invalidate = () => {
    if (disposed) return;
    stop(); registry.revoke(agent);modelClient?.revoke();
    status.textContent = "設定・接続が変わったため読取り範囲を撤回しました。過去の結果は残しています。";
    refresh();
  };
  const error = e => {
    const code = readErrorCode(e);
    status.textContent = "確認できませんでした。設定・接続・提案の期限を確認してください。" +
      (typeof code === "string" && /^[A-Z_]{1,64}$/.test(code) ? "（" + code + "）" : "");
  };
  const configuredContext = (context = getContext()) => {
    const p = registry.read(agent);
    if (!p || p.targets.length !== 1 || normalizeAddress(context.tokenAddress) !== p.targets[0].tokenAddress ||
        normalizeAddress(context.spenderAddress) !== p.targets[0].spenderAddress) {
      throw Object.assign(Error("Configured target changed"), { code: "TARGET_FIELDS_CHANGED" });
    }
    return context;
  };
  // Caller-owned composition data only. This snapshot is not authentication,
  // a grant, or a mutable reference to the card's session or policy registry.
  const readProposalContext = () => {
    if (disposed || readingContext) return null;
    const token = generation, current = () => !disposed && generation === token;
    readingContext = true;
    try {
      const policyText = registry.readPolicyText(agent);
      if (!current() || typeof policyText !== "string") return null;
      const policy = parseSecurityJson(policyText, { bytes: 32768, depth: 5, nodes: 512 });
      const capture = () => {
        const value = getContext();
        if (observeCallbackResult(value) !== "synchronous") throw Error("Context must be synchronous");
        const context = captureDataRecord(value, ["connection", "tokenAddress", "spenderAddress"]);
        const connection = Object.freeze({ ...captureDataRecord(context.connection, CONTEXT_STATE_KEYS) });
        return Object.freeze({ ...context, connection });
      };
      const first = capture();
      if (!current()) return null;
      configuredContext(first);
      const time = readSynchronousClock(now);
      if (!current()) return null;
      const proposalText = JSON.stringify({ schema: "threecore-agent-read-proposal-v1", id: "context-snapshot-check",
        agent, account: policy.account, chainId: policy.chainId, siteOrigin: policy.siteOrigin,
        connectionEpoch: first.connection.connectionEpoch, policyRevision: policy.revision,
        createdAtMs: time, expiresAtMs: time + Math.min(policy.maxProposalAgeMs, 60000),
        rationale: "Validate caller-owned read context without executing a read",
        action: { kind: "inspect-spender", ...policy.targets?.[0] } });
      assessAgentReadProposal(proposalText, policyText, first.connection, time);
      const commitTime = readSynchronousClock(now), latest = capture();
      if (!current() || commitTime < time || JSON.stringify(first) !== JSON.stringify(latest)) return null;
      configuredContext(latest);
      assessAgentReadProposal(proposalText, policyText, latest.connection, commitTime);
      if (registry.readPolicyText(agent) !== policyText || !current()) return null;
      return Object.freeze({ policyText, sessionState: latest.connection });
    } catch { return null; }
    finally { readingContext = false; }
  };
  const revokeProposalGrant = () => {
    if (disposed || !modelClient) return false;
    // Detach the old panel operation before abort callbacks can start new work.
    // Revoking transport does not revoke local policy or erase a draft/history.
    modelBusy = false; modelOperation = null;
    modelClient.revoke(); refresh();
    return !disposed;
  };
  const captureEntryGuard = () => {
    const token = generation, previousDraft = draft.value, previousPolicy = registry.readPolicyText(agent);
    return () => !disposed && !busy && !importing && !modelBusy && token === generation &&
      draft.value === previousDraft && registry.readPolicyText(agent) === previousPolicy;
  };
  listen(apply, "click", () => {
    if (disposed || busy || importing || modelBusy) return;
    const current = captureEntryGuard();
    try {
      const context = getContext(); const s = context.connection;
      if (!s?.connected || s.agent !== agent) throw Error("Connection required");
      if (!/^[1-9][0-9]{0,2}$/.test(age.value) || Number(age.value) > 600) throw Error("Invalid age");
      const configText = JSON.stringify({ schema: "threecore-agent-read-config-v1", agent,
        account: s.account, chainId: s.chainId, siteOrigin: s.siteOrigin,
        maxProposalAgeMs: Number(age.value) * 1000,
        targets: [{ tokenAddress: context.tokenAddress, spenderAddress: context.spenderAddress }] });
      if (!current()) return;
      registry.set(agent, configText);
      generation++;
      draft.value = "";
      status.textContent = "読取り範囲を登録しました。接続・送金の権限を追加したわけではありません。";
      modelClient?.revoke();
    } catch (e) { if (current()) error(e); }
    refresh();
  });
  listen(revoke, "click", invalidate);
  listen(age, "input", invalidate);
  listen(build, "click", () => {
    if (disposed || busy || importing || modelBusy) return;
    const current = captureEntryGuard();
    try {
      const firstTime = readSynchronousClock(now);
      if (!current()) return;
      const p = registry.read(agent);
      configuredContext();
      const time = readSynchronousClock(now), s = configuredContext().connection;
      if (!p || !s?.connected || !Number.isSafeInteger(firstTime) || firstTime < 0 ||
          !Number.isSafeInteger(time) || time < firstTime) throw Error("Context required");
      const text = JSON.stringify({ schema: "threecore-agent-read-proposal-v1", id: `${agent}-${time}-${++sequence}`,
        agent, account: p.account, chainId: p.chainId, siteOrigin: p.siteOrigin,
        connectionEpoch: s.connectionEpoch, policyRevision: p.revision, createdAtMs: time,
        expiresAtMs: time + p.maxProposalAgeMs, rationale: "Locally generated read-only verification proposal; not an AI decision.",
        action: { kind: "inspect-spender", ...p.targets[0] } }, null, 2);
      assessAgentReadProposal(text, registry.readPolicyText(agent), s, time);
      if (!current()) return;
      generation++;
      draft.value = text; status.textContent = "確認用提案を作成しました。まだ読み取りは実行していません。";
    } catch (e) { if (current()) error(e); }
    refresh();
  });
  listen(draft, "input", () => { if (!disposed) { stop(); refresh(); } });
  listen(objective, "input", () => { if (!disposed) refresh(); });
  listen(modelRequest, "click", async () => {
    if (disposed || busy || importing || saving || modelBusy || !modelClient) return;
    const operation = {};modelOperation = operation;modelBusy = true;refresh();
    try {
      if (!lastAttempt || lastAttempt.objective !== objective.value) {
        const id = newRequestId();
        if (observeCallbackResult(id) !== "synchronous" || typeof id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/.test(id)) throw Error("Invalid request identity");
        if (disposed || modelOperation !== operation) return;
        lastAttempt = Object.freeze({requestId:id,objective:objective.value});
      }
      if (disposed || modelOperation !== operation) return;
      await modelClient.request(lastAttempt);
    } catch {if (!disposed && modelOperation === operation) modelStatus.textContent = "提案を取得できませんでした。過去の確認記録は保持しています。";}
    finally {if (!disposed && modelOperation === operation) {modelBusy = false;modelOperation = null;refresh();}}
  });
  listen(cancel, "click", () => { if (!disposed) { stop(); status.textContent = "読取りを中止しました。過去の結果は残しています。"; refresh(); } });
  listen(inspect, "click", async () => {
    if (disposed || busy || importing || modelBusy) return;
    const token = ++generation, proposalText = draft.value;
    const current = () => !disposed && token === generation && draft.value === proposalText;
    busy = true; status.textContent = "提案を照合して読み取り中です。"; refresh();
    try {
      const policyText = registry.readPolicyText(agent);
      const checkPolicy = () => {
        if (policyText !== registry.readPolicyText(agent)) throw Object.assign(Error("Policy changed"), { code: "POLICY_CHANGED" });
      };
      const assessCurrent = () => {
        checkPolicy();
        const time = readSynchronousClock(now);
        if (!current()) return false;
        const context = configuredContext();
        if (!current()) return false;
        assessAgentReadProposal(proposalText, policyText, context.connection, time);
        const commitTime = readSynchronousClock(now);
        if (!current()) return false;
        assessAgentReadProposal(proposalText, policyText, configuredContext().connection, commitTime);
        if (commitTime < time) throw Object.assign(Error("Clock moved backward"), { code: "CLOCK_MOVED_BACKWARD" });
        if (!current()) return false;
        checkPolicy();
        return true;
      };
      if (!assessCurrent()) return;
      const observation = await read(proposalText, () => registry.readPolicyText(agent), now);
      if (!current() || !assessCurrent()) return;
      const nextReport = parseAgentProposalRecord(JSON.stringify({ schema: "threecore-agent-proposal-ui-record-v1", authenticated: false,
        historicalObservation: true, proposalText, policyText, result: observation }), agent);
      if (!current()) return;
      checkPolicy();
      lastReport = nextReport;
      pendingRecord = null; preview.textContent = "";
      result.textContent = JSON.stringify(lastReport, null, 2);
      status.textContent = "読み取りを確認しました。署名・送金・承認変更は行っていません。";
    } catch (e) { if (current()) error(e); }
    finally { if (!disposed && token === generation) { busy = false; refresh(); } }
  });
  listen(file, "change", async () => {
    if (disposed || busy || saving || importing || modelBusy) return;
    const selected = file.files;
    pendingRecord = null; preview.textContent = "";
    if (!selected || selected.length !== 1) { status.textContent = "記録JSONを1つ選択してください。既存の結果は保持しています。"; refresh(); return; }
    const source = selected[0], token = ++generation;
    const controller = new AbortController(); fileAbort = controller; importing = true;
    status.textContent = "過去の記録を確認中です。接続や読取り範囲は変更しません。"; refresh();
    try {
      const text = await readFile(source, { maxBytes: AGENT_PROPOSAL_RECORD_LIMIT, signal: controller.signal });
      if (disposed || token !== generation) return;
      const record = parseAgentProposalRecord(text, agent);
      pendingRecord = record;
      const o = record.result.observation;
      preview.textContent = `${agent} / ${o.account}\nchain ${o.chainId} / block ${o.blockNumber}\n過去の記録（真正性・現在残高は未検証）。既存の表示結果を置き換える前に確認してください。`;
      status.textContent = "記録の形式と内部整合性を確認しました。まだ表示結果を置き換えていません。";
    } catch (e) { if (!disposed && token === generation) error(e); }
    finally {
      if (!disposed && token === generation) { importing = false; fileAbort = null; file.value = ""; refresh(); }
    }
  });
  listen(restore, "click", () => {
    if (disposed || busy || saving || importing || modelBusy || !pendingRecord) return;
    lastReport = pendingRecord; pendingRecord = null; preview.textContent = "";
    result.textContent = JSON.stringify(lastReport, null, 2);
    status.textContent = "過去の記録を表示しました。現在の接続・残高は未検証です。読取り範囲や接続権限は復元していません。";
    refresh();
  });
  listen(save, "click", async () => {
    if (disposed || saving || !lastReport) return;
    const snapshot = lastReport, token = generation; saving = true; refresh();
    try {
      const text = JSON.stringify(snapshot, null, 2);
      await downloadFile(Object.freeze({ text, byteLength: new TextEncoder().encode(text).length,
        filename: `ThreeCore-${agent}-proposal-${snapshot.result.review.checkedAtMs}.json`, mimeType: "application/json;charset=utf-8" }));
      if (!disposed && token === generation && snapshot === lastReport) status.textContent = "保存ファイルを用意しました。ブラウザーでダウンロード完了を確認してください。";
    } catch { if (!disposed && token === generation) status.textContent = "ダウンロードできませんでした。結果は画面に残っています。"; }
    finally { saving = false; refresh(); }
  });
  // Application-owned delivery hook for a future model bridge. Stages data
  // only; never executes, auto-connects, renews expiry or imports model policy.
  const stageProposal = text => {
    if (disposed || busy || importing) return false;
    const token = generation, previousDraft = draft.value;
    const current = () => !disposed && token === generation && draft.value === previousDraft;
    try {
      const policyText = registry.readPolicyText(agent), time = readSynchronousClock(now);
      if (!current()) return false;
      // Either callback can supersede this delivery. Recheck expiry after
      // resolving context, without invoking that context callback again.
      const context = configuredContext();
      assessAgentReadProposal(text, policyText, context.connection, time);
      const commitTime = readSynchronousClock(now);
      assessAgentReadProposal(text, policyText, configuredContext(context).connection, commitTime);
      if (commitTime < time || !current() || policyText !== registry.readPolicyText(agent)) return false;
      generation++;
      draft.value = text;
      status.textContent = "外部の提案を照合して入力欄に反映しました。まだ読み取りは実行していません。";
      refresh(); return true;
    } catch (e) { if (current()) { error(e); refresh(); } return false; }
  };
  if (proposalTransport !== null) {
    modelClient = createAgentProposalClient({agent,origin:proposalTransport.origin,enabled:proposalTransport.enabled??false,
      ...(proposalTransport.fetchImpl?{fetchImpl:proposalTransport.fetchImpl}:{}),
      ...(proposalTransport.timeoutMs?{timeoutMs:proposalTransport.timeoutMs}:{}),
      readContext:()=>({policyText:registry.readPolicyText(agent),sessionState:configuredContext().connection}),stageProposal,now,
      onChange:state=>{
        if (disposed) return;
        const messages = {ready:"提案サービスの接続枠を受け取りました。まだ通信していません。",requesting:"提案を取得中です。Walletは操作しません。",
          staged:"提案を入力欄に反映しました。読取りはまだ実行していません。",pending:"同じ依頼が処理中です。自動再送はしません。",
          abstained:"提案サービスは今回は提案しませんでした。",cancelled:"取得を中止しました。実行済みか不明な通信は再実行扱いにしません。",
          revoked:"接続または設定が変わったため、提案サービスの接続枠を無効化しました。",rejected:"提案を取得できませんでした。保存済みの確認記録は保持しています。"};
        modelStatus.textContent = messages[state.status]??"提案サービスは未接続です。";refresh();
      }});
  }
  refresh();
  return Object.freeze({ invalidate, refresh, stageProposal, readProposalContext, revokeProposalGrant,
    acceptProposalGrant: grant => !disposed && modelClient?.acceptGrant(grant) === true,
    dispose() { if (disposed) return; disposed = true; stop();modelClient?.dispose(); registry.revoke(agent); for (const remove of listeners) remove(); section.remove(); },
  });
}
