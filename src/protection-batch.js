/** Run every cleanup even when an earlier view fails. No captured error text. */
export const PROTECTION_STEPS = Object.freeze(["exports", "file-reads", "backup", "period", "DAT", "EMA", "CAWELON"]);
export function runProtectionBatch(steps) {
  if (!Array.isArray(steps) || steps.length > PROTECTION_STEPS.length ||
      Reflect.ownKeys(steps).length !== steps.length + 1) throw TypeError("PROTECTION_CONFIG");
  const prepared = [], names = new Set();
  // Validate before any cleanup: configuration errors cannot leave an arbitrary prefix applied.
  for (let i = 0; i < steps.length; i++) {
    const row = Object.getOwnPropertyDescriptor(steps, String(i));
    if (!row || !("value" in row)) throw TypeError("PROTECTION_CONFIG");
    const value = row.value;
    if (!value || typeof value !== "object" ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
        Reflect.ownKeys(value).length !== 2) throw TypeError("PROTECTION_CONFIG");
    const name = Object.getOwnPropertyDescriptor(value, "name")?.value;
    const run = Object.getOwnPropertyDescriptor(value, "run")?.value;
    if (!PROTECTION_STEPS.includes(name) || names.has(name) || typeof run !== "function") {
      throw TypeError("PROTECTION_CONFIG");
    }
    names.add(name);
    prepared.push({ name, run });
  }
  const failed = [];
  for (const step of prepared) {
    try {
      const result = step.run();
      if (result && typeof result.then === "function") {
        Promise.resolve(result).catch(() => {});
        failed.push(step.name);
      } else if (result === false) failed.push(step.name);
    } catch { failed.push(step.name); }
  }
  return Object.freeze({ completed: failed.length === 0, attempted: prepared.length,
    failed: Object.freeze(failed) });
}
