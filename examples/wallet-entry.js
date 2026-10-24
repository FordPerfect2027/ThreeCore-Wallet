import { mountWalletDemo } from "./wallet-demo.js";

// A same-origin external module works with script-src 'self'; no inline exception.
const start = () => mountWalletDemo({
  document, eventTarget: window, siteOrigin: window.location.origin,
  getLegacyProvider: () => window.ethereum,
});
let app = start();
window.addEventListener("pagehide", () => { app?.dispose(); app = null; });
window.addEventListener("pageshow", () => { if (!app) app = start(); });
