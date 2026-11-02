import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
const root = 'C:/Users/aseet/Documents/Codex/2026-10-26/test-4/work';
const datRepo = join(root, 'token-dependency-repair-DAT-20261102');
const { createPublicClient, keccak256 } = createRequire(join(datRepo, 'package.json'))('viem');
const { createReadOnlyHttp } = await import(pathToFileURL(join(datRepo, 'src/read-only-http.js')));
const { TOKEN_CATALOG } = await import(pathToFileURL(join(root, 'threecore-wallet-operation-rehearsal-20261029/src/token-catalog.js')));
const sourceReceipt = JSON.parse(readFileSync('C:/Users/aseet/Downloads/ThreeCore-source-portability-comparison-20261102.json'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const data = value => typeof value === 'string' && /^0x(?:[0-9a-f]{2})+$/i.test(value) && value.length <= 2 + 256 * 1024 * 2;
function normalize(value, ranges) {
  const bytes = Buffer.from(value.slice(2), 'hex');
  for (const range of ranges) {
    if (range.start + range.length > bytes.length) throw Error('IMMUTABLE_RANGE');
    bytes.fill(0, range.start, range.start + range.length);
  }
  return '0x' + bytes.toString('hex');
}
function splitMetadata(value) {
  const bytes = Buffer.from(value.slice(2), 'hex');
  const size = bytes.readUInt16BE(bytes.length - 2);
  if (size < 1 || size + 2 >= bytes.length) throw Error('METADATA_LENGTH');
  const offset = bytes.length - size - 2;
  // Diagnostic comparison only: this recognizes a CBOR map prefix, not the
  // authenticity or semantic equivalence of its source/metadata contents.
  if ((bytes[offset] & 0xe0) !== 0xa0) throw Error('METADATA_MAP');
  return { executable: '0x' + bytes.subarray(0, offset).toString('hex'), metadata: '0x' + bytes.subarray(offset).toString('hex'), offset };
}
const builds = new Map();
for (const row of sourceReceipt.comparisons) {
  const repo = join(root, `token-dependency-repair-${row.token}-20261102`);
  const bytes = readFileSync(join(repo, `artifacts/contracts/${row.contract}.sol/${row.contract}.json`));
  if (sha(bytes) !== row.artifactSha256) throw Error('ARTIFACT_RECEIPT_MISMATCH');
  const artifact = JSON.parse(bytes);
  if (!data(artifact.deployedBytecode)) throw Error('INVALID_ARTIFACT');
  const ranges = Object.values(artifact.immutableReferences).flat().sort((a,b) => a.start - b.start);
  const split = splitMetadata(artifact.deployedBytecode);
  let end = 0;
  for (const r of ranges) {
    if (!Number.isSafeInteger(r.start) || r.start < end || r.length !== 32 || r.start + r.length > split.offset) throw Error('INVALID_IMMUTABLE_RANGE');
    end = r.start + r.length;
  }
  builds.set(row.token, { artifact, ranges, split, artifactSha256: row.artifactSha256,
    revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, windowsHide: true, encoding: 'utf8' }).trim() });
}
const report = { schema: 'threecore-deployed-runtime-source-comparison-v1', startedAt: new Date().toISOString(),
  mode: 'read-only public RPC; existing artifacts, no compilation or deployment',
  sourceReceiptSha256: sha(readFileSync('C:/Users/aseet/Downloads/ThreeCore-source-portability-comparison-20261102.json')),
  observations: [], errors: [], independentReview: false, sourceVerification: false,
  caveat: 'Normalized comparisons omit compiler-declared immutable slots; executable-only comparisons also omit a recognized trailing metadata region. They are not an exact deployed source or constructor verification.' };
for (const [chainId, endpoint] of [[8453, 'https://mainnet.base.org'], [84532, 'https://sepolia.base.org']]) {
  try {
    const client = createPublicClient({ transport: createReadOnlyHttp(endpoint) });
    const methods = [];
    async function request(args) {
      if (!['eth_chainId', 'eth_getBlockByNumber', 'eth_getCode'].includes(args.method)) throw Error('METHOD');
      methods.push(args.method); return client.request(args);
    }
    if (BigInt(await request({ method: 'eth_chainId' })) !== BigInt(chainId)) throw Error('CHAIN');
    const before = await request({ method: 'eth_getBlockByNumber', params: ['latest', false] });
    if (!/^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/i.test(before?.number) || !/^0x[0-9a-f]{64}$/i.test(before?.hash)) throw Error('HEADER');
    const rows = [];
    for (const token of TOKEN_CATALOG.filter(row => row.chainId === chainId)) {
      const code = await request({ method: 'eth_getCode', params: [token.address, { blockHash: before.hash, requireCanonical: true }] });
      if (!data(code)) throw Error('CODE');
      const build = builds.get(token.agent), deployed = splitMetadata(code);
      const normalizedLocal = normalize(build.artifact.deployedBytecode, build.ranges);
      const normalizedOnchain = normalize(code, build.ranges);
      rows.push({ token: token.agent, contract: token.address, artifactRevision: build.revision,
        artifactSha256: build.artifactSha256, artifactRuntimeBytes: (build.artifact.deployedBytecode.length - 2) / 2,
        onchainRuntimeBytes: (code.length - 2) / 2, onchainRuntimeKeccak256: keccak256(code),
        immutableRanges: build.ranges, localMetadata: build.split.metadata, onchainMetadata: deployed.metadata,
        metadataMatches: build.split.metadata.toLowerCase() === deployed.metadata.toLowerCase(),
        immutableNormalizedRuntimeMatches: normalizedLocal === normalizedOnchain,
        immutableNormalizedExecutableMatches: splitMetadata(normalizedLocal).executable === splitMetadata(normalizedOnchain).executable,
        localNormalizedRuntimeKeccak256: keccak256(normalizedLocal), onchainNormalizedRuntimeKeccak256: keccak256(normalizedOnchain),
        publicRuntimeBytecode: code });
    }
    const after = await request({ method: 'eth_getBlockByNumber', params: [before.number, false] });
    if (before.number !== after?.number || before.hash.toLowerCase() !== after?.hash?.toLowerCase()) throw Error('BLOCK_CHANGED');
    if (BigInt(await request({ method: 'eth_chainId' })) !== BigInt(chainId)) throw Error('CHAIN_CHANGED');
    report.observations.push({ chainId, endpoint, blockNumber: BigInt(before.number).toString(), blockHash: before.hash,
      canonicalHashRequired: true, canonicalHeaderRechecked: true, chainRechecked: true, methods, rows });
  } catch { report.errors.push({ chainId, code: 'RUNTIME_COMPARISON_INCOMPLETE' }); }
}
report.finishedAt = new Date().toISOString();
writeFileSync('C:/Users/aseet/Downloads/ThreeCore-runtime-source-comparison-20261102.json', JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ startedAt: report.startedAt, finishedAt: report.finishedAt, errors: report.errors,
  observations: report.observations.map(({chainId,blockNumber,rows}) => ({chainId,blockNumber,
    rows: rows.map(({token,artifactRuntimeBytes,onchainRuntimeBytes,metadataMatches,immutableNormalizedRuntimeMatches,immutableNormalizedExecutableMatches}) =>
      ({token,artifactRuntimeBytes,onchainRuntimeBytes,metadataMatches,immutableNormalizedRuntimeMatches,immutableNormalizedExecutableMatches})) })) }, null, 2));
if (report.errors.length) process.exitCode = 1;
