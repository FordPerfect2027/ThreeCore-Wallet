import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createTokenIdentityController } from "../src/token-identity-controller.js";
import { observation, deferred } from "./helpers/identity-fixtures.js";

const row = observation();
const getContext = () => ({ agent: row.agent, chainId: row.chainId, account: row.account, tokenAddress: row.tokenAddress });

test("identity observer cancellation has bounded synchronous delivery", async () => {
  let controller, notifications = 0, reads = 0;
  controller = createTokenIdentityController({ getContext,
    read: async () => { reads++; return row; },
    onChange() { if (++notifications < 16) controller.cancel(); },
  });
  assert.equal(await controller.inspect(), false);
  assert.equal(reads, 0);
  assert.ok(notifications <= 2, `received ${notifications} recursive notifications`);
  assert.equal(controller.state().phase, "cancelled");
});

test("identity disposal closes observers before clearing state", async () => {
  let controller, notifications = 0;
  controller = createTokenIdentityController({ getContext, read: async () => row,
    onChange() { notifications++; },
  });
  await controller.inspect();
  controller.useAsBaseline();
  const previous = notifications;
  controller.dispose();
  assert.equal(notifications, previous);
  assert.equal(controller.state().phase, "disposed");
  assert.equal(controller.state().observation, null);
  assert.equal(controller.state().baseline, null);
});

test("identity observer disposal aborts a pending read once and remains terminal", async () => {
  const gate = deferred();
  let controller, aborts = 0, notifications = 0;
  controller = createTokenIdentityController({ getContext,
    read: input => { input.signal.addEventListener("abort", () => { aborts++; controller.cancel(); }); return gate.promise; },
    onChange() { notifications++; },
  });
  const pending = controller.inspect();
  const previous = notifications;
  controller.dispose();
  gate.resolve(row);
  assert.equal(await pending, false);
  assert.equal(aborts, 1);
  assert.equal(notifications, previous);
  assert.equal(controller.state().phase, "disposed");
});

for (const kind of ["promise", "async-then"]) {
  test(`identity observer ${kind} rejection is consumed`, () => {
    const controllerUrl = new URL("../src/token-identity-controller.js", import.meta.url).href;
    const fixtureUrl = new URL("./helpers/identity-fixtures.js", import.meta.url).href;
    const child = spawnSync(process.execPath, ["--unhandled-rejections=strict", "--input-type=module", "-e", `
      import { createTokenIdentityController } from ${JSON.stringify(controllerUrl)};
      import { observation } from ${JSON.stringify(fixtureUrl)};
      const row=observation();
      const controller=createTokenIdentityController({
        getContext:()=>({agent:row.agent,chainId:row.chainId,account:row.account,tokenAddress:row.tokenAddress}),
        read:async()=>row,
        onChange:()=>${kind === "promise" ? "Promise.reject(Error('synthetic observer rejection'))" : "({async then(){throw Error('synthetic then rejection');}})"}
      });
      if(!await controller.inspect())throw Error('read failed');
      setTimeout(()=>console.log('contained'),15);
    `], { timeout: 10000, encoding: "utf8", windowsHide: true });
    assert.equal(child.error, undefined);
    assert.equal(child.status, 0, child.stderr);
    assert.equal(child.stderr, "");
    assert.equal(child.stdout.trim(), "contained");
  });
}
