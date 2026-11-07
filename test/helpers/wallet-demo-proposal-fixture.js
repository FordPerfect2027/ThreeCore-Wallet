import assert from "node:assert/strict";
import { mountWalletDemo } from "../../examples/wallet-demo.js";
import { ThreeCoreWalletSession, AGENT_IDS } from "../../src/wallet-session.js";
import { createRpcSupervisor } from "../../src/rpc-supervisor.js";
import { createFileReadService } from "../../src/file-read-service.js";
import { createStorageGuard } from "../../src/storage-guard.js";

// Only the DOM operations used by the normal demo are modelled here. Native
// layout, browser networking and download behavior need the separate browser gate.
class TextNode {
  constructor(text) { this.textContent = String(text); this.parentNode = null; }
  remove() { if (this.parentNode) this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1); this.parentNode = null; }
}
class DemoElement extends EventTarget {
  constructor(tag, document) {
    super(); this.tagName = tag.toUpperCase(); this.ownerDocument = document;
    this.children = []; this.parentNode = null; this.attributes = new Map();
    this.dataset = {}; this.className = ""; this.id = ""; this.disabled = false;
    this.hidden = false; this.checked = false; this.files = []; this._value = null;
  }
  get parentElement() { return this.parentNode; }
  get textContent() { return this.children.map(child => child.textContent).join(""); }
  set textContent(value) { this.replaceChildren(new TextNode(value ?? "")); }
  get value() { return this._value ?? (this.tagName === "SELECT" ? this.options[0]?.value ?? "" : ""); }
  set value(value) { this._value = String(value); }
  get options() { return this.querySelectorAll("option"); }
  get selectedOptions() { return this.options.filter(option => option.value === this.value); }
  append(...items) {
    for (let item of items) {
      if (typeof item !== "object") item = new TextNode(item);
      item.remove(); item.parentNode = this; this.children.push(item);
    }
  }
  appendChild(item) { this.append(item); return item; }
  add(item) { this.append(item); }
  replaceChildren(...items) {
    for (const child of this.children) child.parentNode = null;
    this.children = []; if (this.tagName === "SELECT") this._value = null;
    this.append(...items);
  }
  insertBefore(item, reference) {
    if (reference === null) { this.append(item); return item; }
    item.remove(); const index = this.children.indexOf(reference);
    assert.notEqual(index, -1); item.parentNode = this; this.children.splice(index, 0, item); return item;
  }
  before(item) { this.parentNode?.insertBefore(item, this); }
  remove() {
    if (this.parentNode) this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1);
    this.parentNode = null;
  }
  setAttribute(name, value) {
    value = String(value); this.attributes.set(name, value);
    if (name === "class") this.className = value;
    else if (name === "id") this.id = value;
    else if (name === "value") this.value = value;
    else if (name.startsWith("data-")) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
    else if (["type", "name", "role"].includes(name)) this[name] = value;
  }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  matches(selector) {
    const attributes = [...selector.matchAll(/\[([\w-]+)(?:=["']?([^\]"']*)["']?)?\]/g)];
    const base = selector.replace(/\[[^\]]*\]/g, "");
    const tag = base.match(/^[\w-]+/)?.[0];
    if (tag && this.tagName !== tag.toUpperCase()) return false;
    for (const [, kind, value] of base.matchAll(/([.#])([\w-]+)/g)) {
      if (kind === "#" ? this.id !== value : !this.className.split(/\s+/).includes(value)) return false;
    }
    return attributes.every(([, name, value]) => {
      const actual = name.startsWith("data-") ? this.dataset[name.slice(5)] : this[name] ?? this.getAttribute(name);
      return value === undefined ? actual !== null && actual !== undefined : String(actual) === value;
    });
  }
  querySelectorAll(selector) {
    const parts = selector.trim().split(/\s+/), found = [];
    const visit = node => {
      for (const child of node.children) if (child instanceof DemoElement) {
        if (child.matches(parts.at(-1))) {
          let ancestor = child.parentNode, index = parts.length - 2;
          while (index >= 0 && ancestor) { if (ancestor.matches?.(parts[index])) index--; ancestor = ancestor.parentNode; }
          if (index < 0) found.push(child);
        }
        visit(child);
      }
    };
    visit(this); return found;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  set innerHTML(text) {
    this.replaceChildren(); const stack = [this], voids = new Set(["INPUT", "BR", "HR", "IMG", "META", "LINK"]);
    for (const token of text.match(/<[^>]+>|[^<]+/g) ?? []) {
      if (token.startsWith("</")) { stack.pop(); continue; }
      if (!token.startsWith("<")) { stack.at(-1).append(new TextNode(token)); continue; }
      const tag = token.match(/^<([\w-]+)/)?.[1]; assert.ok(tag);
      const element = this.ownerDocument.createElement(tag);
      const attributes = token.slice(tag.length + 1, -1);
      for (const [, name, double, single, bare] of attributes.matchAll(/([\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
        element.setAttribute(name, double ?? single ?? bare ?? "");
      }
      stack.at(-1).append(element); if (!voids.has(element.tagName)) stack.push(element);
    }
  }
  dispatchEvent(event) {
    const result = super.dispatchEvent(event);
    if (event.bubbles && !event.cancelBubble) this.parentNode?.dispatchEvent(new Event(event.type, { bubbles: true, cancelable: event.cancelable }));
    return result;
  }
  click() { if (!this.disabled) this.dispatchEvent(new Event("click", { bubbles: true })); }
  focus() { this.ownerDocument.activeElement = this; }
}
class DemoDocument extends EventTarget {
  constructor(origin) {
    super(); this.defaultView = new EventTarget(); this.visibilityState = "visible";
    Object.assign(this.defaultView, { setTimeout, clearTimeout, performance, URL, Blob,
      location: { origin }, isSecureContext: true });
    this.body = this.createElement("body"); const grid = this.createElement("main"); grid.id = "grid"; this.body.append(grid);
  }
  createElement(tag) { return new DemoElement(tag, this); }
  querySelector(selector) { return this.body.querySelector(selector); }
  querySelectorAll(selector) { return this.body.querySelectorAll(selector); }
}

export const DEMO_PROPOSAL_ORIGIN = "https://demo-fixture.example";
export const DEMO_PROPOSAL_AGENTS = Object.freeze([...AGENT_IDS]);
export async function demoProposalTick() { await new Promise(resolve => setImmediate(resolve)); }

export function createWalletDemoProposalFixture(options = {}) {
  const origin = options.origin ?? DEMO_PROPOSAL_ORIGIN;
  const document = new DemoDocument(origin), eventTarget = document.defaultView;
  const requests = [], rpc = [], providers = new Map(), sessions = new Map();
  const accounts = new Map(), tokens = new Map(), spenders = new Map(), uuids = new Map();
  const rpcSupervisor = createRpcSupervisor(), fileReadService = createFileReadService(), storageGuard = createStorageGuard();
  let app, responseSequence = 0;
  for (const [index, agent] of AGENT_IDS.entries()) {
    accounts.set(agent, "0x" + String(index + 1).repeat(40));
    tokens.set(agent, "0x" + String(index + 4).repeat(40));
    spenders.set(agent, "0x" + String(index + 7).repeat(40));
    uuids.set(agent, `${String(index + 1).repeat(8)}-1111-4111-8111-111111111111`);
    const listeners = new Map();
    providers.set(agent, {
      on(name, action) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(action); },
      removeListener(name, action) { listeners.get(name)?.delete(action); },
      emit(name, value) { for (const action of [...listeners.get(name) ?? []]) action(value); },
      async request(args) {
        rpc.push({ agent, ...structuredClone(args) });
        if (["eth_requestAccounts", "eth_accounts"].includes(args.method)) return [accounts.get(agent)];
        if (args.method === "eth_chainId") return "0x14a34";
        if (args.method === "eth_getBlockByNumber") return { number: "0x2a", hash: "0x" + "ab".repeat(32) };
        if (args.method === "eth_getCode") return "0x6000";
        if (args.method === "eth_call") return "0x" + (args.params[0].data.startsWith("0xdd62ed3e") ? "0" : "7").padStart(64, "0");
        if (args.method === "eth_getBalance") return "0x7";
        throw Error("Unexpected synthetic RPC method");
      },
    });
  }
  const announce = () => {
    for (const agent of AGENT_IDS) {
      const event = new Event("eip6963:announceProvider");
      Object.defineProperty(event, "detail", { value: { info: { uuid: uuids.get(agent), name: agent + " synthetic wallet", rdns: "test." + agent.toLowerCase() }, provider: providers.get(agent) } });
      eventTarget.dispatchEvent(event);
    }
  };
  eventTarget.addEventListener("eip6963:requestProvider", announce);
  const response = agent => {
    const context = app.readProposalContext(agent); assert.ok(context, "Current proposal context required");
    const policy = JSON.parse(context.policyText), now = Date.now();
    const proposalText = JSON.stringify({ schema: "threecore-agent-read-proposal-v1", id: "synthetic-response-" + (++responseSequence),
      agent, account: policy.account, chainId: policy.chainId, siteOrigin: policy.siteOrigin,
      connectionEpoch: context.sessionState.connectionEpoch, policyRevision: policy.revision,
      createdAtMs: now, expiresAtMs: now + 60000, rationale: "Synthetic unit fixture inspection",
      action: { kind: "inspect-spender", ...policy.targets[0] } });
    return new Response(JSON.stringify({ status: "unexecuted-model-proposal", executed: false, grantsAuthority: false,
      review: { untrusted: true }, proposalText }), { headers: { "content-type": "application/json" } });
  };
  const fetchImpl = (url, init) => {
    const body = JSON.parse(init.body); requests.push({ url, body, signal: init.signal, credentials: init.credentials, referrerPolicy: init.referrerPolicy });
    return options.fetchImpl ? options.fetchImpl(url, init, body) : response(body.agent);
  };
  const proposalTransport = Object.hasOwn(options, "proposalTransport") ? options.proposalTransport : { origin, enabled: true, fetchImpl };
  try {
    app = mountWalletDemo({ document, eventTarget, siteOrigin: origin, getLegacyProvider: () => undefined,
      rpcSupervisor, fileReadService, storageGuard, proposalTransport,
      createSession(config) {
        const session = new ThreeCoreWalletSession({ ...config, readTimeoutMs: 2000, connectTimeoutMs: 2000, permissionTimeoutMs: 2000 });
        sessions.set(config.agent, session); return session;
      },
    });
  } catch (error) { rpcSupervisor.dispose(); fileReadService.dispose(); storageGuard.dispose(); throw error; }
  const card = (agent, selector) => {
    const root = document.querySelector(`[data-agent="${agent}"]`);
    return selector ? root?.querySelector(selector) ?? null : root;
  };
  const input = (agent, selector, value, type = "input") => {
    const element = card(agent, selector); assert.ok(element, selector); element.value = value;
    element.dispatchEvent(new Event(type, { bubbles: true }));
  };
  const click = (agent, selector) => { const element = card(agent, selector); assert.ok(element, selector); assert.equal(element.disabled, false, selector + " is enabled"); element.click(); };
  const settle = async (agent) => {
    for (let count = 0; count < 100; count++) {
      await demoProposalTick();
      if ((agent ? [agent] : AGENT_IDS).every(id => card(id, ".agent-proposal-panel")?.getAttribute("aria-busy") !== "true")) return;
    }
    throw Error("Synthetic proposal UI did not settle");
  };
  return {
    app, document, eventTarget, providers, sessions, accounts, tokens, spenders, requests, rpc, response,
    card, input, click, settle,
    grant(agent, patch = {}) { return { agent, token: String.fromCharCode(97 + AGENT_IDS.indexOf(agent)).repeat(64),
      expiresAtMs: Date.now() + 120000, endpoint: origin + "/api/agent/proposal", ...patch }; },
    async prepare(agent) {
      input(agent, ".provider", uuids.get(agent), "change");
      input(agent, ".account", accounts.get(agent)); input(agent, ".token", tokens.get(agent)); input(agent, ".spender", spenders.get(agent));
      click(agent, ".connect");
      for (let count = 0; count < 100 && card(agent, ".read").disabled; count++) await demoProposalTick();
      assert.equal(card(agent, ".read").disabled, false, "Explicit synthetic connection completed");
      click(agent, ".agent-proposal-apply"); click(agent, ".agent-proposal-build");
      assert.ok(app.readProposalContext(agent), "Explicit policy is readable");
      return app.readProposalContext(agent);
    },
    dispose() { app.dispose(); rpcSupervisor.dispose(); fileReadService.dispose(); storageGuard.dispose(); eventTarget.removeEventListener("eip6963:requestProvider", announce); },
  };
}
