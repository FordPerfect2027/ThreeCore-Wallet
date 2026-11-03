import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const [walletRoot, backupPath] = process.argv.slice(2);
const { decodeWorkspaceFile, prepareWorkspaceFile } = await import(pathToFileURL(resolve(walletRoot, 'src/workspace-file.js')));
const bytes = await readFile(backupPath);
const decoded = await decodeWorkspaceFile(new Uint8Array(bytes));
const exported = Buffer.from((await prepareWorkspaceFile(decoded.workspace)).text);
assert(bytes.equals(exported), 'Backup round trip changed bytes');
const histories = decoded.workspace.entries.map(({agent, history}) => ({agent, history}));
const records = histories.reduce((count, entry) => count + entry.history.reports.length, 0);
assert.equal(records, 9);
console.log(JSON.stringify({ records, cards: histories.length, checksumVerified: decoded.checksumVerified,
  byteIdenticalRoundTrip: true, bytes: bytes.length,
  backupSha256: createHash('sha256').update(bytes).digest('hex'),
  historySha256: createHash('sha256').update(JSON.stringify(histories)).digest('hex') }));
