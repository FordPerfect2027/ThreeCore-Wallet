import test from "node:test";
import assert from "node:assert/strict";
import { mountTokenPlanPanel } from "../examples/token-plan-panel.js";
import { createTokenPlan, encodeTokenPlan } from "../src/token-plan.js";
import { Element } from "./helpers/panel-dom.js";

const A = "0x" + "ab".repeat(20);
const B = "0x" + "cd".repeat(20);
const selected = { agent: "DAT", chainId: 84532 };
const report = (identity = selected, lines = A + "\n" + B) => encodeTokenPlan(createTokenPlan(identity, lines));
function fixture({ apply, read } = {}) {
  const parent = new Element("article");
  const applications = [];
  let context = { ...selected };
  let lines = A;
  const panel = mountTokenPlanPanel({
    document: { createElement: tag => new Element(tag) }, parent,
    getContext: () => context,
    readLines: () => read ? read() : lines,
    applyLines: value => {
      applications.push(value);
      if (apply) apply(value);
      lines = value;
    },
  });
  const field = name => parent.find("token-plan-" + name);
  const input = value => {
    field("json").value = value;
    field("json").dispatchEvent(new Event("input"));
  };
  const preview = value => { input(value); field("preview").click(); };
  return { parent, panel, field, input, preview, applications,
    setContext: value => { context = value; },
    setLines: value => { lines = value; },
    get lines() { return lines; },
  };
}

test("mounting the panel does not read or apply a list", () => {
  let reads = 0;
  const f = fixture({ read() { reads++; return A; } });
  assert.equal(reads, 0);
  assert.equal(f.applications.length, 0);
  assert.equal(f.field("apply").disabled, true);
  assert.equal(f.field("json").maxLength, 8192);
  assert.equal(f.field("status").getAttribute("aria-live"), "polite");
});

test("export puts only the explicitly entered configuration in the text area", () => {
  const f = fixture();
  f.field("save").click();
  const data = JSON.parse(f.field("json").value);
  assert.deepEqual(data.tokens, [A]);
  assert.equal(data.agent, "DAT");
  assert.equal(data.chainId, 84532);
  assert.equal(Object.hasOwn(data, "account"), false);
  assert.equal(f.applications.length, 0);
  assert.equal(f.field("apply").disabled, true);
});

test("preview shows all contracts without replacing the current input list", () => {
  const f = fixture();
  f.preview(report());
  assert.match(f.field("details").textContent, /2件/);
  assert.ok(f.field("details").textContent.includes(A));
  assert.ok(f.field("details").textContent.includes(B));
  assert.equal(f.applications.length, 0);
  assert.equal(f.lines, A);
  assert.equal(f.field("apply").disabled, false);
});

test("application is explicit, normalizes lines and consumes the preview once", () => {
  const f = fixture();
  f.preview(report());
  f.field("apply").click();
  f.field("apply").click();
  assert.deepEqual(f.applications, [A + "\n" + B]);
  assert.equal(f.field("apply").disabled, true);
  assert.equal(f.field("details").textContent, "");
  assert.match(f.field("status").textContent, /残高照会はまだ行っていません/);
});

test("editing JSON after preview disables application and clears the old preview", () => {
  const f = fixture();
  f.preview(report());
  f.input(report(selected, B));
  assert.equal(f.field("apply").disabled, true);
  assert.equal(f.field("details").textContent, "");
  f.field("apply").click();
  assert.equal(f.applications.length, 0);
});

test("silent programmatic text replacement cannot apply the previously reviewed plan", () => {
  const f = fixture();
  f.preview(report());
  f.field("json").value = report(selected, B);
  f.field("apply").click();
  assert.equal(f.applications.length, 0);
  assert.equal(f.field("apply").disabled, true);
  assert.equal(f.field("json").getAttribute("aria-invalid"), "true");
});

for (const context of [{ agent: "EMA", chainId: 84532 }, { agent: "DAT", chainId: 8453 }]) {
  test("context changes after preview are checked again: " + JSON.stringify(context), () => {
    const f = fixture();
    f.preview(report());
    f.setContext(context);
    f.field("apply").click();
    assert.equal(f.applications.length, 0);
    assert.match(f.field("status").textContent, /同じエージェント・チェーン/);
    assert.equal(f.field("details").textContent, "");
  });
}

test("a wrong-context report cannot enable application during preview", () => {
  const f = fixture();
  f.preview(report({ agent: "EMA", chainId: 84532 }));
  assert.equal(f.field("apply").disabled, true);
  assert.equal(f.field("json").getAttribute("aria-invalid"), "true");
  assert.match(f.field("status").textContent, /同じエージェント・チェーン/);
});

for (const raw of ["", "null", "[]", "{", "<img src=x onerror=alert(1)>", " ".repeat(8193)]) {
  test("invalid preview drops any previous candidate: input length " + raw.length, () => {
    const f = fixture();
    f.preview(report());
    f.preview(raw);
    assert.equal(f.field("apply").disabled, true);
    assert.equal(f.field("details").textContent, "");
    assert.equal(f.field("json").getAttribute("aria-invalid"), "true");
    f.field("apply").click();
    assert.equal(f.applications.length, 0);
  });
}

test("unknown fields cannot be smuggled through the preview", () => {
  const f = fixture();
  const value = JSON.parse(report());
  value.privateKey = "not-a-real-key";
  f.preview(JSON.stringify(value));
  assert.equal(f.field("apply").disabled, true);
  assert.equal(f.field("details").textContent, "");
});

test("clear removes JSON and candidate without changing the active list", () => {
  const f = fixture();
  f.preview(report());
  f.field("clear").click();
  assert.equal(f.field("json").value, "");
  assert.equal(f.field("details").textContent, "");
  assert.equal(f.field("apply").disabled, true);
  assert.equal(f.field("json").getAttribute("aria-invalid"), "false");
  assert.equal(f.lines, A);
});

test("outer invalidation removes stored configuration and disables application", () => {
  const f = fixture();
  f.preview(report());
  f.panel.invalidate();
  assert.equal(f.field("json").value, "");
  assert.equal(f.field("details").textContent, "");
  assert.equal(f.field("apply").disabled, true);
  assert.equal(f.applications.length, 0);
});

test("failed export does not preserve an earlier applicable candidate", () => {
  const f = fixture();
  f.preview(report());
  f.setLines(A + "\n" + A);
  f.field("save").click();
  assert.equal(f.field("apply").disabled, true);
  assert.equal(f.field("details").textContent, "");
  assert.equal(f.applications.length, 0);
});

test("source-list failures do not expose raw internal diagnostic messages", () => {
  const f = fixture({ read() { throw Error("private diagnostic"); } });
  f.field("save").click();
  assert.match(f.field("status").textContent, /確認できません/);
  assert.doesNotMatch(f.field("status").textContent, /private diagnostic/);
});

test("application failure clears the candidate and reports a safe error", () => {
  const f = fixture({ apply() { throw Error("private application failure"); } });
  f.preview(report());
  f.field("apply").click();
  assert.equal(f.field("apply").disabled, true);
  assert.equal(f.field("details").textContent, "");
  assert.doesNotMatch(f.field("status").textContent, /private application/);
});

test("reentrant apply callbacks cannot replay an already consumed candidate", () => {
  let f;
  f = fixture({ apply() { f.field("apply").click(); } });
  f.preview(report());
  f.field("apply").click();
  assert.equal(f.applications.length, 1);
});

test("dispose removes controls and makes retained buttons inert", () => {
  const f = fixture();
  f.preview(report());
  const apply = f.field("apply"), save = f.field("save"), text = f.field("json");
  f.panel.dispose();
  f.panel.dispose();
  apply.click();
  save.click();
  text.dispatchEvent(new Event("input"));
  assert.equal(f.parent.children.length, 0);
  assert.equal(f.applications.length, 0);
  assert.equal(text.value, "");
});

test("a failed export removes a previously serialized list instead of showing stale JSON", () => {
  const f = fixture();
  f.field("save").click();
  assert.notEqual(f.field("json").value, "");
  f.setLines(A + "\n" + A);
  f.field("save").click();
  assert.equal(f.field("json").value, "");
  assert.match(f.field("status").textContent, /重複/);
});

test("changed text rejected at application asks for another explicit preview", () => {
  const f = fixture();
  f.preview(report());
  f.field("json").value = report(selected, B);
  f.field("apply").click();
  assert.match(f.field("status").textContent, /もう一度内容を確認/);
  assert.equal(f.applications.length, 0);
  f.field("preview").click();
  f.field("apply").click();
  assert.deepEqual(f.applications, [B]);
});

test("bounded JSON at the exact text-area limit previews and applies without truncation", () => {
  const f = fixture();
  const raw = report();
  f.preview(raw + " ".repeat(8192 - raw.length));
  assert.equal(f.field("json").value.length, 8192);
  assert.equal(f.field("apply").disabled, false);
  f.field("apply").click();
  assert.deepEqual(f.applications, [A + "\n" + B]);
});

test("editing malformed text clears its accessible error but requires a fresh preview", () => {
  const f = fixture();
  f.preview("{");
  assert.equal(f.field("json").getAttribute("aria-invalid"), "true");
  f.input(report());
  assert.equal(f.field("json").getAttribute("aria-invalid"), "false");
  assert.equal(f.field("apply").disabled, true);
  f.field("preview").click();
  assert.equal(f.field("apply").disabled, false);
});

test("unsupported settings provide an actionable context hint without applying", () => {
  const f = fixture();
  f.setContext({ agent: "DAT", chainId: 1 });
  f.field("save").click();
  assert.match(f.field("status").textContent, /Baseチェーンの設定/);
  assert.equal(f.applications.length, 0);
  assert.equal(f.field("json").value, "");
});

test("invalid imported schema has a format hint without leaking the supplied data", () => {
  const f = fixture();
  f.preview('{"schema":"private-untrusted-payload"}');
  assert.match(f.field("status").textContent, /8,192文字以内/);
  assert.doesNotMatch(f.field("status").textContent, /private-untrusted/);
});

test("duplicate imported contracts have a specific corrective message", () => {
  const f = fixture();
  const value = JSON.parse(report());
  value.tokens = [A, A];
  f.preview(JSON.stringify(value));
  assert.match(f.field("status").textContent, /重複/);
  assert.equal(f.field("apply").disabled, true);
});

test("non-string error codes cannot invoke coercion while reporting a source failure", () => {
  let coerced = false;
  const f = fixture({ read() { throw { code: {
    toString() { coerced = true; throw Error("do not coerce"); },
  } }; } });
  assert.doesNotThrow(() => f.field("save").click());
  assert.equal(coerced, false);
  assert.match(f.field("status").textContent, /確認できません/);
  assert.equal(f.field("apply").disabled, true);
});
