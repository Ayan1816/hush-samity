import type { SafeAppProvider } from "@safe-global/safe-apps-provider";
import type { Opts } from "@safe-global/safe-apps-sdk";
import { type Connector, createConnector, ProviderNotFoundError } from "@wagmi/core";
import type { Compute } from "@wagmi/core/internal";
import { getAddress, withTimeout } from "viem";

/**
 * Safe App connector.
 * Kept outside `wagmi/connectors` so the app does not load `baseAccount`,
 * `@coinbase/cdp-sdk`, or `@x402/*`.
 */
export type SafeParameters = Compute<
  Opts & {
    /**
     * Tracks a manual disconnect so a Safe App does not auto-connect again
     * until the user chooses this connector.
     * @default false
     */
    shimDisconnect?: boolean | undefined;
    /**
     * `getInfo` never resolves outside a Safe App iframe. This forces that wait to end.
     * @default 10
     */
    unstable_getInfoTimeout?: number | undefined;
  }
>;

export function safe(parameters: SafeParameters = {}) {
  const { shimDisconnect = false } = parameters;

  type Provider = SafeAppProvider | undefined;
  type Properties = Record<string, unknown>;
  type StorageItem = { "safe.disconnected": true };

  let provider_: Provider | undefined;
  let disconnect: Connector["onDisconnect"] | undefined;

  return createConnector<Provider, Properties, StorageItem>((config) => ({
    id: "safe",
    name: "Safe",
    type: "safe",
    async connect({ withCapabilities } = {}) {
      const provider = await this.getProvider();
      if (!provider) throw new ProviderNotFoundError();

      const accounts = await this.getAccounts();
      const chainId = await this.getChainId();

      if (!disconnect) {
        disconnect = this.onDisconnect.bind(this);
        provider.on("disconnect", disconnect);
      }

      if (shimDisconnect) await config.storage?.removeItem("safe.disconnected");

      return {
        accounts: (withCapabilities
          ? accounts.map((address) => ({ address, capabilities: {} }))
          : accounts) as never,
        chainId,
      };
    },
    async disconnect() {
      const provider = await this.getProvider();
      if (!provider) throw new ProviderNotFoundError();

      if (disconnect) {
        provider.removeListener("disconnect", disconnect);
        disconnect = undefined;
      }

      if (shimDisconnect) await config.storage?.setItem("safe.disconnected", true);
    },
    async getAccounts() {
      const provider = await this.getProvider();
      if (!provider) throw new ProviderNotFoundError();
      return (await provider.request({ method: "eth_accounts" })).map((address) => getAddress(address));
    },
    async getProvider() {
      const isIframe = typeof window !== "undefined" && window.parent !== window;
      if (!isIframe) return;

      if (!provider_) {
        const { default: SDK } = await import("@safe-global/safe-apps-sdk");
        const sdk = new SDK(parameters);
        const safeInfo = await withTimeout(() => sdk.safe.getInfo(), {
          timeout: parameters.unstable_getInfoTimeout ?? 10,
        });
        if (!safeInfo) throw new Error("Could not load Safe information");

        type SafeProviderCtor = typeof import("@safe-global/safe-apps-provider").SafeAppProvider;
        const imported = (await import("@safe-global/safe-apps-provider")) as {
          SafeAppProvider?: SafeProviderCtor;
          default?: { SafeAppProvider?: SafeProviderCtor };
        };
        const SafeAppProviderCtor =
          typeof imported.SafeAppProvider === "function"
            ? imported.SafeAppProvider
            : imported.default?.SafeAppProvider;
        if (!SafeAppProviderCtor) throw new Error("Could not load Safe provider");
        provider_ = new SafeAppProviderCtor(safeInfo, sdk);
      }
      return provider_;
    },
    async getChainId() {
      const provider = await this.getProvider();
      if (!provider) throw new ProviderNotFoundError();
      return Number(provider.chainId);
    },
    async isAuthorized() {
      try {
        const isDisconnected =
          shimDisconnect && (await config.storage?.getItem("safe.disconnected"));
        if (isDisconnected) return false;
        const accounts = await this.getAccounts();
        return !!accounts.length;
      } catch {
        return false;
      }
    },
    onAccountsChanged() {},
    onChainChanged() {},
    onDisconnect() {
      config.emitter.emit("disconnect");
    },
  }));
}

safe.type = "safe" as const;
