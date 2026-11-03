import { parseSecurityJson } from '../src/security-json.js';
import { createFileReadScope } from '../src/security-file.js';
import { SIMULATION_PLAN_FILE_SCHEMA, inspectProposalSimulationPlanFile } from '../src/proposal-simulation-plan.js';
import { PROPOSAL_FEE_SCHEMA, PROPOSAL_FEE_FILE_SCHEMA, PROPOSAL_FEE_FILE_LIMIT, validateProposalFeeObservation, prepareProposalFeeReview, inspectProposalFeeReviewFile } from '../src/proposal-fee-review.js';
import { offerWalletDownload } from './export-download.js';
import { requireSyncExport } from '../src/export-policy.js';
import { requestProposalFeeReview } from '../src/proposal-fee-client.js';
const REASONS = {
  FEE_PLAN_BLOCKED: '元の提案に不足・不一致・期限超過があります。', FEE_PLAN_MISMATCH: '費用記録がこの提案の検証用データと一致しません。',
  FEE_BLOCK_MISMATCH: '対象のネットワークまたはブロックが一致しません。', FEE_OBSERVATION_BEFORE_PLAN: '費用の取得時刻が検証用データの作成より前です。',
  FEE_OBSERVATION_FUTURE: '費用の取得時刻が未来になっています。', FEE_OBSERVATION_EXPIRED: '費用の取得から許容時間が経過しました。',
  FEE_L1_UNKNOWN: 'L1への記録費用の上限が未確認です。', FEE_OPERATOR_UNKNOWN: '運営者費用の上限が未確認です。',
  FEE_GAS_LIMIT_EXCEEDED: '必要な処理量が設定したガス上限を超えています。', FEE_PRICE_CAP_EXCEEDED: 'ガス単価が設定上限を超えています。',
  FEE_L1_BUDGET_EXCEEDED: 'L1への記録費用が予算を超えています。', FEE_OPERATOR_BUDGET_EXCEEDED: '運営者費用が予算を超えています。',
  FEE_POLICY_TOTAL_EXCEEDED: '費用が使用条件の合計上限を超えています。',
};
const ENVIRONMENT = { 'isolated-evm': '独立したテスト環境', 'synthetic-test': '模擬データ', 'public-rpc': '公開情報として記録されたデータ' };
function eth(raw) { if (raw === null) return '未確認'; const s = raw.padStart(19, '0'), fraction = s.slice(-18).replace(/0+$/, ''); return s.slice(0, -18) + (fraction ? '.' + fraction : '') + ' ETH'; }
export function mountProposalFeePage(document, { prepare = prepareProposalFeeReview, inspectSaved = inspectProposalFeeReviewFile, read = requestProposalFeeReview, download = offerWalletDownload } = {}) {
  const get = name => document.getElementById('fee-' + name), reader = createFileReadScope(), removers = [];
  let revision = 0, disposed = false, controller = null, pending = null, prepared = null, savedAge = null;
  const current = own => !disposed && revision === own;
  function buttons(busy = false) { get('read').disabled = busy || !pending; get('check').disabled = busy || !pending?.observation; get('save').disabled = !prepared; }
  function reset(clear = false) {
    revision++; reader.cancel(); controller?.abort(); controller = null; prepared = null; savedAge = null;
    if (clear) { pending = null; get('preview').hidden = true; }
    get('result').hidden = true; get('save-status').textContent = ''; get('reasons').replaceChildren(); buttons();
  }
  function age() { const s = get('age').value.trim(); if (!/^[1-9][0-9]{0,2}$/.test(s) || Number(s) > 600) throw Error('AGE'); return Number(s); }
  function show(result, historical) {
    get('period').textContent = historical ? '保存時の結果（現在の再確認はまだです）' : '現在の時刻による照合結果';
    get('outcome').textContent = result.checksSatisfied ? '記録された費用は設定上限の範囲内です。' : '未確認・上限超過・期限などの問題があります。';
    get('environment').textContent = '記録の対象：' + ENVIRONMENT[result.environment];
    get('execution').textContent = '実行費用の上限：' + eth(result.l2FeeCeilingWei);
    get('extra').textContent = 'L1記録費用の上限：' + eth(result.observation.l1FeeUpperBoundWei) + ' / 運営者費用の上限：' + eth(result.observation.operatorFeeUpperBoundWei);
    get('total').textContent = '予備費を含む合計上限：' + eth(result.totalFeeUpperBoundWei);
    get('budget').textContent = '使用条件で設定した合計上限：' + eth(result.limits?.policyMaxTotalFeeWei ?? null);
    get('time').textContent = '費用取得：' + new Date(result.observation.observedAtSeconds * 1000).toISOString() + ' / 照合：' + new Date(result.evaluatedAtSeconds * 1000).toISOString();
    get('reasons').replaceChildren(...result.reasons.map(code => { const li = document.createElement('li'); li.textContent = REASONS[code] ?? code; return li; }));
    get('result').hidden = false;
  }
  const listen = (name, event, fn) => { const handler = () => { if (!disposed) return fn(); }; get(name).addEventListener(event, handler); removers.push(() => get(name).removeEventListener(event, handler)); };
  listen('age', 'input', () => { reset(); get('status').textContent = '比較条件が変わりました。再照合してください。'; });
  listen('files', 'change', async () => {
    const selected = Array.from(get('files').files ?? []); if (!selected.length) return;
    reset(true); get('files').value = ''; const own = revision, c = new AbortController(); controller = c;
    get('status').textContent = '資料を確認しています。';
    try {
      if (selected.length > 2) throw Error('FILES');
      const texts = [];
      for (const file of selected) { const text = await reader.readText(file, { maxBytes: PROPOSAL_FEE_FILE_LIMIT }); if (!current(own)) return; texts.push(text); }
      let files, stored;
      if (texts.length === 1 && parseSecurityJson(texts[0])?.schema === PROPOSAL_FEE_FILE_SCHEMA) {
        stored = await inspectSaved(texts[0], { signal: c.signal }); if (!current(own)) return; files = stored.files;
      } else if (texts.length === 1 && parseSecurityJson(texts[0])?.schema === SIMULATION_PLAN_FILE_SCHEMA) {
        files = { simulationPlanFile: texts[0], observation: null };
      } else if (texts.length === 2) {
        let simulationPlanFile, observation;
        for (const text of texts) {
          const raw = parseSecurityJson(text);
          if (raw?.schema === SIMULATION_PLAN_FILE_SCHEMA && !simulationPlanFile) simulationPlanFile = text;
          else if (raw?.schema === PROPOSAL_FEE_SCHEMA && !observation) observation = validateProposalFeeObservation(raw);
          else throw Error('SCHEMAS');
        }
        if (!simulationPlanFile || !observation) throw Error('PAIR'); files = { simulationPlanFile, observation };
      } else throw Error('FILES');
      const checked = await inspectProposalSimulationPlanFile(files.simulationPlanFile, { signal: c.signal }); if (!current(own)) return;
      pending = files; const p = checked.recordedPlan;
      get('context').textContent = p.agent + ' / ' + p.recipient;
      get('preview').hidden = false;
      if (stored) {
        get('age').value = String(stored.recordedResult.maxObservationAgeSeconds); savedAge = age(); prepared = { text: texts[0], result: stored.recordedResult };
        show(stored.recordedResult, true); get('status').textContent = '保存時の結果を再計算し、一致を確認しました。現在の時刻でも再照合できます。';
      } else get('status').textContent = files.observation ? '2つの資料を読み込みました。現在の時刻で照合してください。' : '検証用データを読み込みました。公開情報から費用を取得できます。';
      buttons();
    } catch { if (current(own)) { reset(true); get('status').textContent = '読み込めませんでした。検証用データ・費用の保存記録1個、または検証用データと費用記録の2個を選んでください。'; } }
    finally { c.abort(); if (current(own)) controller = null; }
  });
  async function run(acquire) {
    if (!pending || (!acquire && !pending.observation)) return; reset(); const own = revision, source = pending; let maxAge;
    try { maxAge = age(); } catch { get('status').textContent = '時間を1〜600秒の整数で入力してください。'; return; }
    const c = new AbortController(); controller = c; buttons(true); get('status').textContent = acquire ? '同じブロックの費用取得とシミュレーションを行っています。' : '元の資料と費用を再照合しています。';
    try {
      let files = source;
      if (acquire) {
        const text = await read(source.simulationPlanFile, { signal: c.signal }); if (!current(own)) return;
        const verified = await inspectSaved(text, { signal: c.signal }); if (!current(own)) return;
        if (verified.files.simulationPlanFile !== source.simulationPlanFile || verified.recordedResult.environment !== 'public-rpc') throw Error('FEE_CONTEXT');
        files = verified.files;
      }
      const checked = await prepare(files, { maxObservationAgeSeconds: maxAge, signal: c.signal }); if (!current(own)) return;
      if (age() !== maxAge) { reset(); get('status').textContent = '比較条件が変わりました。再照合してください。'; return; }
      pending = files; prepared = checked; savedAge = maxAge; show(checked.result, false); get('status').textContent = '照合が終わりました。元の資料と結果を保存できます。';
    } catch { if (current(own)) get('status').textContent = acquire ? '取得できませんでした。元の資料の期限・条件、接続先の対応を確認してください。資料は保持しています。' : '照合できませんでした。元の資料を保持しています。再試行できます。'; }
    finally { c.abort(); if (current(own)) { controller = null; buttons(); } }
  }
  listen('read', 'click', () => run(true)); listen('check', 'click', () => run(false));
  listen('save', 'click', () => {
    if (!prepared) return; const own = revision;
    try {
      if (age() !== savedAge) { reset(); get('status').textContent = '比較条件が変わりました。再照合してください。'; return; }
      requireSyncExport(download({ document, prepared: { text: prepared.text, filename: 'ThreeCore-proposal-fee-review.json', mimeType: 'application/json' } }));
      if (current(own)) get('save-status').textContent = '保存を開始しました。保存先のファイルを確認してください。';
    } catch { if (current(own)) get('save-status').textContent = '保存できませんでした。結果は保持しています。'; }
  });
  listen('cancel', 'click', () => { reset(true); get('status').textContent = '取り消しました。元のファイルは変更していません。'; });
  const view = document.defaultView;
  if (view?.addEventListener && view?.removeEventListener) { const hide = () => { reset(true); get('status').textContent = '資料を読み直してください。'; }; view.addEventListener('pagehide', hide); removers.push(() => view.removeEventListener('pagehide', hide)); }
  buttons(); return Object.freeze({ dispose() { if (disposed) return; disposed = true; reset(true); removers.forEach(fn => fn()); } });
}
if (typeof document !== 'undefined') mountProposalFeePage(document);
