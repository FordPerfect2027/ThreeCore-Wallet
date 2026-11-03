import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const cases = [
  ["identity-progress", "token-identity-reader", "identity-fixtures", "readTokenIdentity", "readerSession", "await readTokenIdentity(f.session,{onProgress:observer})"],
  ["transfer-progress", "transfer-reader", "transfer-fixtures", "readTransferSnapshot", "readerFixture,REQUEST", "await readTransferSnapshot(f.session,REQUEST,{onProgress:observer})"],
  ["allowance-progress", "allowance-reader", "allowance-fixtures", "readAllowanceSnapshot", "fakeReader,targets", "await readAllowanceSnapshot(f.session,targets(),{onProgress:observer})"],
  ["period-progress", "period-reader", "period-fixtures", "collectPeriod", "periodSession,plan", "await collectPeriod(f.session,plan(),{onProgress:observer})"],
  ["period-checkpoint", "period-reader", "period-fixtures", "collectPeriod", "periodSession,plan", "await collectPeriod(f.session,plan(),{onCheckpoint:observer})"],
];
for (const [name, source, fixture, reader, helpers, call] of cases) {
  test(`read observer ${name} contains a rejecting asynchronous then method`, () => {
    const sourceUrl = new URL(`../src/${source}.js`, import.meta.url).href;
    const fixtureUrl = new URL(`./helpers/${fixture}.js`, import.meta.url).href;
    const create = helpers.split(",")[0];
    const child = spawnSync(process.execPath, ["--unhandled-rejections=strict", "--input-type=module", "-e", `
      import { ${reader} } from ${JSON.stringify(sourceUrl)};
      import { ${helpers} } from ${JSON.stringify(fixtureUrl)};
      let callbacks=0;
      const observer=()=>{callbacks++;return {async then(){throw Error('synthetic observer');}};};
      const f=${create}();
      const result=${call};
      if(!result||callbacks===0)throw Error('missing result or notification');
      setTimeout(()=>console.log('contained'),20);
    `], { timeout: 10000, encoding: "utf8", windowsHide: true });
    assert.equal(child.error, undefined);
    assert.equal(child.status, 0, child.stderr);
    assert.equal(child.stderr, "");
    assert.equal(child.stdout.trim(), "contained");
  });
}
