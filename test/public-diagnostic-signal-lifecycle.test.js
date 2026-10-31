import test from "node:test";
import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { createPublicBaseRpcReader } from "../src/public-base-rpc.js";
const rpcUrl = "https://mainnet.base.org", tick = () => new Promise(setImmediate);
const safe = code => error => error.code === code && !error.message.includes("PRIVATE");

test("a signal proxy that rejects event registration produces a public error before transport", async () => {
  const controller = new AbortController(); let calls = 0;
  const signal = new Proxy(controller.signal, { get(target, key) {
    if (typeof key === "symbol" && String(key).includes("kEvents")) throw Error("PRIVATE_REGISTRATION");
    return Reflect.get(target, key, target);
  } });
  await assert.rejects(async () => {
    const read = createPublicBaseRpcReader({ rpcUrl, signal, fetchImpl() { calls++; throw Error("unexpected"); } });
    await read("eth_chainId");
  }, safe("INVALID_SIGNAL"));
  assert.equal(calls, 0); assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});
test("partial registration failure removes the installed callback and does not call fetch", async () => {
  const controller = new AbortController(); let calls = 0;
  const add = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (...args) {
    const result = Reflect.apply(add, this, args);
    if (this === controller.signal) throw Error("PRIVATE_AFTER_REGISTRATION");
    return result;
  };
  try {
    const read = createPublicBaseRpcReader({ rpcUrl, signal: controller.signal, fetchImpl() { calls++; throw Error("unexpected"); } });
    await assert.rejects(read("eth_chainId"), safe("INVALID_SIGNAL"));
    assert.equal(calls, 0); assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  } finally { EventTarget.prototype.addEventListener = add; }
});
test("an abort during failed registration keeps cancellation and consumes its rejected stop promise", async () => {
  const controller = new AbortController(); let calls = 0;
  const add = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (...args) {
    const result = Reflect.apply(add, this, args);
    if (this === controller.signal) { controller.abort(); throw Error("PRIVATE_AFTER_ABORT"); }
    return result;
  };
  try {
    const read = createPublicBaseRpcReader({ rpcUrl, signal: controller.signal, fetchImpl() { calls++; throw Error("unexpected"); } });
    await assert.rejects(read("eth_chainId"), safe("RPC_CANCELLED")); await tick();
    assert.equal(calls, 0); assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  } finally { EventTarget.prototype.addEventListener = add; }
});
test("failure reading signal state after registration still releases the installed callback", async () => {
  const controller = new AbortController(); let added = false, calls = 0;
  const signal = new Proxy(controller.signal, { get(target, key) {
    if (typeof key === "symbol" && String(key).includes("kAborted") && added) throw Error("PRIVATE_STATE");
    return Reflect.get(target, key, target);
  } });
  const add = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (...args) {
    const result = Reflect.apply(add, this, args);
    if (this === signal) added = true;
    return result;
  };
  try {
    await assert.rejects(async () => {
      const read = createPublicBaseRpcReader({ rpcUrl, signal, fetchImpl() { calls++; throw Error("unexpected"); } });
      await read("eth_chainId");
    }, safe("INVALID_SIGNAL"));
    assert.equal(added, true); assert.equal(calls, 0); assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  } finally { EventTarget.prototype.addEventListener = add; }
});
test("a cleanup exception after listener removal cannot replace a successful public result", async () => {
  const controller = new AbortController(), remove = EventTarget.prototype.removeEventListener;
  EventTarget.prototype.removeEventListener = function (...args) {
    const result = Reflect.apply(remove, this, args);
    if (this === controller.signal) throw Error("PRIVATE_CLEANUP");
    return result;
  };
  try {
    const read = createPublicBaseRpcReader({ rpcUrl, signal: controller.signal, fetchImpl: async (_url, options) => {
      const request = JSON.parse(options.body); return Response.json({ jsonrpc: "2.0", id: request.id, result: "0x2105" });
    } });
    assert.equal(await read("eth_chainId"), "0x2105");
    assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  } finally { EventTarget.prototype.removeEventListener = remove; }
});
