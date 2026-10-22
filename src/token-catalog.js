import { identityAddress, identityFail, identityObject } from "./token-identity-codec.js";

export const TOKEN_CATALOG_VERSION = "threecore-erc20-2026-10-23";

// Published ERC-20 identities. These are not training-credit contracts.
// Mainnet references were checked against each repository's public README.
const definitions = [
  {
    agent: "DAT", name: "DATCORE", symbol: "DAT", decimals: 18,
    initialSupply: "1000000000000000000000000000",
    mainnet: "0x6c83dd253F2F882B9884Fd1ac3A7754ED6405de5",
    sepolia: "0x2474A062Ec669C1912Ed41Bc491E8a97db4743D4",
    repository: "https://github.com/FordPerfect2027/DAT",
    website: "https://datcore.fun/",
  },
  {
    agent: "EMA", name: "EMA CORE", symbol: "EMA", decimals: 18,
    initialSupply: "777000000000000000000000000",
    mainnet: "0xBaE0933d509b83B7bbAb3AaB9feD413504382a76",
    sepolia: "0x20C3bb2548a1CE188229A6128dF0e9612259185E",
    repository: "https://github.com/FordPerfect2027/EMA-Draft",
    website: "https://emacore.fun/",
  },
  {
    agent: "CAWELON", name: "CAWELON CORE", symbol: "CAWELON", decimals: 18,
    initialSupply: "420000000000000000000000000000000",
    mainnet: "0xB4654b5a4617Fe2c27a0DD6EAEe98F8AA941b895",
    sepolia: "0x9c2aeb2f80e074DaC065d0E5dB41c2f01feD280f",
    repository: "https://github.com/FordPerfect2027/CAWELON-Draft",
    website: "https://cawelon.fun/",
  },
];

export const TOKEN_CATALOG = Object.freeze(definitions.flatMap(item =>
  [8453, 84532].map(chainId => Object.freeze({
    catalogVersion: TOKEN_CATALOG_VERSION,
    agent: item.agent,
    chainId,
    address: identityAddress(chainId === 8453 ? item.mainnet : item.sepolia),
    name: item.name,
    symbol: item.symbol,
    decimals: item.decimals,
    initialSupply: item.initialSupply,
    networkLabel: chainId === 8453 ? "Base Mainnet" : "Base Sepolia",
    testnet: chainId === 84532,
    repository: item.repository,
    website: item.website,
    explorer: (chainId === 8453 ? "https://base.blockscout.com/address/" :
      "https://base-sepolia.blockscout.com/address/") +
      identityAddress(chainId === 8453 ? item.mainnet : item.sepolia) + "?tab=contract",
  })),
));

export function tokenCatalogContext(input) {
  identityObject(input, ["agent", "chainId"]);
  if (!["DAT", "EMA", "CAWELON"].includes(input.agent) ||
      ![8453, 84532].includes(input.chainId)) identityFail("IDENTITY_CONTEXT");
  return Object.freeze({ agent: input.agent, chainId: input.chainId });
}

export function catalogToken(input) {
  const context = tokenCatalogContext(input);
  return TOKEN_CATALOG.find(item => item.agent === context.agent && item.chainId === context.chainId);
}

export function lookupCatalogToken(chainId, address) {
  if (![8453, 84532].includes(chainId)) identityFail("IDENTITY_CONTEXT");
  const normalized = identityAddress(address);
  return TOKEN_CATALOG.find(item => item.chainId === chainId && item.address === normalized) ?? null;
}

/** Compare configuration only. It does not assert code exists at the address. */
export function reviewCatalogAddress(context, input) {
  const expected = catalogToken(context);
  const actual = identityAddress(input);
  const recognized = lookupCatalogToken(expected.chainId, actual);
  const otherChain = TOKEN_CATALOG.find(item => item.chainId !== expected.chainId && item.address === actual);
  return Object.freeze({
    expected,
    address: actual,
    matches: actual === expected.address,
    classification: actual === expected.address ? "expected" :
      recognized ? "other-agent" : otherChain ? "other-network" : "unrecognized",
    recognizedAgent: recognized?.agent ?? otherChain?.agent ?? null,
    recognizedChain: recognized?.chainId ?? otherChain?.chainId ?? null,
    codeVerified: false,
  });
}

/** A review token for inserting one expected contract into an existing form. */
export function createCatalogSelection() {
  let review = null;
  let generation = 0;
  return Object.freeze({
    preview(context, currentText) {
      if (typeof currentText !== "string" || currentText.length > 8192) identityFail("IDENTITY_INPUT");
      const selected = catalogToken(context);
      review = Object.freeze({ id: ++generation, agent: selected.agent,
        chainId: selected.chainId, before: currentText, address: selected.address });
      return review;
    },
    apply(id, context, currentText) {
      const selected = catalogToken(context);
      const candidate = review;
      review = null;
      generation++;
      if (!candidate || candidate.id !== id) identityFail("IDENTITY_REVIEW_REQUIRED");
      if (candidate.agent !== selected.agent || candidate.chainId !== selected.chainId ||
          candidate.before !== currentText) identityFail("IDENTITY_STALE");
      return candidate.address;
    },
    cancel() { review = null; generation++; },
  });
}
