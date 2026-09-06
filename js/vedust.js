import { config, DUST } from "./config.js";

const LOCKED_SEL = "0xb45a3c0e";
const RESERVES_SEL = "0x0902f1ac";
const TOKEN0_SEL = "0x0dfe1681";

async function ethCall(to, data) {
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
  if (!json.result || json.result === "0x") {
    throw new Error(json.error?.message || "RPC call failed");
  }
  return json.result;
}

function word(hex, i) {
  return BigInt("0x" + hex.slice(2 + i * 64, 2 + (i + 1) * 64));
}

export async function readDustLock(tokenId) {
  if (!/^\d+$/.test(tokenId)) throw new Error("Enter a valid token ID");
  const idHex = BigInt(tokenId).toString(16).padStart(64, "0");
  const [lockHex, token0Hex, reservesHex] = await Promise.all([
    ethCall(DUST.veNft, LOCKED_SEL + idHex),
    ethCall(DUST.pair, TOKEN0_SEL),
    ethCall(DUST.pair, RESERVES_SEL),
  ]);
  const amount = Number(word(lockHex, 0)) / 1e18;
  if (!(amount > 0)) throw new Error("No DUST locked in this token");
  const token0 = "0x" + token0Hex.slice(-40);
  const r0 = word(reservesHex, 0);
  const r1 = word(reservesHex, 1);
  const usdcIs0 = token0.toLowerCase() === DUST.usdc.toLowerCase();
  const usdc = Number(usdcIs0 ? r0 : r1) / 1e6;
  const dustRes = Number(usdcIs0 ? r1 : r0) / 1e18;
  const dustPriceUsd = dustRes > 0 ? usdc / dustRes : 0;
  return {
    tokenId,
    dust: amount,
    usd: amount * dustPriceUsd,
    dustPriceUsd,
    unlockAt: Number(word(lockHex, 1)),
  };
}
