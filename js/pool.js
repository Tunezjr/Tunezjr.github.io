import { config, fromUsdcUnits, isHexAddress, isTokenId } from "./config.js";
import { getAddress, getProvider, ensureMonad } from "./wallet.js";

const SEL = {
  ownerOf: "0x6352211e",
  approveErc20: "0x095ea7b3",
  allowance: "0xdd62ed3e",
  balanceOf: "0x70a08231",
  setApprovalForAll: "0xa22cb465",
  isApprovedForAll: "0xe985e9c5",
  approve721: "0x095ea7b3",
  deposit: "0xe8eda9df",
  borrow: "0xb6529aee",
  repay: "0x8cd2e0c7",
  getNftCollateralData: "0xcc8ccdf2",
  getNftDebtData: "0xec765d3d",
  getAssetPrice: "0xb3596f07",
};

function padAddr(addr) {
  return addr.slice(2).toLowerCase().padStart(64, "0");
}
function padUint(value) {
  return BigInt(value).toString(16).padStart(64, "0");
}
function padBool(v) {
  return (v ? 1 : 0).toString(16).padStart(64, "0");
}
function word(hex, i) {
  return BigInt("0x" + hex.slice(2 + i * 64, 2 + (i + 1) * 64));
}
function addrWord(hex, i) {
  return "0x" + hex.slice(2 + i * 64 + 24, 2 + (i + 1) * 64);
}

export async function walletCall(tx) {
  const provider = getProvider();
  if (!provider) throw new Error("Connect a Monad wallet first");
  await ensureMonad(provider);
  return provider.request(tx);
}

export async function ethCall(to, data) {
  const provider = getProvider();
  if (provider) {
    await ensureMonad(provider);
    return provider.request({
      method: "eth_call",
      params: [{ to, data }, "latest"],
    });
  }
  const res = await fetch(config.rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_call",
      params: [{ to, data }, "latest"],
    }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json.result;
}

export async function sendTx(to, data) {
  const from = getAddress();
  if (!from) throw new Error("Connect a Monad wallet first");
  const hash = await walletCall({
    method: "eth_sendTransaction",
    params: [{ from, to, data, chainId: config.chainIdHex }],
  });
  return waitReceipt(hash);
}

export async function waitReceipt(hash) {
  for (let i = 0; i < 60; i++) {
    const rec = await walletCall({
      method: "eth_getTransactionReceipt",
      params: [hash],
    });
    if (rec) {
      if (rec.status === "0x1") return { hash, receipt: rec };
      throw new Error(`Transaction reverted (${hash})`);
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(`No receipt yet for ${hash}`);
}

export function explorerTx(hash) {
  return `${config.explorerUrl}/tx/${hash}`;
}

export async function readOwner(collection, tokenId) {
  if (!isHexAddress(collection)) throw new Error("Invalid collection");
  if (!isTokenId(tokenId)) throw new Error("Token ID must be an unsigned integer");
  const raw = await ethCall(collection, SEL.ownerOf + padUint(tokenId));
  if (!raw || raw === "0x") throw new Error("That token ID is not minted");
  return addrWord(raw, 0);
}

export async function assertOwnsNft(collection, tokenId) {
  const owner = getAddress();
  if (!owner) throw new Error("Connect a Monad wallet first");
  const tokenOwner = await readOwner(collection, tokenId);
  if (tokenOwner.toLowerCase() !== owner.toLowerCase()) {
    throw new Error("Connected wallet does not own that token");
  }
}

export async function readPoolQuote(nftAsset) {
  const raw = await ethCall(
    config.lendPoolAddress,
    SEL.getNftCollateralData + padAddr(nftAsset) + padAddr(config.usdcAddress)
  );
  if (!raw || raw === "0x") throw new Error("Collection is not listed on the pool");
  return {
    collateralReserve: word(raw, 1),
    availableReserve: word(raw, 3),
    ltv: Number(word(raw, 4)),
    liquidationThreshold: Number(word(raw, 5)),
  };
}

export async function readDebt(nftAsset, tokenId) {
  const raw = await ethCall(
    config.lendPoolAddress,
    SEL.getNftDebtData + padAddr(nftAsset) + padUint(tokenId)
  );
  if (!raw || raw === "0x") {
    return { loanId: 0n, totalDebt: 0n, availableBorrows: 0n };
  }
  return {
    loanId: word(raw, 0),
    reserveAsset: addrWord(raw, 1),
    totalCollateral: word(raw, 2),
    totalDebt: word(raw, 3),
    availableBorrows: word(raw, 4),
  };
}

export async function readUsdcBalance(owner) {
  const raw = await ethCall(config.usdcAddress, SEL.balanceOf + padAddr(owner));
  return raw && raw !== "0x" ? word(raw, 0) : 0n;
}

export async function readBUsdcBalance(owner) {
  const raw = await ethCall(config.bUsdc, SEL.balanceOf + padAddr(owner));
  return raw && raw !== "0x" ? word(raw, 0) : 0n;
}

async function ensureErc20Allowance(token, spender, amount) {
  const owner = getAddress();
  const raw = await ethCall(token, SEL.allowance + padAddr(owner) + padAddr(spender));
  const current = raw && raw !== "0x" ? word(raw, 0) : 0n;
  if (current >= amount) return null;
  return sendTx(token, SEL.approveErc20 + padAddr(spender) + padUint(amount));
}

async function ensureNftApproved(nft, tokenId) {
  const owner = getAddress();
  const raw = await ethCall(
    nft,
    SEL.isApprovedForAll + padAddr(owner) + padAddr(config.lendPoolAddress)
  );
  const approved = raw && raw !== "0x" && word(raw, 0) === 1n;
  if (approved) return null;
  return sendTx(
    nft,
    SEL.setApprovalForAll + padAddr(config.lendPoolAddress) + padBool(true)
  );
}

export async function supplyUsdc(amountHuman) {
  const units = BigInt(Math.round(Number(amountHuman) * 10 ** config.usdcDecimals));
  if (units <= 0n) throw new Error("Enter a USDC amount greater than 0");
  const approve = await ensureErc20Allowance(
    config.usdcAddress,
    config.lendPoolAddress,
    units
  );
  const deposit = await sendTx(
    config.lendPoolAddress,
    SEL.deposit +
      padAddr(config.usdcAddress) +
      padUint(units) +
      padAddr(getAddress()) +
      padUint(0)
  );
  return { approve, deposit };
}

export async function borrowUsdc(nftAsset, tokenId, amountHuman) {
  if (!isTokenId(tokenId)) throw new Error("Token ID must be an unsigned integer");
  const units = BigInt(Math.round(Number(amountHuman) * 10 ** config.usdcDecimals));
  if (units <= 0n) throw new Error("Enter a USDC amount greater than 0");
  await assertOwnsNft(nftAsset, tokenId);
  const quote = await readPoolQuote(nftAsset);
  if (units > quote.availableReserve) {
    throw new Error(
      `Amount exceeds pool max (${fromUsdcUnits(quote.availableReserve).toFixed(2)} USDC)`
    );
  }
  const approve = await ensureNftApproved(nftAsset, tokenId);
  const borrow = await sendTx(
    config.lendPoolAddress,
    SEL.borrow +
      padAddr(config.usdcAddress) +
      padUint(units) +
      padAddr(nftAsset) +
      padUint(tokenId) +
      padAddr(getAddress()) +
      padUint(0)
  );
  return { approve, borrow };
}

export async function repayLoan(nftAsset, tokenId, amountHuman) {
  if (!isTokenId(tokenId)) throw new Error("Token ID must be an unsigned integer");
  const debt = await readDebt(nftAsset, tokenId);
  if (debt.loanId === 0n || debt.totalDebt === 0n) {
    throw new Error("No on-chain loan for that NFT");
  }
  const units =
    amountHuman == null
      ? debt.totalDebt
      : BigInt(Math.round(Number(amountHuman) * 10 ** config.usdcDecimals));
  const approve = await ensureErc20Allowance(
    config.usdcAddress,
    config.lendPoolAddress,
    units
  );
  const repay = await sendTx(
    config.lendPoolAddress,
    SEL.repay + padAddr(nftAsset) + padUint(tokenId) + padUint(units)
  );
  return { approve, repay, loanId: debt.loanId.toString() };
}
