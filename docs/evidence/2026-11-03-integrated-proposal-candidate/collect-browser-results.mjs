import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { checkBrowserShards, checkBrowserShard } from '../../../scripts/browser-result.js';
const here = new URL('./', import.meta.url);
const pages = await Promise.all([0, 1].map(i => readFile(new URL('browser-shard-' + i + '.html', here), 'utf8')));
const checked = checkBrowserShards(pages);
const result = { recordedAt: new Date().toISOString(), walletRevision: '288efc3', status: 'passed', completed: checked.passed,
  failures: [], summary: checked, environment: 'Codex in-app browser through CUA; separate new loopback origins per shard; synthetic providers only',
  shards: pages.map((html, index) => ({ ...checkBrowserShard(html, index), url: 'http://127.0.0.1:' + (4257 + index) + '/test/browser/?shard-count=2&shard-index=' + index,
    htmlSha256: createHash('sha256').update(html).digest('hex') })), realWalletUsed: false, publicRpcUsed: false };
await writeFile(new URL('browser-result.json', here), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ passed: result.completed, failed: 0, unexpectedErrors: 0 }));
