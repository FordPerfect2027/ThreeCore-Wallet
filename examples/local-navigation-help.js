/** A passive explanation for refused top-level navigation, never a retry route. */
export function renderLocalNavigationHelp(request, verdict) {
  const port = request.socket?.localPort;
  const route = request.url;
  if (verdict.status !== 403 || verdict.reason !== "Cross-origin request refused" ||
      request.method !== "GET" || request.headers["sec-fetch-dest"] !== "document" ||
      request.headers["sec-fetch-mode"] !== "navigate" ||
      !Number.isSafeInteger(port) || port < 1 || port > 65535 ||
      !["/", "/rehearsal/"].includes(route)) return null;
  // Neither Host, Origin, Referer nor arbitrary request text is interpolated.
  const url = "http://127.0.0.1:" + port + route;
  const screen = route === "/rehearsal/" ? "運用リハーサル" : "ThreeCore Wallet";
  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; form-action 'none'; base-uri 'none'">
<title>開き方の確認 — ThreeCore Wallet</title>
<style>
:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;background:#101b2a;color:#edf6ff;font:17px/1.75 system-ui,sans-serif}
main{max-width:760px;margin:48px auto;padding:32px;border:1px solid #365166;border-radius:18px;background:#192a3a}
.brand{color:#69ded7;letter-spacing:.15em;font-size:14px}h1{font-size:clamp(24px,4vw,34px);line-height:1.4;margin:16px 0}
label{display:block;font-weight:700;margin-top:24px}input{width:100%;padding:14px;border:2px solid #69ded7;border-radius:8px;background:#101b2a;color:#fff;font:16px ui-monospace,monospace}
input:focus{outline:3px solid #fff;outline-offset:3px}li{margin:12px 0}.note{color:#c3d3e2;font-size:15px}.code{font-size:13px;color:#9fb2c4}
@media(max-width:600px){main{margin:16px;padding:24px}ol{padding-left:24px}}
</style></head><body><main>
<div class="brand">THREECORE · LOCAL</div>
<h1>このタブで開き直してください</h1>
<p>移動元を確認できなかったため、${screen}の表示を止めています。</p>
<label for="local-entry">アドレスバーに入力するURL</label>
<input id="local-entry" type="text" readonly value="${url}" spellcheck="false" aria-describedby="steps">
<ol id="steps"><li>このタブを選んだまま、<strong>Ctrl＋L</strong>でアドレスバー全体を選択します。</li>
<li>上のURLを入力し、<strong>Enter</strong>を押します。</li>
<li>「${screen}」が表示されたことを確認します。</li></ol>
<p class="note">別のタブに試算中の記録がある場合は、閉じる前に保存してください。この案内は自動移動やWallet接続を行いません。</p>
<p class="code">表示コード: Cross-origin request refused（403）</p>
</main></body></html>`;
}
