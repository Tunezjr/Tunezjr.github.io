import {
  COLLECTIONS,
  DUST,
  config,
  fromUsdcUnits,
  isHexAddress,
  isTokenId,
  money,
  shortAddress,
  verifyPool,
} from "./config.js";
import { readDustLock } from "./vedust.js";
import {
  connectWallet,
  silentConnect,
  disconnectWallet,
  onWalletChange,
  bindWalletListeners,
  getAddress,
  getProvider,
  readChainId,
} from "./wallet.js";
import {
  assertOwnsNft,
  explorerTx,
  readBUsdcBalance,
  readDebt,
  readPoolQuote,
  repayLoan,
  supplyUsdc,
} from "./pool.js";
import {
  borrowFromVault,
  createOrOpenVault,
  fundVaultForGas,
  loadVaultRecord,
  transferNftToVault,
  waitUntilVaultOwns,
} from "./vault.js";

const POS_KEY = "lender-positions";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function loadPositions() {
  try {
    const raw = JSON.parse(localStorage.getItem(POS_KEY) || "[]");
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function savePosition(pos) {
  const next = loadPositions().filter(
    (p) =>
      !(
        p.collection?.toLowerCase() === pos.collection.toLowerCase() &&
        p.tokenId === pos.tokenId
      )
  );
  next.unshift(pos);
  localStorage.setItem(POS_KEY, JSON.stringify(next.slice(0, 25)));
}

function text(el, value) {
  if (el) el.textContent = value == null ? "" : String(value);
}

function setStatus(el, message, kind) {
  if (!el) return;
  el.textContent = message || "";
  el.classList.remove("status--ok", "status--err");
  if (kind === "ok") el.classList.add("status--ok");
  if (kind === "err") el.classList.add("status--err");
}

function rpcPublic(req) {
  return fetch(config.rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, ...req }),
  }).then((r) => r.json()).then((j) => {
    if (j.error) throw new Error(j.error.message);
    return j.result;
  });
}

function initTabs() {
  const tabs = $$(".tab");
  const panels = $$("[data-tab-panel]");
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const id = tab.dataset.tab;
      tabs.forEach((t) => t.setAttribute("aria-selected", String(t === tab)));
      panels.forEach((p) => {
        if (p.dataset.tabPanel === id) p.removeAttribute("hidden");
        else p.setAttribute("hidden", "");
      });
    });
  });
}

function showLoansTab() {
  $$(".tab").forEach((t) => t.setAttribute("aria-selected", String(t.dataset.tab === "loans")));
  $$("[data-tab-panel]").forEach((p) => {
    if (p.dataset.tabPanel === "loans") p.removeAttribute("hidden");
    else p.setAttribute("hidden", "");
  });
}

function setWizardStep(step) {
  $$(".wizard__step").forEach((el) => {
    el.classList.toggle("is-active", Number(el.dataset.step) === step);
  });
  $$("[data-wizard-panel]").forEach((panel) => {
    if (Number(panel.dataset.wizardPanel) === step) panel.removeAttribute("hidden");
    else panel.setAttribute("hidden", "");
  });
}

function readBorrowDraft() {
  return {
    collectionName: String($("#borrow-collection")?.dataset.name || "").trim(),
    collection: String($("#borrow-collection")?.value || "").trim(),
    tokenId: String($("#borrow-token")?.value || "").trim(),
    amount: String($("#borrow-amount")?.value || "").trim(),
  };
}

function updateTermsQuote() {
  const draft = readBorrowDraft();
  const maxRaw = BigInt($("#borrow-value")?.dataset.maxUnits || "0");
  const maxBorrow = fromUsdcUnits(maxRaw);
  const amount = Number(draft.amount);
  const principal = Number.isFinite(amount) && amount > 0 ? amount : 0;
  const fee = (principal * config.feePercent) / 100;
  const repay = principal + fee;
  text($("#term-collateral"), maxRaw > 0n ? `${money(maxBorrow)} USDC max` : "—");
  text($("#term-ltv"), `${config.ltvPercent}%`);
  text($("#term-max"), maxRaw > 0n ? `$${money(maxBorrow)} USDC` : "—");
  text($("#term-fee"), principal > 0 ? `$${money(fee)}` : "—");
  text($("#term-repay"), principal > 0 ? `$${money(repay)} USDC` : "—");
  text($("#term-days"), `${config.loanDays} days`);
  text(
    $("#sum-collection"),
    draft.collectionName || (draft.collection ? shortAddress(draft.collection) : "—")
  );
  text($("#sum-token"), draft.tokenId || "—");
  text($("#sum-principal"), principal > 0 ? `$${money(principal)} USDC` : "—");
  text($("#sum-due"), principal > 0 ? `$${money(repay)} USDC` : "—");
  const vault = loadVaultRecord();
  text($("#sum-vault"), vault?.address ? shortAddress(vault.address) : "Not created");
  return { maxBorrow, maxRaw, principal, fee, repay, draft };
}

function renderNftGrid() {
  const grid = $("#nft-grid");
  if (!grid) return;
  grid.replaceChildren();
  COLLECTIONS.forEach((c) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `nft-pick${c.live ? "" : " nft-pick--soon"}`;
    btn.dataset.id = c.id;
    if (!c.live) btn.disabled = true;
    const face = document.createElement("div");
    face.className = `nft-face nft-face--${c.id}`;
    const shine = document.createElement("span");
    shine.className = "nft-face__shine";
    face.append(shine);
    const title = document.createElement("strong");
    title.textContent = c.name;
    const meta = document.createElement("span");
    meta.textContent =
      c.valuation === "locked-dust"
        ? "Pool prices the collection; lock shown for reference"
        : `${c.items.toLocaleString()} items · ${c.floorMon.toLocaleString()} MON floor`;
    btn.append(face, title, meta);
    btn.addEventListener("click", () => selectCollection(c, btn));
    grid.append(btn);
  });
}

function selectCollection(c, btn) {
  $$(".nft-pick").forEach((el) => el.classList.toggle("is-selected", el === btn));
  const col = $("#borrow-collection");
  const tok = $("#borrow-token");
  const val = $("#borrow-value");
  if (col) {
    col.value = c.address;
    col.dataset.name = c.name;
    col.readOnly = true;
  }
  if (tok) tok.value = "";
  if (val) {
    val.value = "";
    val.readOnly = true;
    delete val.dataset.maxUnits;
  }
  $("#custom-fields")?.removeAttribute("hidden");
  const toggle = $("#toggle-custom");
  if (toggle) toggle.textContent = "Hide token fields";
  const label = document.querySelector("label[for='borrow-value']");
  if (label) label.textContent = "Pool max borrow (USDC)";
  setStatus(
    $("#borrow-step1-status"),
    "Enter the token ID you own. The pool quote is read on-chain."
  );
  void refreshPoolQuote(c.address);
}

async function refreshPoolQuote(collection) {
  const val = $("#borrow-value");
  const status = $("#borrow-step1-status");
  if (!isHexAddress(collection) || !val) return;
  try {
    const quote = await readPoolQuote(collection);
    val.dataset.maxUnits = quote.availableReserve.toString();
    val.value = fromUsdcUnits(quote.availableReserve).toFixed(2);
    updateTermsQuote();
  } catch (err) {
    if (val) {
      val.value = "";
      delete val.dataset.maxUnits;
    }
    setStatus(status, err.message || "Collection is not listed on the pool", "err");
  }
}

function renderLoans() {
  const list = $("#loans-list");
  if (!list) return;
  list.replaceChildren();
  const positions = loadPositions();
  if (!positions.length) {
    const empty = document.createElement("div");
    empty.className = "loan loan--empty";
    empty.textContent = "No tracked positions yet. A loan appears here after the borrow transaction confirms.";
    list.append(empty);
    return;
  }
  positions.forEach((pos) => {
    const row = document.createElement("div");
    row.className = "loan";
    const info = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = `${pos.collectionName || shortAddress(pos.collection)} #${pos.tokenId}`;
    const detail = document.createElement("p");
    detail.textContent = pos.hash
      ? `${pos.vault ? `Vault ${shortAddress(pos.vault)} · ` : ""}Borrow tx ${pos.hash.slice(0, 10)}…`
      : "Awaiting chain read";
    info.append(title, detail);
    row.append(info);
    if (pos.hash) {
      const link = document.createElement("a");
      link.href = explorerTx(pos.hash);
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = "Explorer";
      row.append(link);
    }
    const repayBtn = document.createElement("button");
    repayBtn.type = "button";
    repayBtn.className = "btn-cta";
    repayBtn.textContent = "Repay on-chain";
    repayBtn.dataset.collection = pos.collection;
    repayBtn.dataset.tokenId = pos.tokenId;
    row.append(repayBtn);
    list.append(row);
  });
  void refreshStats();
}

async function refreshStats() {
  const addr = getAddress();
  if (addr) {
    try {
      const supplied = fromUsdcUnits(await readBUsdcBalance(addr));
      text($("#stat-supply"), `$${money(supplied, 0)}`);
      text($("#stat-tvl"), `$${money(supplied, 0)}`);
    } catch {
      /* leave previous */
    }
  }
  text($("#stat-loans"), String(loadPositions().length));
}

function initBorrowWizard() {
  $("#borrow-to-terms")?.addEventListener("click", async () => {
    const status = $("#borrow-step1-status");
    const draft = readBorrowDraft();
    try {
      if (!getAddress()) await connectWallet();
      if (!isHexAddress(draft.collection)) {
        throw new Error("Select a listed collection");
      }
      if (!isTokenId(draft.tokenId)) {
        throw new Error("Token ID must be an unsigned integer");
      }
      await assertOwnsNft(draft.collection, draft.tokenId);
      await refreshPoolQuote(draft.collection);
      const { maxRaw } = updateTermsQuote();
      if (maxRaw === 0n) throw new Error("Pool reports no borrow capacity for this collection");
      setStatus(status, "");
      setWizardStep(2);
    } catch (err) {
      setStatus(status, err?.message || "Cannot continue", "err");
    }
  });

  $("#borrow-amount")?.addEventListener("input", () => updateTermsQuote());

  $("#borrow-to-confirm")?.addEventListener("click", () => {
    const status = $("#borrow-step2-status");
    const { principal, maxBorrow } = updateTermsQuote();
    try {
      if (!Number.isFinite(principal) || principal <= 0) {
        throw new Error("Enter a USDC amount greater than 0");
      }
      if (principal > maxBorrow + 1e-9) {
        throw new Error(`Amount exceeds pool max ($${money(maxBorrow)} USDC)`);
      }
      setStatus(status, "");
      setWizardStep(3);
    } catch (err) {
      setStatus(status, err?.message || "Invalid amount", "err");
    }
  });

  $$("[data-wizard-back]").forEach((btn) => {
    btn.addEventListener("click", () => setWizardStep(Number(btn.dataset.wizardBack)));
  });

  $("#borrow-confirm")?.addEventListener("click", async () => {
    const status = $("#borrow-status");
    const { principal, draft } = updateTermsQuote();
    let secret = null;
    try {
      if (!getAddress()) await connectWallet();
      setStatus(status, "Create or unlock the Mera vault with your passkey…");
      const opened = await createOrOpenVault();
      secret = opened.secret;
      text($("#sum-vault"), shortAddress(opened.address));
      setStatus(
        status,
        opened.reused
          ? `Vault ${shortAddress(opened.address)} unlocked. Transfer the NFT in…`
          : `Vault ${shortAddress(opened.address)} created. Transfer the NFT in…`
      );
      const moved = await transferNftToVault(
        draft.collection,
        draft.tokenId,
        opened.address
      );
      if (moved.hash) {
        setStatus(status, `NFT sent to vault. ${explorerTx(moved.hash)}`);
      }
      setStatus(status, "Waiting for the vault to hold the NFT…");
      await waitUntilVaultOwns(draft.collection, draft.tokenId, opened.address);
      setStatus(status, "Funding vault gas if needed…");
      await fundVaultForGas(opened.address);
      setStatus(status, "Originating the loan from the vault…");
      const result = await borrowFromVault({
        secret,
        vaultAddress: opened.address,
        collection: draft.collection,
        tokenId: draft.tokenId,
        amountHuman: principal,
      });
      savePosition({
        collection: draft.collection,
        collectionName: draft.collectionName || shortAddress(draft.collection),
        tokenId: draft.tokenId,
        vault: opened.address,
        hash: result.borrow,
      });
      renderLoans();
      setStatus(
        status,
        `Loan opened from vault ${shortAddress(opened.address)}. ${explorerTx(result.borrow)}`,
        "ok"
      );
      setWizardStep(1);
      showLoansTab();
    } catch (err) {
      setStatus(status, err?.message || "Vault borrow failed", "err");
    } finally {
      if (secret) secret.fill(0);
    }
  });

  $("#toggle-custom")?.addEventListener("click", () => {
    const box = $("#custom-fields");
    const hidden = box?.hasAttribute("hidden");
    if (hidden) {
      box.removeAttribute("hidden");
      $("#toggle-custom").textContent = "Hide custom token";
      $$(".nft-pick").forEach((el) => el.classList.remove("is-selected"));
      const col = $("#borrow-collection");
      if (col) {
        col.value = "";
        col.readOnly = false;
        delete col.dataset.name;
      }
    } else {
      box.setAttribute("hidden", "");
      $("#toggle-custom").textContent = "Use a different collection";
    }
  });

  $("#borrow-collection")?.addEventListener("change", () => {
    const addr = $("#borrow-collection")?.value.trim();
    if (isHexAddress(addr)) void refreshPoolQuote(addr);
  });

  setWizardStep(1);
}

function wireConnectButton(btn) {
  if (!btn) return;
  btn.addEventListener("click", async () => {
    try {
      if (btn.dataset.connected) {
        await disconnectWallet();
        return;
      }
      await connectWallet();
    } catch (e) {
      alert(e?.message || "Wallet connection failed");
    }
  });
}

function initWalletUi() {
  const btn = $("#wallet-btn");
  const heroBtn = $("#hero-connect");
  const netDot = $("#network-dot");
  const netLabel = $("#network-label");

  onWalletChange(({ address, short }) => {
    [btn, heroBtn].forEach((b) => {
      if (!b) return;
      if (address) {
        b.textContent = short;
        b.classList.add("wallet-btn--connected");
        b.dataset.connected = "1";
      } else {
        b.textContent = "Connect Wallet";
        b.classList.remove("wallet-btn--connected");
        delete b.dataset.connected;
      }
    });
    void refreshStats();
    void refreshNetwork();
  });

  wireConnectButton(btn);
  wireConnectButton(heroBtn);

  async function refreshNetwork() {
    if (!netDot || !netLabel) return;
    try {
      const id = await readChainId();
      const onMonad =
        Boolean(getAddress()) &&
        String(id || "").toLowerCase() === config.chainIdHex.toLowerCase();
      netDot.classList.toggle("network-pill__dot--warn", !onMonad);
      netLabel.textContent = onMonad ? "Monad" : "Wrong network";
    } catch {
      netDot.classList.add("network-pill__dot--warn");
      netLabel.textContent = "Wrong network";
    }
  }

  bindWalletListeners();
  silentConnect().then(refreshNetwork);
  getProvider()?.on?.("chainChanged", refreshNetwork);
}

async function initConfigBanner() {
  const banner = $("#config-banner");
  if (!banner) return;
  try {
    const check = await verifyPool(rpcPublic);
    if (check.ok) {
      banner.hidden = true;
      return;
    }
    banner.hidden = false;
    banner.replaceChildren();
    const strong = document.createElement("strong");
    strong.textContent = "Pool check failed. ";
    banner.append(strong, document.createTextNode(check.reason));
  } catch (err) {
    banner.hidden = false;
    banner.textContent = err.message || "Could not verify LendPool";
  }
}

function initForms() {
  $("#supply-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const amount = String(fd.get("amount") || "").trim();
    const supplyStatus = $("#supply-status");
    try {
      if (!getAddress()) await connectWallet();
      setStatus(supplyStatus, "Confirm the USDC approval and deposit in your wallet…");
      const result = await supplyUsdc(amount);
      e.target.reset();
      setStatus(
        supplyStatus,
        `Deposit submitted. ${explorerTx(result.deposit.hash)}`,
        "ok"
      );
      void refreshStats();
    } catch (err) {
      setStatus(supplyStatus, err?.message || "Deposit transaction failed", "err");
    }
  });

  $("#loans-list")?.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-collection][data-token-id]");
    if (!btn) return;
    try {
      if (!getAddress()) await connectWallet();
      const result = await repayLoan(btn.dataset.collection, btn.dataset.tokenId);
      alert(`Repay submitted. ${explorerTx(result.repay.hash)}`);
      void refreshStats();
    } catch (err) {
      alert(err?.message || "Repay transaction failed");
    }
  });
}

function initDustLookup() {
  const tok = $("#borrow-token");
  if (!tok) return;
  let timer = 0;
  tok.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const col = $("#borrow-collection");
      const status = $("#borrow-step1-status");
      const id = tok.value.trim();
      if (col?.value.toLowerCase() !== DUST.veNft.toLowerCase()) return;
      if (!isTokenId(id)) {
        setStatus(status, "Token ID must be an unsigned integer.");
        return;
      }
      try {
        const lock = await readDustLock(id);
        setStatus(
          status,
          `${lock.dust.toLocaleString(undefined, { maximumFractionDigits: 2 })} DUST locked (reference only). Pool quote still comes from the oracle.`,
          "ok"
        );
      } catch (err) {
        setStatus(status, err?.message || "Could not read lock", "err");
      }
    }, 400);
  });
}

document.addEventListener("DOMContentLoaded", () => {
  renderNftGrid();
  renderLoans();
  initTabs();
  initBorrowWizard();
  initWalletUi();
  void initConfigBanner();
  initForms();
  initDustLookup();
});
