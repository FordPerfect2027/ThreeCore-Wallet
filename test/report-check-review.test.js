import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { prepareReportSetChecksFile, reviewReportSetChecksFile, REPORT_SET_CHECKS_LIMIT } from "../src/report-set-export.js";
import { sequenceSet, sequenceHistory, clone } from "./helpers/report-set-fixtures.js";
const source = () => sequenceSet(sequenceHistory([0n, 0n]));
function reordered(value) {
  if (Array.isArray(value)) return value.map(reordered);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).reverse().map(([key, child]) => [key, reordered(child)]));
}
test("check review recomputes exact details while tolerating JSON whitespace and object-key order", async () => {
  const input = source(), file = await prepareReportSetChecksFile(input, {severity:"conflict"}), before = JSON.stringify(input);
  const text = JSON.stringify(reordered(JSON.parse(file.text))), review = await reviewReportSetChecksFile(input, text);
  assert.equal(review.detailsTextSha256, createHash("sha256").update(text).digest("hex"));
  assert.equal(review.matchesRecomputation, true); assert.equal(review.sourceDigestMatches, true);
  assert.deepEqual(review.differences, []); assert.equal(review.unexpectedFields, 0);
  assert.equal(review.readOnly, true); assert.equal(review.authenticated, false); assert.equal(review.liveChainRechecked, false);
  assert.equal(JSON.stringify(input), before); assert.ok(Object.isFrozen(review.summary.counts));
});
for (const [name, change, field] of [
  ["stored integer", data => { data.items.find(item=>item.observations.some(row=>row.value!==null)).observations[0].value="1"; }, "items"],
  ["stored hash", data => { data.items.find(item=>item.observations.length).observations[0].hash="0x"+"f".repeat(64); }, "items"],
  ["missing check", data => { data.items.pop(); }, "items"],
  ["check order", data => { data.items.reverse(); }, "items"],
  ["invented continuity", data => { data.summary.allContinuous=true; }, "summary"],
  ["matched count", data => { data.matched=0; }, "matched"],
  ["live verification claim", data => { data.liveChainRechecked=true; }, "liveChainRechecked"],
  ["source digest", data => { data.sourcePayloadDigest="0".repeat(64); }, "sourcePayloadDigest"],
]) {
  test("check review detects changed "+name+" without trusting saved conclusions", async () => {
    const input=source(), data=JSON.parse((await prepareReportSetChecksFile(input)).text); change(data);
    const review=await reviewReportSetChecksFile(input,JSON.stringify(data));
    assert.equal(review.matchesRecomputation,false);assert.ok(review.differences.includes(field));assert.equal(review.summary.allContinuous,false);
  });
}
test("wrong original source remains distinguishable even when notes were not exported", async () => {
  const input=source(),file=await prepareReportSetChecksFile(input),different=clone(input);different.entries[0].note="Different original";
  const review=await reviewReportSetChecksFile(different,file.text);
  assert.equal(review.sourceDigestMatches,false);assert.deepEqual(review.differences,["sourcePayloadDigest"]);
});
test("empty selections are verified against source-wide counts rather than treated as clean", async () => {
  const input=source(),file=await prepareReportSetChecksFile(input,{search:"nothing matching"});
  const review=await reviewReportSetChecksFile(input,file.text);
  assert.equal(review.matchesRecomputation,true);assert.equal(review.matched,0);assert.ok(review.total>0);assert.ok(review.summary.counts.conflict>0);
});
test("unexpected fields and missing flags fail comparison without copying arbitrary field names into the result", async () => {
  const input=source(),data=JSON.parse((await prepareReportSetChecksFile(input)).text);data.PRIVATE_EXTRA_FIELD="PRIVATE_VALUE";delete data.authenticated;
  const review=await reviewReportSetChecksFile(input,JSON.stringify(data));
  assert.equal(review.matchesRecomputation,false);assert.equal(review.unexpectedFields,1);assert.ok(review.differences.includes("authenticated"));
  assert.doesNotMatch(JSON.stringify(review),/PRIVATE_/);
});
test("malformed, duplicate, oversized and unsupported checklist inputs are rejected", async () => {
  const input=source(),data=JSON.parse((await prepareReportSetChecksFile(input)).text);
  for(const text of ["{", "[]", '{"schema":"x","schema":"y"}', '"'+"x".repeat(REPORT_SET_CHECKS_LIMIT)+'"', JSON.stringify({...data,schema:"unknown"}), JSON.stringify({...data,query:{agent:"ETH"}})])
    await assert.rejects(reviewReportSetChecksFile(input,text));
});
