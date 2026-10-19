"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { WagmiProvider } from "wagmi";
import { wagmiConfig } from "@/lib/wagmi";
import { CofheConnect } from "@/src/components/CofheConnect";
import { ToastHost } from "@/src/components/Toast";
import { LanguageProvider } from "@/src/i18n/LanguageProvider";
import type { Locale } from "@/src/i18n/messages";

export function Providers({ children, initialLocale }: { children: ReactNode; initialLocale: Locale }) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <LanguageProvider initialLocale={initialLocale}>
      <WagmiProvider config={wagmiConfig}>
        <QueryClientProvider client={queryClient}>
          {children}
          <CofheConnect />
          <ToastHost />
        </QueryClientProvider>
      </WagmiProvider>
    </LanguageProvider>
  );
}
