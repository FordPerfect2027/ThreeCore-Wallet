import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { DELIVERY_CASES, exportReceiptFixture } from "./helpers/export-receipt-fixtures.js";
import { microtasks } from "./helpers/secure-lifecycle-time.js";

for (const name of DELIVERY_CASES) {
  for (const failure of ["false", "throw", "promise", "thenable", "changing-getter", "throwing-getter"]) {
    test("export receipt: " + name + " refuses " + failure + " without a success receipt", async t => {
      const f = await exportReceiptFixture(name); t.after(f.dispose);
      const before = f.source();
      let calls = 0, getterReads = 0, settlements = 0;
      const callback = () => {
        calls++;
        if (failure === "false") return false;
        if (failure === "throw") throw Error("private delivery detail");
        if (failure === "promise") return Promise.resolve(true);
        return { get then() {
          getterReads++;
          if (failure === "throwing-getter") throw Error("private getter detail");
          if (failure === "changing-getter" && getterReads > 1) return undefined;
          return resolve => { settlements++; resolve(true); };
        } };
      };
      assert.equal(await f.send(f.formats[0], callback), false);
      await microtasks();
      const state = f.state();
      assert.equal(calls, 1);
      assert(state.error ?? state.errorCode, "a bounded failure is shown");
      assert.equal(state.savedCurrent ?? state.exportedCurrent ?? false, false);
      assert.notEqual(state.result, "export-offered");
      assert.equal(state.busy, false);
      assert(!JSON.stringify(state).includes("private"));
      assert.equal(f.source(), before);
      if (failure.includes("getter") || failure === "thenable") assert.equal(getterReads, 1);
      if (failure === "thenable" || failure === "changing-getter") assert.equal(settlements, 1);
    });
  }

  test("export receipt: " + name + " all formats reject an explicit delivery refusal", async t => {
    const f = await exportReceiptFixture(name); t.after(f.dispose);
    const before = f.source();
    for (const format of f.formats) {
      assert.equal(await f.send(format, () => false), false, format);
      assert.equal(f.source(), before, format + " preserves records");
    }
  });

  for (const action of ["cancel", "dispose"]) {
    test("export receipt: " + name + " " + action + " inside delivery cannot publish late success", async t => {
      const f = await exportReceiptFixture(name); t.after(f.dispose);
      const before = f.source();
      let called = 0;
      const result = await f.send(f.formats[0], () => { called++; f[action](); return true; });
      assert.equal(result, false);
      assert.equal(called, 1);
      assert.equal(f.state().savedCurrent ?? f.state().exportedCurrent ?? false, false);
      assert.notEqual(f.state().result, "export-offered");
      assert.equal(f.source(), before);
      assert.equal(f.state().busy, false);
    });
  }

  for (const value of [undefined, true]) {
    test("export receipt: " + name + " retains synchronous " + String(value) + " callback compatibility", async t => {
      const f = await exportReceiptFixture(name); t.after(f.dispose);
      const before = f.source(), files = [];
      for (const format of f.formats) {
        assert.equal(await f.send(format, file => { files.push(file); return value; }), true, format);
      }
      assert.equal(files.length, f.formats.length);
      assert(files.every(file => typeof file.text === "string" && file.text.length > 0));
      assert.equal(f.source(), before);
    });
  }

  for (const kind of ["native-rejection", "async-then-rejection"]) {
    test("export receipt: " + name + " consumes " + kind, () => {
      const helper = new URL("./helpers/export-receipt-fixtures.js", import.meta.url).href;
      const script = [
        "import { exportReceiptFixture } from " + JSON.stringify(helper) + ";",
        "const f=await exportReceiptFixture(" + JSON.stringify(name) + ");",
        "const kind=" + JSON.stringify(kind) + ";",
        "try {",
        " const result=await f.send(f.formats[0],()=>kind==='native-rejection'?",
        "   Promise.reject(Error('private download detail')):{async then(){throw Error('private then detail')}});",
        " if(result!==false)throw Error('incorrect success');",
        "}finally{f.dispose()}",
        "setTimeout(()=>console.log('contained'),15);",
      ].join("\n");
      const child = spawnSync(process.execPath, ["--unhandled-rejections=strict", "--input-type=module", "-e", script],
        { timeout: 10000, encoding: "utf8", windowsHide: true });
      assert.equal(child.error, undefined);
      assert.equal(child.status, 0, child.stderr);
      assert.equal(child.stderr, "");
      assert.equal(child.stdout.trim(), "contained");
    });
  }
}
