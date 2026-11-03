import assert from 'node:assert/strict';
import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
const repo='C:/Users/aseet/Documents/Codex/2026-10-26/test-4/work/threecore-wallet-operation-rehearsal-20261029';
const old='C:/Users/aseet/AppData/Local/Temp/threecore old source 2dfa3860-44e3-4291-a0bd-57981ba46f50';
const output='C:/Users/aseet/Downloads/ThreeCore-legacy-history-recovery-20261103';
const originalPath='C:/Users/aseet/Downloads/ThreeCore-workspace-backup (19).json';
const sha=b=>createHash('sha256').update(b).digest('hex');
const current=await import(pathToFileURL(join(repo,'src/workspace-file.js')));
const legacy=await import(pathToFileURL(join(old,'src/workspace-file.js')));
const original=await readFile(originalPath),decoded=await current.decodeWorkspaceFile(original);
let originalRejection=null;try{await legacy.decodeWorkspaceFile(original);}catch(e){originalRejection=e.code;}
assert.equal(originalRejection,'WORKSPACE_DUPLICATE');
const view=structuredClone(decoded.workspace);for(const entry of view.entries)entry.account=null;
for(let i=0;i<view.entries.length;i++){assert.deepEqual(view.entries[i].history,decoded.workspace.entries[i].history);assert.deepEqual({...view.entries[i],account:decoded.workspace.entries[i].account},decoded.workspace.entries[i]);}
const prepared=await legacy.prepareWorkspaceFile(view),bytes=Buffer.from(prepared.text);
const oldRead=await legacy.decodeWorkspaceFile(bytes),newRead=await current.decodeWorkspaceFile(bytes);
assert.deepEqual(oldRead.workspace,newRead.workspace);assert(oldRead.workspace.entries.every(e=>e.account===null));
const histories=decoded.workspace.entries.map((entry,i)=>{assert.deepEqual(oldRead.workspace.entries[i].history,entry.history);return {agent:entry.agent,reports:entry.history.reports.length,sha256:sha(JSON.stringify(entry.history)),unchanged:true};});
assert.equal(histories.reduce((n,e)=>n+e.reports,0),9);
const reconstructed=structuredClone(oldRead.workspace);for(let i=0;i<reconstructed.entries.length;i++)reconstructed.entries[i].account=decoded.workspace.entries[i].account;
const restored=await current.prepareWorkspaceFile(reconstructed);assert.equal(restored.digest,decoded.digest);assert.equal(restored.text,original.toString('utf8'));
const corrupt=JSON.parse(prepared.text);corrupt.digest='0'.repeat(64);let rejected=null;try{await legacy.decodeWorkspaceFile(Buffer.from(JSON.stringify(corrupt)));}catch(e){rejected=e.code;}
assert.equal(rejected,'WORKSPACE_CHECKSUM');
await mkdir(output);await writeFile(join(output,'ORIGINAL-nine-records.json'),original,{flag:'wx'});await writeFile(join(output,'HISTORY-VIEW-ONLY-legacy.json'),bytes,{flag:'wx'});
assert.equal(sha(await readFile(originalPath)),sha(original));assert.equal(sha(await readFile(join(output,'ORIGINAL-nine-records.json'))),sha(original));
const result={schema:'threecore.legacy-history-recovery.v1',recordedAt:new Date().toISOString(),oldRevision:'07041f00efdb503cb76a06fbe12e5531cb380930',newRevision:'bf690f38b070362aab1369fbf22c8e68b1a6567f',original:{bytes:original.length,sha256:sha(original),digest:decoded.digest,oldRejection:originalRejection},historyView:{bytes:bytes.length,sha256:sha(bytes),digest:prepared.digest,configuredAccounts:0,historyRecords:9,oldDecoderAccepted:true,currentDecoderAccepted:true},histories,onlyChangedFields:['entries[0].account','entries[1].account','entries[2].account'],envelopeChecksumRecomputed:true,restoringOriginalConfigurationReproducesOriginalBytes:true,tamperRejected:rejected,originalInputUnchanged:true,filesOnly:true,browserRestorePerformed:false,realWalletOrRpcUsed:false,githubWrites:false};
await writeFile(join(output,'verification.json'),JSON.stringify(result,null,2)+'\n');
await writeFile(join(output,'READ-ME.txt'),'ThreeCore 旧版で履歴を読むための回復コピー\n\nORIGINAL-nine-records.json は元の9件のバックアップと完全に同じです。通常はこちらを新しい版で使います。\nHISTORY-VIEW-ONLY-legacy.json は旧版 07041f0 で履歴を確認するためのコピーです。\n履歴9件、履歴内の口座・ネットワーク・トークン・観測値は変えていません。\n旧版が同じ口座の3カード設定を拒否するため、このコピーのカード設定の口座欄3つだけを空にしました。\nこれは接続用の設定を復旧するファイルではありません。表示確認を目的とし、接続や署名、送金はしないでください。\n復元画面では変更内容を確認してから操作してください。現在の作業画面に自動で適用していません。\n元の設定へ戻るときは、新しい版で ORIGINAL-nine-records.json を使用します。\n旧版・新版の検証関数で読めることと、元の設定を戻すと元ファイルの全バイトに一致することを確認しました。\n実ブラウザー画面での復元は未確認です。verification.json に確認結果があります。\nこれらのJSONは公開口座データを含むため、レビュー用公開ZIPには入れていません。\n');
console.log(JSON.stringify(result,null,2));
