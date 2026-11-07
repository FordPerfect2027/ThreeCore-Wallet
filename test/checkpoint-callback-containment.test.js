import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

for (const action of ["save", "saveQuick", "rename", "archive", "unarchive"]) {
  for (const kind of ["promise", "async-then"]) {
    const callbacks = action === "save" || action === "saveQuick" ? ["now", "createId"] : ["now"];
    for (const callback of callbacks) {
      test(`${action}: rejected ${kind} ${callback} is contained without changing saved records`, () => {
        const controller = new URL("../src/checkpoint-controller.js", import.meta.url).href;
        const fixtures = new URL("./helpers/checkpoint-fixtures.js", import.meta.url).href;
        const workspace = new URL("./helpers/workspace-fixtures.js", import.meta.url).href;
        const bad = kind === "promise" ? "Promise.reject(Error('private callback detail'))" :
          "({async then() { throw Error('private callback detail'); }})";
        const script = `
          import assert from 'node:assert/strict';
          import {createCheckpointController} from ${JSON.stringify(controller)};
          import {memoryStorage,id,TIME} from ${JSON.stringify(fixtures)};
          import {draft} from ${JSON.stringify(workspace)};
          const storage=memoryStorage(); let armed=false, count=0;
          const c=createCheckpointController({storage,readDraft:draft,onStage:()=>{},download:()=>{},
            now:()=>armed && ${JSON.stringify(callback)}==='now'?${bad}:TIME,
            createId:()=>armed && ${JSON.stringify(callback)}==='createId'?${bad}:id(++count)});
          await c.refresh(); assert.equal(await c.save('original'),true);
          if (${JSON.stringify(action)}==='unarchive') assert.equal(await c.archive(),true);
          const before=storage.current(); armed=true;
          assert.equal(await c[${JSON.stringify(action)}]('changed'),false);
          assert.deepEqual(storage.current(),before);
          assert.equal(c.state().errorCode,${JSON.stringify(callback === "now" ? "CHECKPOINT_TIME" : "CHECKPOINT_ID")});
          assert(!JSON.stringify(c.state()).includes('private callback detail'));
          c.dispose(); setTimeout(()=>console.log('contained'),10);
        `;
        const child = spawnSync(process.execPath,
          ["--unhandled-rejections=strict", "--input-type=module", "-e", script],
          { encoding: "utf8", timeout: 10000 });
        assert.equal(child.error, undefined);
        assert.equal(child.status, 0, child.stderr);
        assert.equal(child.stdout.trim(), "contained");
      });
    }
  }
}
