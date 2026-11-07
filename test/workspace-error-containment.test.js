import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const panelURL = new URL("../examples/workspace-panel.js", import.meta.url).href;
const domURL = new URL("./helpers/panel-dom.js", import.meta.url).href;
const fixturesURL = new URL("./helpers/workspace-fixtures.js", import.meta.url).href;

for (const shape of ["code-getter", "revoked-proxy", "known-own-code", "dictionary-prototype-key"]) {
  test(`workspace save contains ${shape} errors without retaining stale success or losing records`, () => {
    const script = `
      import assert from "node:assert/strict";
      import { webcrypto } from "node:crypto";
      import { mountWorkspacePanel } from ${JSON.stringify(panelURL)};
      import { Element } from ${JSON.stringify(domURL)};
      import { draft, clone, tick, until } from ${JSON.stringify(fixturesURL)};

      const shape = ${JSON.stringify(shape)};
      let current = draft({ block: "10" });
      let broken = false, writes = 0, getterReads = 0;
      let problem;
      if (shape === "code-getter") {
        problem = { get code() { getterReads++; throw Error("private formatter detail"); } };
      } else if (shape === "revoked-proxy") {
        const pair = Proxy.revocable({}, {});
        pair.revoke();
        problem = pair.proxy;
      } else {
        problem = { code: shape === "known-own-code" ? "WORKSPACE_DOWNLOAD" : "constructor" };
      }

      const attempts = [], downloads = [];
      const parent = new Element("main");
      const document = { createElement: tag => new Element(tag) };
      const panel = mountWorkspacePanel({ document, parent, subtle: webcrypto.subtle,
        readDraft: () => current,
        writeDraft(value) { writes++; current = clone(value); },
        download({ prepared }) {
          attempts.push(prepared);
          if (broken) throw problem;
          downloads.push(prepared);
          return true;
        } });
      const field = name => parent.find("workspace-" + name);
      async function save() {
        field("save").click();
        await until(() => !field("save").disabled);
        // Strict unhandled-rejection mode must also see errors escaping the click.
        await tick();
      }

      try {
        await save();
        assert.equal(downloads.length, 1);
        const oldSuccess = field("status").textContent;
        assert.match(oldSuccess, /ダウンロードを開始しました/);

        // A previous successful backup does not cover the next local records.
        const next = draft({ block: "20" });
        current = current.map((row, index) => {
          const history = JSON.parse(row.history);
          history.reports.push(...JSON.parse(next[index].history).reports);
          return { ...row, history: JSON.stringify(history) };
        });
        panel.invalidate();
        const before = clone(current);
        assert.ok(before.every(row => JSON.parse(row.history).reports.length === 2));
        assert.match(field("backup-status").textContent, /内容が変わった/);

        broken = true;
        await save();
        const expected = shape === "known-own-code"
          ? "ダウンロードを開始できませんでした。操作前の控えと保存履歴は保持しています。もう一度保存を試してください。"
          : "バックアップの形式や入力を確認してください。操作は完了していません。";
        assert.equal(field("status").textContent, expected);
        assert.notEqual(field("status").textContent, oldSuccess);
        assert.equal(getterReads, 0, "Formatting must not run an error code getter");
        assert.equal(downloads.length, 1, "The failed save did not offer a new file");
        assert.equal(attempts.length, 2);
        assert.equal(writes, 0);
        assert.deepEqual(current, before);
        assert.equal(field("save").disabled, false);
        assert.equal(parent.find("workspace-panel").getAttribute("aria-busy"), "false");
        assert.match(field("backup-status").textContent, /内容が変わった/);

        broken = false;
        await save();
        assert.equal(downloads.length, 2);
        assert.equal(attempts.length, 3);
        assert.equal(downloads[1].text, attempts[1].text);
        const saved = JSON.parse(downloads[1].text).workspace;
        assert.equal(saved.entries.length, 3);
        assert.ok(saved.entries.every(row => row.history.reports.length === 2));
        assert.equal(writes, 0);
        assert.deepEqual(current, before);
        assert.match(field("status").textContent, /ダウンロードを開始しました/);
        assert.match(field("backup-status").textContent, /現在の内容でダウンロードを開始済み/);
      } finally {
        panel.dispose();
      }
      await tick();
      console.log("contained and retried");
    `;
    const child = spawnSync(process.execPath,
      ["--unhandled-rejections=strict", "--input-type=module", "-e", script],
      { encoding: "utf8", timeout: 10000 });
    assert.equal(child.error, undefined);
    assert.equal(child.status, 0, child.stderr);
    assert.equal(child.stdout.trim(), "contained and retried");
  });
}
