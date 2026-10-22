import test from "node:test";
import assert from "node:assert/strict";
import { mountAllowanceBundlePanel } from "../examples/allowance-bundle-panel.js";
import { captureAllowanceBundle, prepareAllowanceBundle, decodeAllowanceBundle } from "../src/allowance-bundle.js";
import { Element } from "./helpers/panel-dom.js";
import { record, deferred, tick, clone } from "./helpers/allowance-fixtures.js";

const records = () => ["DAT", "EMA", "CAWELON"].map(agent => record({}, agent));
async function settle(predicate) {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 2));
  }
  assert.fail("Bundle panel did not settle");
}
async function saved(input = records()) {
  const prepared = await prepareAllowanceBundle(captureAllowanceBundle(input));
  const bytes = new TextEncoder().encode(prepared.text);
  return { name: prepared.filename, size: bytes.length, arrayBuffer: async () => bytes.slice().buffer };
}
function fixture(options = {}) {
  const parent = new Element("div");
  let input = records();
  const downloads = [];
  const panel = mountAllowanceBundlePanel({
    document: { createElement: tag => new Element(tag) },
    parent,
    readRecords: () => input,
    downloadFile: file => downloads.push(file),
    ...options,
  });
  const q = name => parent.find("allowance-bundle-" + name);
  return { parent, panel, downloads, q, setRecords(value) { input = value; },
    click: name => q(name).click(),
    async load(file) {
      q("file").files = [file];
      q("file").dispatchEvent(new Event("change"));
      await settle(() => q("panel").getAttribute("aria-busy") === "false");
    } };
}
test("allowance bundle panel: capture requires explicit review", async () => {
  let reads = 0;
  const f = fixture({ readRecords: () => { reads++; return records(); } });
  assert.equal(reads, 0);
  assert(f.q("save").disabled);
  f.click("review");
  assert.equal(reads, 1);
  assert.equal(f.q("save").disabled, false);
  assert(f.q("details").textContent.includes("3トークンの保存記録"));
  assert.equal(f.downloads.length, 0);
});
test("allowance bundle panel: missing card reports missing record and cannot save", () => {
  const f = fixture({ readRecords: () => [record(), null, null] });
  f.click("review");
  assert(f.q("save").disabled);
  assert.equal(f.q("details").textContent, "");
  assert(f.q("status").textContent.includes("3件"));
});
test("allowance bundle panel: saving captures exactly reviewed three records", async () => {
  const f = fixture();
  f.click("review");
  f.click("save");
  await settle(() => f.downloads.length === 1);
  const result = await decodeAllowanceBundle(new TextEncoder().encode(f.downloads[0].text));
  assert.deepEqual(result.bundle.records, records());
  assert(f.q("status").textContent.includes("ダウンロード完了"));
});
test("allowance bundle panel: changed card before click prevents download", async () => {
  const f = fixture();
  f.click("review");
  const changed = records();
  changed[0].rows[0].allowanceBaseUnits = "99";
  f.setRecords(changed);
  f.click("save");
  await settle(() => f.q("panel").getAttribute("aria-busy") === "false");
  assert.equal(f.downloads.length, 0);
  assert(f.q("save").disabled);
  assert(f.q("status").textContent.includes("もう一度"));
});
test("allowance bundle panel: changed card during hashing also prevents download", async () => {
  const gate = deferred();
  const f = fixture({ subtle: { async digest(algorithm, bytes) {
    await gate.promise;
    return crypto.subtle.digest(algorithm, bytes);
  } } });
  f.click("review");
  f.click("save");
  f.setRecords(records().map(r => ({ ...r, identity: { ...r.identity, blockNumber: "43" } })));
  gate.resolve();
  await settle(() => f.q("panel").getAttribute("aria-busy") === "false");
  assert.equal(f.downloads.length, 0);
  assert(f.q("save").disabled);
});
test("allowance bundle panel: cancellation while preparing retires download", async () => {
  const gate = deferred();
  const f = fixture({ subtle: { async digest(algorithm, bytes) {
    await gate.promise;
    return crypto.subtle.digest(algorithm, bytes);
  } } });
  f.click("review");
  f.click("save");
  f.click("cancel");
  gate.resolve();
  await tick();
  assert.equal(f.downloads.length, 0);
  assert.equal(f.q("details").textContent, "");
  assert(f.q("status").textContent.includes("中止"));
});
test("allowance bundle panel: import never reads or replaces wallet cards", async () => {
  let reads = 0;
  const f = fixture({ readRecords: () => { reads++; return records(); } });
  await f.load(await saved());
  assert.equal(reads, 0);
  assert(f.q("details").textContent.includes("CAWELON"));
  assert(f.q("status").textContent.includes("変更していません"));
  assert(f.q("save").disabled);
  assert.equal(f.q("file").value, "");
});
test("allowance bundle panel: corrupted file clears old display", async () => {
  const f = fixture();
  await f.load(await saved());
  await f.load({ name: "bad.json", size: 1, arrayBuffer: async () => new Uint8Array([123]).buffer });
  assert.equal(f.q("details").textContent, "");
  assert(f.q("save").disabled);
});
test("allowance bundle panel: cancelled import ignores late file response", async () => {
  const gate = deferred();
  const f = fixture();
  const file = await saved();
  const original = file.arrayBuffer;
  file.arrayBuffer = async () => { await gate.promise; return original(); };
  f.q("file").files = [file];
  f.q("file").dispatchEvent(new Event("change"));
  f.click("cancel");
  gate.resolve();
  await tick();
  assert.equal(f.q("details").textContent, "");
});
test("allowance bundle panel: failed async download does not claim success", async () => {
  const f = fixture({ downloadFile: async () => { throw Error("disk"); } });
  f.click("review");
  f.click("save");
  await settle(() => f.q("panel").getAttribute("aria-busy") === "false");
  assert(!f.q("status").textContent.includes("用意しました"));
  assert(f.q("save").disabled);
});
test("allowance bundle panel: dispose removes nodes and prevents delayed download", async () => {
  const gate = deferred();
  const f = fixture({ subtle: { async digest(algorithm, bytes) {
    await gate.promise;
    return crypto.subtle.digest(algorithm, bytes);
  } } });
  f.click("review");
  f.click("save");
  f.panel.dispose();
  f.panel.dispose();
  gate.resolve();
  await tick();
  assert.equal(f.parent.children.length, 0);
  assert.equal(f.downloads.length, 0);
});
test("allowance bundle panel: source rows survive preview, save and clear unchanged", async () => {
  const input = records();
  const original = clone(input);
  const f = fixture({ readRecords: () => input });
  f.click("review");
  f.click("save");
  await settle(() => f.downloads.length === 1);
  f.click("clear");
  assert.deepEqual(input, original);
  assert.equal(f.q("details").textContent, "");
});
