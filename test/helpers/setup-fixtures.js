import { WALLET_SETUP_SCHEMA } from "../../src/wallet-setup.js";

export const A = "0x" + "ab".repeat(20);
export const B = "0x" + "cd".repeat(20);
export const C = "0x" + "ef".repeat(20);
export function setup(accounts = [A, B, C], chains = [84532, 84532, 84532]) {
  return { schema: WALLET_SETUP_SCHEMA, entries: ["DAT", "EMA", "CAWELON"].map((agent, index) => ({
    agent, account: accounts[index], chainId: chains[index],
  })) };
}
export function raw(accounts = ["", "", ""], chains) {
  return setup(accounts, chains).entries;
}
export const clone = value => structuredClone(value);
export const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
export function fileFor(text, name = "wallet-settings.json") {
  const bytes = new TextEncoder().encode(text);
  return { name, size: bytes.length, arrayBuffer: async () => bytes.buffer };
}
