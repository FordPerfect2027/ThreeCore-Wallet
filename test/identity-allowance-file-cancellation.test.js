import test from "node:test";
import assert from "node:assert/strict";
import { createTokenIdentityController } from "../src/token-identity-controller.js";
import { createAllowanceController } from "../src/allowance-controller.js";
import { observation, fileFor } from "./helpers/identity-fixtures.js";
import { targets, record, saved, ACCOUNT, S1, S2 } from "./helpers/allowance-fixtures.js";
import { deferred, tick } from "./helpers/file-boundary-fixtures.js";

const formats = [
  { name: "identity", create: subtle => createTokenIdentityController({ getContext: () => observation(), read: async () => observation(), subtle }),
    file: fileFor, ready: c => c.inspect(), export: c => c.prepareFile() },
  { name: "allowance", create: subtle => createAllowanceController({ getContext: () => ({ ...targets(), account: ACCOUNT }), read: async plan => record({ targets: plan }), subtle }),
    file: saved, ready: async c => { assert.equal(c.preview(S1 + " | Exchange A\n" + S2 + " | Exchange B"), true); assert.equal(c.apply(), true); return c.inspect(); }, export: c => c.prepare("observation") },
];

for (const format of formats) {
  for (const action of ["cancel", "dispose"]) {
    test(`${format.name}: ${action} ends the byte-read wait`, async () => {
      const c = format.create(), gate = deferred(); let settled = false, reads = 0;
      const pending = c.load({ name: "synthetic.json", size: 1, arrayBuffer() { reads++; return gate.promise; } }).then(result => { settled = true; return result; });
      try {
        await tick(); assert.equal(reads, 1); c[action](); await tick();
        assert.equal(settled, true); assert.equal(await pending, false);
      } finally { gate.resolve(new Uint8Array([32]).buffer); await pending; c.dispose(); await tick(); }
    });
    for (const operation of ["load", "export"]) {
      test(`${format.name}: ${action} ends ${operation} checksum wait`, async () => {
        const file = operation === "load" ? await format.file() : null;
        const gate = deferred(), started = deferred(); let settled = false;
        const c = format.create({ digest() { started.resolve(); return gate.promise; } });
        if (operation === "export") assert.equal(await format.ready(c), true);
        const pending = (operation === "load" ? c.load(file) : format.export(c)).then(result => { settled = true; return result; });
        try {
          await started.promise; c[action](); await tick();
          assert.equal(settled, true); assert.equal(await pending, false); assert.equal(c.state().file, null);
        } finally { gate.resolve(new ArrayBuffer(32)); await pending; c.dispose(); await tick(); }
      });
    }
  }
}
