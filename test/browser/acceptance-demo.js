import { makeAcceptanceFixture, DB_PREFIX, AGENTS } from '/test/browser/acceptance-fixture.js';

const url = new URL(location.href);
let run = url.searchParams.get('run');
if (!run || !/^[a-f0-9-]{36}$/.test(run)) {
  run = crypto.randomUUID(); url.searchParams.set('run', run); history.replaceState(null, '', url);
}
let f;
let busy = false;
let reviewed = false;
const status = document.querySelector('#status');
const review = document.querySelector('#review');
const overview = document.querySelector('#overview');
const summaries = AGENTS.map(agent => {
  const article = document.createElement('article');
  const heading = document.createElement('h2'); heading.textContent = agent;
  const pre = document.createElement('pre');
  article.append(heading, pre); overview.append(article); return pre;
});
function render() {
  if (!f) return;
  summaries.forEach((pre, index) => {
    const output = f.card(index, 'output').textContent;
    pre.textContent = (output.includes('接続済み') ? '接続済み' : '未接続') + '\n' +
      '設定: ' + (f.card(index, '.account').value ? '別アドレスを設定済み' : '未設定') + '\n' +
      '履歴: ' + f.card(index, '.history-list').children.length + '件\n' +
      'ネットワーク: Base Sepolia';
  });
  document.querySelector('#counts').textContent =
    'このページでの接続要求: ' + f.calls.filter(call => call.method === 'eth_requestAccounts').length +
    '件 / 通信要求: ' + f.calls.length + '件（検証専用プロバイダー）';
  for (const button of document.querySelectorAll('.steps button')) button.disabled = busy;
  document.querySelector('#restore').disabled = busy || !reviewed;
}
function start() { f = makeAcceptanceFixture(DB_PREFIX + run); reviewed = false; render(); }
start();
function action(id, handler) {
  document.querySelector(id).addEventListener('click', async () => {
    if (busy || !f) return;
    busy = true; render();
    try { await handler(); }
    catch (error) { status.textContent = '確認を完了できませんでした: ' + error.message; }
    finally { busy = false; render(); }
  });
}
action('#observe', async () => {
  reviewed = false; f.configure();
  for (let index = 0; index < 3; index++) { await f.connect(index); await f.observe(index); }
  status.textContent = '3つの別ウォレットで接続と残高の読取りが完了し、各1件の履歴を作成しました。まだPC内に控えは保存していません。';
});
action('#save', async () => {
  await f.save();
  status.textContent = '3トークンの設定と履歴を、この検証専用の保存領域に保存しました。ページを再読み込みしてから「3. 保存した控えの内容を確認」へ進めます。';
});
action('#stage', async () => {
  reviewed = false; await f.stageSaved();
  review.textContent = f.q('.workspace-detail').textContent;
  reviewed = true;
  status.textContent = '保存された内容を読み込みました。下の変更内容を確認してから復元できます。ウォレットにはまだ接続しません。';
});
action('#restore', async () => {
  if (!reviewed) return;
  reviewed = false; f.applySaved();
  status.textContent = '3トークンの設定と各1件の履歴を復元しました。接続許可は復元せず、残高の再確認には改めて接続が必要です。';
  review.textContent = '';
});
action('#stop', async () => {
  f.q('.security-stop').click(); reviewed = false;
  status.textContent = '3ウォレットの接続を停止しました。保存済みの履歴は保持しています。';
});
window.addEventListener('pagehide', () => { f?.dispose(); f = null; });
window.addEventListener('pageshow', () => { if (!f) { start(); status.textContent = '接続を終了して画面を開き直しました。必要な控えを選んで復元してください。'; } });
