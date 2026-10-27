import { mountWalletDemo } from "./wallet-demo.js";
import { ThreeCoreWalletSession } from "../src/wallet-session.js";
import { createBaseStateProvider } from "../src/base-state-provider.js";

// A same-origin external module works with script-src 'self'; no inline exception.
const start = () => mountWalletDemo({
  document, eventTarget: window, siteOrigin: window.location.origin,
  getLegacyProvider: () => window.ethereum,
  createSession: options => new ThreeCoreWalletSession({ ...options,
    ...(options.chainId === 8453 ? { stateProvider: createBaseStateProvider({
      agent: options.agent, account: options.expectedAccount, siteOrigin: options.siteOrigin,
    }) } : {}),
  }),
});
let app = start();
window.addEventListener("pagehide", () => { app?.dispose(); app = null; });
window.addEventListener("pageshow", () => { if (!app) app = start(); });
