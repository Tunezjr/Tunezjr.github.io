import { config, isWalletConnectConfigured, shortAddress } from "./config.js";

let address = null;
let provider = null;
let walletConnectProvider = null;
const listeners = new Set();

function emit() {
  listeners.forEach((fn) => fn({ address, short: shortAddress(address) }));
}

export function onWalletChange(fn) {
  listeners.add(fn);
  fn({ address, short: shortAddress(address) });
  return () => listeners.delete(fn);
}

export function getAddress() {
  return address;
}

function getInjectedProvider() {
  return window.ethereum || null;
}

export function getProvider() {
  return provider || getInjectedProvider();
}

function bindProviderListeners(nextProvider) {
  if (!nextProvider?.on || nextProvider.__lenderListenersBound) return;
  nextProvider.__lenderListenersBound = true;
  nextProvider.on("accountsChanged", (accounts) => {
    address = accounts?.[0] || null;
    emit();
  });
  nextProvider.on("chainChanged", () => emit());
  nextProvider.on("disconnect", () => {
    if (provider === nextProvider) {
      address = null;
      provider = null;
      emit();
    }
  });
}

async function getWalletConnectProvider() {
  if (walletConnectProvider) return walletConnectProvider;
  if (!isWalletConnectConfigured()) {
    throw new Error("WalletConnect project ID is missing.");
  }

  let EthereumProvider;
  try {
    ({ EthereumProvider } = await import(
      "https://esm.sh/@walletconnect/ethereum-provider@2.21.1"
    ));
  } catch {
    throw new Error("Unable to load WalletConnect. Check your connection and try again.");
  }

  walletConnectProvider = await EthereumProvider.init({
    projectId: config.walletConnectProjectId,
    chains: [config.chainId],
    optionalChains: [config.chainId],
    showQrModal: true,
    rpcMap: { [config.chainId]: config.rpcUrl },
    metadata: {
      name: "Lender",
      description: "NFT-backed USDC credit on Monad",
      url: window.location.origin,
      icons: [`${window.location.origin}/favicon.ico`],
    },
  });
  bindProviderListeners(walletConnectProvider);
  return walletConnectProvider;
}

export async function ensureMonad(walletProvider = getProvider()) {
  if (!walletProvider) {
    throw new Error("No wallet found. Install a browser wallet or connect with WalletConnect.");
  }
  try {
    await walletProvider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: config.chainIdHex }],
    });
  } catch (err) {
    if (err?.code === 4902 && walletProvider !== walletConnectProvider) {
      await walletProvider.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: config.chainIdHex,
            chainName: config.chainName,
            nativeCurrency: config.nativeCurrency,
            rpcUrls: [config.rpcUrl],
            blockExplorerUrls: [config.explorerUrl],
          },
        ],
      });
    } else if (err?.code === 4001) {
      throw new Error("Switch to Monad in your wallet to continue.");
    } else if (walletProvider === walletConnectProvider) {
      throw new Error("Reconnect with a WalletConnect wallet set to Monad.");
    } else {
      throw err;
    }
  }
}

export async function connectWalletConnect() {
  provider = await getWalletConnectProvider();
  await provider.connect();
  const accounts = await provider.request({ method: "eth_accounts" });
  if (!accounts?.length) throw new Error("No account returned from WalletConnect");
  const chainId = await provider.request({ method: "eth_chainId" });
  if (String(chainId).toLowerCase() !== config.chainIdHex.toLowerCase()) {
    throw new Error("Reconnect with a WalletConnect wallet set to Monad.");
  }
  address = accounts[0];
  emit();
  return address;
}

export async function connectWallet() {
  const injected = getInjectedProvider();
  if (!injected) return connectWalletConnect();
  provider = injected;
  bindProviderListeners(provider);
  await ensureMonad(provider);
  const accounts = await provider.request({ method: "eth_requestAccounts" });
  if (!accounts?.length) throw new Error("No account returned");
  address = accounts[0];
  emit();
  return address;
}

export async function silentConnect() {
  try {
    if (walletConnectProvider?.session) {
      provider = walletConnectProvider;
      const accounts = await provider.request({ method: "eth_accounts" });
      if (accounts?.length) {
        address = accounts[0];
        emit();
        return address;
      }
    }
    const injected = getInjectedProvider();
    if (!injected) return null;
    provider = injected;
    bindProviderListeners(provider);
    const accounts = await provider.request({ method: "eth_accounts" });
    if (accounts?.length) {
      address = accounts[0];
      emit();
    }
  } catch {
    /* ignore */
  }
  return address;
}

export async function disconnectWallet() {
  const active = provider;
  address = null;
  provider = null;
  emit();
  if (active && walletConnectProvider && (active === walletConnectProvider || active === walletConnectProvider.provider)) {
    try {
      await walletConnectProvider.disconnect();
    } catch {
      /* ignore */
    }
  }
}

export function bindWalletListeners() {
  bindProviderListeners(getProvider());
}

export async function readChainId() {
  const p = getProvider();
  if (!p) return null;
  return p.request({ method: "eth_chainId" });
}
