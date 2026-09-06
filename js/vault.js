import { config, isHexAddress, isTokenId, shortAddress } from "./config.js";
import { getAddress } from "./wallet.js";
import { explorerTx, readOwner, sendTx, waitReceipt } from "./pool.js";

const VAULT_KEY = "lender-mera-vault-v1";
const SEL = {
  transferFrom: "0x23b872dd",
  setApprovalForAll: "0xa22cb465",
  borrow: "0xb6529aee",
};

let meraMod = null;

function padAddr(addr) {
  return addr.slice(2).toLowerCase().padStart(64, "0");
}
function padUint(value) {
  return BigInt(value).toString(16).padStart(64, "0");
}
function padBool(v) {
  return (v ? 1 : 0).toString(16).padStart(64, "0");
}
function toHex(bytes) {
  return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

async function loadMera() {
  if (meraMod) return meraMod;
  meraMod = await import("https://esm.sh/@category-labs/mera@0.2.0");
  return meraMod;
}

function rpId() {
  return window.location.hostname;
}

export function loadVaultRecord() {
  try {
    const raw = JSON.parse(localStorage.getItem(VAULT_KEY) || "null");
    if (!raw?.address || !raw?.vault) return null;
    return raw;
  } catch {
    return null;
  }
}

function saveVaultRecord(record) {
  localStorage.setItem(VAULT_KEY, JSON.stringify(record));
}

export async function createOrOpenVault() {
  const mera = await loadMera();
  const existing = loadVaultRecord();
  if (existing) {
    const secret = await mera.decryptSecretVaultWithPasskey({
      vault: mera.parseSecretVault(existing.vault),
      rpId: rpId(),
    });
    const session = mera.createSecp256k1SigningSession({ privateKey: secret });
    const address = mera.getEvmAddress(session.publicKey);
    session.end();
    if (address.toLowerCase() !== existing.address.toLowerCase()) {
      throw new Error("Passkey opened a different vault than the one stored here");
    }
    return { address, secret, reused: true };
  }

  const secret = crypto.getRandomValues(new Uint8Array(32));
  const vault = await mera.createSecretVaultWithNewPasskey({
    rp: { id: rpId(), name: "Lender" },
    user: { name: "lender-vault", displayName: "Lender vault" },
    secret,
  });
  const session = mera.createSecp256k1SigningSession({ privateKey: secret });
  const address = mera.getEvmAddress(session.publicKey);
  session.end();
  saveVaultRecord({ address, vault, createdAt: Date.now(), host: rpId() });
  return { address, secret, reused: false };
}

export async function transferNftToVault(collection, tokenId, vaultAddress) {
  const from = getAddress();
  if (!from) throw new Error("Connect the wallet that holds the NFT first");
  if (!isHexAddress(collection) || !isTokenId(tokenId) || !isHexAddress(vaultAddress)) {
    throw new Error("Invalid transfer parameters");
  }
  const owner = await readOwner(collection, tokenId);
  if (owner.toLowerCase() === vaultAddress.toLowerCase()) {
    return { alreadyThere: true, hash: null };
  }
  if (owner.toLowerCase() !== from.toLowerCase()) {
    throw new Error(`Connected wallet does not own #${tokenId}`);
  }
  const receipt = await sendTx(
    collection,
    SEL.transferFrom + padAddr(from) + padAddr(vaultAddress) + padUint(tokenId)
  );
  return { alreadyThere: false, hash: receipt.hash };
}

export async function waitUntilVaultOwns(collection, tokenId, vaultAddress, timeoutMs = 90000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const owner = await readOwner(collection, tokenId);
    if (owner.toLowerCase() === vaultAddress.toLowerCase()) return owner;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error("Vault does not hold that NFT yet. Complete the transfer and retry.");
}

export async function fundVaultForGas(vaultAddress, mon = "0.02") {
  const from = getAddress();
  if (!from) throw new Error("Connect a wallet to fund vault gas");
  const { getProvider, ensureMonad } = await import("./wallet.js");
  const provider = getProvider();
  if (!provider) throw new Error("Connect a wallet to fund vault gas");
  await ensureMonad(provider);
  const wei = BigInt(Math.round(Number(mon) * 1e18));
  const balHex = await provider.request({
    method: "eth_getBalance",
    params: [vaultAddress, "latest"],
  });
  if (BigInt(balHex || "0x0") >= wei) return { funded: false };
  const hash = await provider.request({
    method: "eth_sendTransaction",
    params: [
      {
        from,
        to: vaultAddress,
        value: "0x" + wei.toString(16),
        chainId: config.chainIdHex,
      },
    ],
  });
  await waitReceipt(hash);
  return { funded: true, hash };
}

export async function borrowFromVault({ secret, vaultAddress, collection, tokenId, amountHuman }) {
  const { Wallet, JsonRpcProvider, Contract } = await import("https://esm.sh/ethers@6.13.4");
  const wallet = new Wallet(toHex(secret), new JsonRpcProvider(config.rpcUrl, config.chainId));
  if (wallet.address.toLowerCase() !== vaultAddress.toLowerCase()) {
    throw new Error("Vault key does not match stored vault address");
  }
  const units = BigInt(Math.round(Number(amountHuman) * 10 ** config.usdcDecimals));
  const nft = new Contract(
    collection,
    ["function setApprovalForAll(address operator, bool approved)"],
    wallet
  );
  const approveTx = await nft.setApprovalForAll(config.lendPoolAddress, true);
  await approveTx.wait();
  const pool = new Contract(
    config.lendPoolAddress,
    [
      "function borrow(address asset, uint256 amount, address nftAsset, uint256 nftTokenId, address onBehalfOf, uint16 referralCode)",
    ],
    wallet
  );
  const borrowTx = await pool.borrow(
    config.usdcAddress,
    units,
    collection,
    tokenId,
    vaultAddress,
    0
  );
  const receipt = await borrowTx.wait();
  if (receipt.status !== 1) throw new Error("Vault borrow reverted");
  return { approve: approveTx.hash, borrow: borrowTx.hash };
}

export function vaultLabel(address) {
  return address ? `Vault ${shortAddress(address)}` : "No vault";
}

export { explorerTx };
