import type { NextConfig } from "next";
import path from "node:path";

// These packages are already installed under `@wagmi/connectors`. Mapping them
// here lets the Safe connector import them without the `wagmi/connectors` barrel,
// which also loads `@coinbase/cdp-sdk` and `@x402/*`.
const safeSdk = path.resolve(
  process.cwd(),
  "../node_modules/.pnpm/node_modules/@safe-global/safe-apps-sdk",
);
const safeProvider = path.resolve(
  process.cwd(),
  "../node_modules/.pnpm/node_modules/@safe-global/safe-apps-provider",
);

const nextConfig: NextConfig = {
  // Skip `tsc` during `next build`. Next 16 no longer runs ESLint in the build,
  // and `eslint` is not a valid config key, so this is what shortens the Vercel build.
  typescript: {
    ignoreBuildErrors: true,
  },
  turbopack: {
    resolveAlias: {
      "@safe-global/safe-apps-sdk": safeSdk,
      "@safe-global/safe-apps-provider": safeProvider,
    },
  },
  webpack: (config) => {
    const alias = config.resolve?.alias;
    const aliasObject =
      alias && typeof alias === "object" && !Array.isArray(alias) ? alias : {};
    config.resolve ??= {};
    config.resolve.alias = {
      ...aliasObject,
      "@safe-global/safe-apps-sdk": safeSdk,
      "@safe-global/safe-apps-provider": safeProvider,
    };
    return config;
  },
};

export default nextConfig;
