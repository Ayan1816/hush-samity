import Link from "next/link";
import type { ReactNode } from "react";
import { ConnectWallet } from "@/src/components/ConnectWallet";
import { LanguageToggle } from "@/src/components/LanguageToggle";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-4 py-8">
      <header className="flex flex-col items-stretch gap-4 sm:flex-row sm:items-start sm:justify-between">
        <Link href="/" className="flex flex-col gap-1">
          <span className="text-sm uppercase tracking-[0.2em] text-emerald-300/80">Fhenix CoFHE</span>
          <span className="text-2xl font-semibold">Hush Samity</span>
        </Link>
        <div className="flex w-full flex-col items-stretch gap-3 sm:w-auto sm:flex-row sm:items-start">
          <LanguageToggle />
          <ConnectWallet />
        </div>
      </header>
      {children}
    </div>
  );
}
