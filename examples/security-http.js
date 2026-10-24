/** Local development server boundary. No authentication claim is made. */
export const SECURITY_HEADERS = Object.freeze({
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "cross-origin-resource-policy": "same-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=()",
  "content-security-policy": [
    "default-src 'none'", "script-src 'self'", "style-src 'self' 'unsafe-inline'",
    "connect-src 'self'", "img-src 'self' data:", "font-src 'self'",
    "object-src 'none'", "base-uri 'none'", "frame-ancestors 'none'",
    "frame-src 'none'", "form-action 'none'", "worker-src 'none'",
  ].join("; "),
});

function hostOrigin(host, port) {
  if (typeof host !== "string" || host.length > 80 ||
      !Number.isSafeInteger(port) || port < 1 || port > 65535) return null;
  const expected = String(port);
  if (host !== "127.0.0.1:" + expected && host !== "localhost:" + expected &&
      host !== "[::1]:" + expected) return null;
  return "http://" + host;
}

/** Host + exact Origin + Fetch Metadata. No reliance on CORS alone. */
export function inspectLocalRequest(request) {
  const origin = hostOrigin(request.headers?.host, request.socket?.localPort);
  if (!origin) return { status: 403, reason: "Local origin required" };
  const suppliedOrigin = request.headers.origin;
  if (suppliedOrigin !== undefined && suppliedOrigin !== origin) {
    return { status: 403, reason: "Cross-origin request refused" };
  }
  const site = request.headers["sec-fetch-site"];
  if (site !== undefined && !["none", "same-origin"].includes(site)) {
    return { status: 403, reason: "Cross-origin request refused" };
  }
  const destination = request.headers["sec-fetch-dest"];
  if (["iframe", "frame", "object", "embed"].includes(destination)) {
    return { status: 403, reason: "Embedding refused" };
  }
  const target = request.url;
  if (typeof target !== "string" || target.length > 2048 || !target.startsWith("/") ||
      target.startsWith("//") || /[\\\u0000-\u0020\u007f]/.test(target) || /%(?![0-9a-f]{2})/i.test(target)) {
    return { status: 400, reason: "Invalid request target" };
  }
  let url;
  try { url = new URL(target, origin); }
  catch { return { status: 400, reason: "Invalid request target" }; }
  if (url.origin !== origin || url.hash) return { status: 400, reason: "Invalid request target" };
  return { status: 200, pathname: url.pathname };
}
