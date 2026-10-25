import { createCheckpointController } from "../../src/checkpoint-controller.js";
import { memoryStorage, stored, preparedDraft, id } from "./checkpoint-fixtures.js";
import { draft } from "./workspace-fixtures.js";

export const CHECKPOINT_HANDOFFS = ["exportFile", "exportCollection", "stage"];
export async function checkpointReceiptFixture(receive = () => true) {
  const file = await preparedDraft();
  const storage = memoryStorage(stored(1, file.text));
  let callback = receive;
  const controller = createCheckpointController({ storage, readDraft: () => draft(),
    download: value => callback(value), onStage: value => callback(value) });
  if (!await controller.refresh() || !controller.select(id(1))) throw Error("checkpoint fixture setup");
  return { controller, storage, file,
    setCallback(value) { callback = value; },
    async send(action) {
      if (action === "stage" && !await controller.inspect()) throw Error("checkpoint inspection setup");
      return controller[action]();
    },
    dispose: () => controller.dispose(),
  };
}
