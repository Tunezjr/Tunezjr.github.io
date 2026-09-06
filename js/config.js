/**
 * Locked protocol config. Do not override from the page.
 */
export const config = Object.freeze({
  lendPoolAddress: "0xc779850835B7C6872f7B2893A4d4A2cCf3733F15",
  lendPoolImpl: "0xED898b078b3F29AAC60d7a4bB55cfa008CCb1914",
  lendPoolLoan: "0x60E7D784866b349c474411C9D2b4ee3B8eC00f0C",
  nftOracle: "0x8C8728E0867D68C13476fBaFB23A86871D18fB56",
  bUsdc: "0xf1aDB4D3BA36CF8D747cBea5Ef9160C5B4cF20D4",
  usdcAddress: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603",
  chainId: 143,
  chainIdHex: "0x8f",
  chainName: "Monad",
  rpcUrl: "https://rpc.monad.xyz",
  explorerUrl: "https://monadvision.com",
  nativeCurrency: Object.freeze({ name: "MON", symbol: "MON", decimals: 18 }),
  ltvPercent: 30,
  loanDays: 7,
  usdcDecimals: 6,
  feePercent: 3,
  walletConnectProjectId: "429370f458176860b6462c5c0aa74886",
});

export const DUST = Object.freeze({
  token: "0xad96c3dffcd6374294e2573a7fbba96097cc8d7c",
  veNft: "0xbb4738d05ad1b3da57a4881bae62ce9bb1eeed6c",
  pair: "0x86dbf00485871c901c5129bd525348db96c2eb2d",
  usdc: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603",
});

export const COLLECTIONS = Object.freeze([
  {
    id: "chog",
    name: "Chog Genesis",
    address: "0xc96d31f8626c6d03fae5dcd3d61e3fb9f4a73763",
    floorMon: 11800,
    items: 1454,
    live: true,
    opensea: "https://opensea.io/collection/chog-genesis",
  },
  {
    id: "r3tards",
    name: "r3tards",
    address: "0x200723a706de0013316e5cd8eba2b3f53dd90c29",
    floorMon: 5500,
    items: 1033,
    live: true,
    opensea: "https://opensea.io/collection/r3tardsnft",
  },
  {
    id: "skrumpeys",
    name: "skrumpeys",
    address: "0xb0dad798c80e40dd6b8e8545074c6a5b7b97d2c0",
    floorMon: 3343,
    items: 3333,
    live: true,
    opensea: "https://opensea.io/collection/skrumpeys",
  },
  {
    id: "squad10k",
    name: "The 10k Squad",
    address: "0x818030837e8350ba63e64d7dc01a547fa73c8279",
    floorMon: 2399,
    items: 3333,
    live: true,
    opensea: "https://opensea.io/collection/the-10k-squad-350905768",
  },
  {
    id: "vedust",
    name: "Voting Escrow DUST",
    address: "0xbb4738d05ad1b3da57a4881bae62ce9bb1eeed6c",
    floorMon: 17,
    items: 0,
    live: true,
    valuation: "locked-dust",
    opensea: "https://opensea.io/collection/voting-escrow-dust",
  },
]);

const IMPL_SLOT =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

export function isWalletConnectConfigured() {
  return /^[a-f0-9]{32}$/i.test(config.walletConnectProjectId || "");
}

export function isHexAddress(value) {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

export function isTokenId(value) {
  return /^[0-9]{1,78}$/.test(value);
}

export function shortAddress(addr) {
  if (!addr) return "";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function money(n, digits = 2) {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function toUsdcUnits(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) throw new Error("Enter a USDC amount greater than 0");
  return BigInt(Math.round(n * 10 ** config.usdcDecimals));
}

export function fromUsdcUnits(raw) {
  return Number(raw) / 10 ** config.usdcDecimals;
}

export async function verifyPool(rpcCall) {
  if (!isHexAddress(config.lendPoolAddress)) {
    return { ok: false, reason: "LendPool address is missing" };
  }
  const code = await rpcCall({
    method: "eth_getCode",
    params: [config.lendPoolAddress, "latest"],
  });
  if (!code || code === "0x") {
    return { ok: false, reason: "LendPool has no bytecode on Monad" };
  }
  const slot = await rpcCall({
    method: "eth_getStorageAt",
    params: [config.lendPoolAddress, IMPL_SLOT, "latest"],
  });
  const impl = slot && slot !== "0x" ? `0x${slot.slice(-40)}` : "";
  if (impl.toLowerCase() !== config.lendPoolImpl.toLowerCase()) {
    return {
      ok: false,
      reason: `Unexpected LendPool implementation ${impl || "(none)"}`,
    };
  }
  const chainId = await rpcCall({ method: "eth_chainId", params: [] });
  if (String(chainId).toLowerCase() !== config.chainIdHex.toLowerCase()) {
    return { ok: false, reason: "RPC is not Monad (chain 143)" };
  }
  return { ok: true, impl };
}
