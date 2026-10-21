// Read only JS assets already loaded from the exact official origin.
// Never evaluate downloaded source or follow redirects to another origin.
import { createHash } from "node:crypto";
const origin = "https://aerodrome.finance";
export async function inspectPublicAppScripts(urls) {
  const selected = [...new Set(urls)].filter(value => {
    try { const u = new URL(value); return u.origin === origin && u.pathname.endsWith(".js") && !u.username && !u.password; }
    catch { return false; }
  }).slice(0, 24);
  return Promise.all(selected.map(async url => {
    try {
      const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw Error("HTTP " + response.status);
      const reader = response.body.getReader();
      const chunks = []; let size = 0;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 6 * 1024 * 1024) { await reader.cancel(); throw Error("Asset exceeds diagnostic limit"); }
        chunks.push(Buffer.from(value));
      }
      const bytes = Buffer.concat(chunks), source = bytes.toString("utf8");
      const patterns = ["Browser Wallet", "eip6963:requestProvider", "eip6963:announceProvider",
        "window.ethereum", "ProviderNotFoundError", "function qF", "qF=", 'id:"injected"',
        "async getProvider", "multiInjectedProviderDiscovery"];
      const excerpts = [];
      for (const pattern of patterns) {
        let cursor = 0;
        for (let i = 0; i < 3; i++) {
          const index = source.indexOf(pattern, cursor);
          if (index === -1) break;
          excerpts.push({ pattern, offset: index, text: source.slice(Math.max(0, index - 350), index + 650) });
          cursor = index + pattern.length;
        }
      }
      return { url, bytes: size, sha256: createHash("sha256").update(bytes).digest("hex"), excerpts };
    } catch (error) { return { url, error: error.message }; }
  }));
}
