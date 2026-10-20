import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { monadChain } from "./chain";
import { rpcUrl } from "./config";

// Browser wallets are discovered through EIP-6963 (wagmi's multiInjectedProviderDiscovery); the
// generic injected() connector covers wallets that only set window.ethereum.
export const wagmiConfig = createConfig({
  chains: [monadChain],
  connectors: [injected()],
  transports: { [monadChain.id]: http(rpcUrl) },
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
