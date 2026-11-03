import { parseSecurityJson } from '../src/security-json.js';
import { createFileReadScope } from '../src/security-file.js';
import { SIMULATION_PLAN_FILE_SCHEMA, inspectProposalSimulationPlanFile } from '../src/proposal-simulation-plan.js';
import { PROPOSAL_STATE_FILE_SCHEMA, PROPOSAL_STATE_FILE_LIMIT, prepareProposalStateReview, inspectProposalStateReviewFile } from '../src/proposal-state-review.js';
import { requestProposalStateReview } from '../src/proposal-state-client.js';
import { offerWalletDownload } from './export-download.js';
import { requireSyncExport } from '../src/export-policy.js';
const REASONS = {
  STATE_SOURCE_BLOCKED: '元の提案の前提条件が満たされていません。', STATE_WINDOW_CLOSED: '元の提案の有効期限が過ぎています。', STATE_SOURCE_MISMATCH: '元の資料と取得記録が一致しません。',
  STATE_SOURCE_REORG: '元のブロックを正規の履歴として確認できません。', STATE_BLOCK_ORDER: '取得ブロックの順序が一致しません。', STATE_TIME_ORDER: '資料と取得記録の時刻が一致しません。', STATE_STALE: '取得情報の有効時間（60秒）を過ぎています。',
  STATE_TOKEN_MISSING: 'トークンの契約が確認できません。', STATE_ROUTER_MISSING: '交換先の契約が確認できません。', STATE_ALLOWANCE_SHORTFALL: '現在の許可額が不足しています。',
  STATE_BUDGET_MISSING: '元の予算が見つかりません。', STATE_TOKEN_RESERVATION_SHORTFALL: '確保済み予算を含めると、トークンの残高が不足しています。', STATE_NATIVE_RESERVATION_SHORTFALL: '確保済み予算を含めると、ETHの残高が不足しています。',
  STATE_PRICE_CAP: '現在のガス単価が上限を超えています。', STATE_FEES_UNKNOWN: '費用の一部が未確認です。', STATE_RESERVED_FEES_UNKNOWN: '確保済み予算に未確認の費用があります。',
  STATE_L1_BUDGET: 'L1記録費用が予算を超えています。', STATE_OPERATOR_BUDGET: '運営者費用が予算を超えています。', STATE_TOTAL_CAP: '費用が合計上限を超えています。', STATE_AMOUNT_OVERFLOW: '合計金額が取り扱い範囲を超えています。',
  STATE_GAS_LIMIT: '必要な処理量が上限を超えています。', STATE_MINIMUM_OUTPUT: '受取額が元の最低額を下回っています。', STATE_SIMULATION_REJECTED: 'シミュレーションを完了できませんでした。', STATE_SIMULATION_MISSING: '条件不足のため、交換のシミュレーションは行っていません。',
};
const amount = (n, decimals) => { if (n === null) return '未確認'; const str = n.padStart(decimals + 1, '0'), fraction = str.slice(-decimals).replace(/0+$/, ''); return str.slice(0, -decimals) + (fraction ? '.' + fraction : ''); };
export function mountProposalStatePage(document, { read = requestProposalStateReview, download = offerWalletDownload } = {}) {
  const el = n => document.getElementById('state-' + n), reader = createFileReadScope(), removers = [];
  let revision = 0, disposed = false, controller, files, prepared, decimals = 18, asset = '';
  const live = v => !disposed && v === revision;
  const buttons = (busy = false) => { el('read').disabled = busy || !files; el('check').disabled = busy || !files?.observation; el('save').disabled = !prepared; };
  function reset(clear) { revision++; reader.cancel(); controller?.abort(); controller = null; prepared = null; if (clear) { files = null; el('context').textContent = ''; } el('result').hidden = true; el('save-status').textContent = ''; buttons(); }
  function show(result, historical) {
    const o = result.observation;
    el('period').textContent = historical ? '保存時の確認結果' : '今回の確認結果';
    el('outcome').textContent = result.checksSatisfied ? 'このブロックでは、確認した条件を満たしています。' : '不足や期限など、進められない理由があります。';
    el('block').textContent = (o.environment === 'public-rpc' ? '公開情報の記録' : 'テスト環境の記録') + ' / ブロック ' + o.blockNumber;
    el('balances').textContent = asset + '残高：' + amount(o.tokenBalanceBaseUnits, decimals) + ' / ' + asset + '許可額：' + amount(o.allowanceBaseUnits, decimals) + ' / ETH残高：' + amount(o.nativeBalanceWei, 18);
    el('required').textContent = '確保済み予算を含む必要量：' + amount(result.tokenRequiredBaseUnits, decimals) + ' ' + asset + ' / ' + amount(result.nativeRequiredWei, 18) + ' ETH';
    el('fee').textContent = 'この提案のガス上限と予備費を含む費用枠：' + amount(result.feeCeilingWei, 18) + ' ETH';
    el('simulation').textContent = 'シミュレーション：' + ({ skipped: '未実施', rejected: '完了できず', succeeded: '完了（取引送信なし）' })[o.simulation.status];
    el('time').textContent = '取得：' + new Date(o.observedAtSeconds * 1000).toISOString() + ' / 元の期限：' + new Date(result.deadlineSeconds * 1000).toISOString();
    el('reasons').replaceChildren(...result.reasons.map(code => { const li = document.createElement('li'); li.textContent = REASONS[code] ?? code; return li; })); el('result').hidden = false;
  }
  const listen = (n, event, f) => { const fn = () => { if (!disposed) return f(); }; el(n).addEventListener(event, fn); removers.push(() => el(n).removeEventListener(event, fn)); };
  listen('file', 'change', async () => {
    const chosen = Array.from(el('file').files ?? []); if (!chosen.length) return; reset(true); el('file').value = ''; const own = revision, c = new AbortController(); controller = c; el('status').textContent = '資料を確認しています。';
    try {
      if (chosen.length !== 1) throw Error(); const text = await reader.readText(chosen[0], { maxBytes: PROPOSAL_STATE_FILE_LIMIT }); if (!live(own)) return;
      const type = parseSecurityJson(text)?.schema; let saved, input;
      if (type === PROPOSAL_STATE_FILE_SCHEMA) { saved = await inspectProposalStateReviewFile(text, { signal: c.signal }); input = saved.files; }
      else if (type === SIMULATION_PLAN_FILE_SCHEMA) input = { simulationPlanFile: text, observation: null }; else throw Error();
      const source = await inspectProposalSimulationPlanFile(input.simulationPlanFile, { signal: c.signal }); if (!live(own)) return;
      decimals = source.recordedPlan.route.from === '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913' ? 6 : 18;
      asset = decimals === 6 ? 'USDC' : source.recordedPlan.agent;
      files = input; el('context').textContent = source.recordedPlan.agent + ' / 入力資産：' + asset + ' / ' + source.recordedPlan.recipient;
      if (saved) { prepared = { text, result: saved.recordedResult }; show(prepared.result, true); }
      el('status').textContent = saved ? '保存記録の一致を確認しました。新たに取得することもできます。' : '資料を読み込みました。公開情報を取得できます。'; buttons();
    } catch { if (live(own)) { reset(true); el('status').textContent = '読み込めませんでした。検証用データか、この画面で保存した記録を選んでください。'; } }
    finally { c.abort(); if (live(own)) controller = null; }
  });
  async function run(acquire) {
    if (!files || (!acquire && !files.observation)) return; reset(false); const source = files, own = revision, c = new AbortController(); controller = c; buttons(true);
    el('status').textContent = acquire ? '最新の公開情報を読み取り、元の条件と照合しています。' : '保存データを今の時刻で確認しています。';
    try {
      let next = source;
      if (acquire) {
        const text = await read(source.simulationPlanFile, { signal: c.signal }); if (!live(own)) return;
        const saved = await inspectProposalStateReviewFile(text, { signal: c.signal }); if (!live(own)) return;
        if (saved.files.simulationPlanFile !== source.simulationPlanFile || saved.recordedResult.environment !== 'public-rpc') throw Error(); next = saved.files;
      }
      const checked = await prepareProposalStateReview(next, { signal: c.signal }); if (!live(own)) return;
      files = next; prepared = checked; show(checked.result, false); el('status').textContent = '確認が終わりました。元の資料と結果を保存できます。';
    } catch { if (live(own)) el('status').textContent = '確認できませんでした。資料は保持しています。再試行できます。'; }
    finally { c.abort(); if (live(own)) { controller = null; buttons(); } }
  }
  listen('read', 'click', () => run(true)); listen('check', 'click', () => run(false));
  listen('save', 'click', () => { if (!prepared) return; try { requireSyncExport(download({ document, prepared: { text: prepared.text, filename: 'ThreeCore-proposal-state-review.json', mimeType: 'application/json' } })); el('save-status').textContent = '保存を開始しました。保存先を確認してください。'; } catch { el('save-status').textContent = '保存できませんでした。結果は保持しています。'; } });
  listen('cancel', 'click', () => { reset(true); el('status').textContent = '取り消しました。元のファイルは変更していません。'; });
  const view = document.defaultView;
  if (view?.addEventListener && view?.removeEventListener) { const hide = () => reset(true); view.addEventListener('pagehide', hide); removers.push(() => view.removeEventListener('pagehide', hide)); }
  buttons(); return { dispose() { if (disposed) return; disposed = true; reset(true); removers.forEach(f => f()); } };
}
if (typeof document !== 'undefined') mountProposalStatePage(document);
