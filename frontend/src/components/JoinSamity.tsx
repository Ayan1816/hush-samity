"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { getAddress, isAddress } from "viem";
import { useAccount, usePublicClient } from "wagmi";
import { Skeleton } from "@/src/components/Skeleton";
import { isSupportedChainId } from "@/src/config/cofhe";
import { useI18n } from "@/src/i18n/LanguageProvider";
import { notice } from "@/src/i18n/messages";
import { readSamityIdentity } from "@/src/lib/mySamities";

export function JoinSamity() {
  const { t, format } = useI18n();
  const router = useRouter();
  const { isConnected, chainId } = useAccount();
  const supported = isSupportedChainId(chainId);
  const publicClient = usePublicClient({ chainId: supported ? chainId : undefined });
  const [value, setValue] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [checking, setChecking] = useState(false);

  async function openSamity() {
    const trimmed = value.trim();
    if (!isAddress(trimmed)) {
      setError(notice("joinInvalidAddress"));
      return;
    }
    if (!isConnected) {
      setError(notice("connectWalletFirst"));
      return;
    }
    if (!supported) {
      setError(notice("switchToSepolia"));
      return;
    }
    if (!publicClient) {
      setError(notice("chainClientNotReady"));
      return;
    }

    setChecking(true);
    setError(null);
    try {
      const code = await publicClient.getBytecode({ address: trimmed });
      if (code == null || code === "0x") {
        setError(notice("noCodeHere"));
        return;
      }
      const identity = await readSamityIdentity(publicClient, getAddress(trimmed));
      if (!identity) {
        setError(notice("notSamityContract"));
        return;
      }
      router.push(`/samity/${getAddress(trimmed)}`);
    } catch (caught) {
      setError(caught);
    } finally {
      setChecking(false);
    }
  }

  return (
    <section className="flex flex-col gap-4 rounded-2xl samity-card border border-emerald-200/70 bg-emerald-950/40 p-5">
      <header className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">{t("joinTitle")}</h2>
        <p className="text-sm text-emerald-50/70">{t("joinBody")}</p>
      </header>
      <label className="flex flex-col gap-2 text-sm">
        {t("samityAddress")}
        <input
          className={`rounded-lg border bg-black/30 px-3 py-2 font-mono ${error ? "border-red-400" : "border-emerald-200/20"}`}
          autoComplete="off"
          spellCheck={false}
          placeholder="0x..."
          aria-invalid={error ? true : undefined}
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setError(null);
          }}
        />
      </label>
      <button
        type="button"
        className="w-full rounded-lg bg-emerald-400 px-4 py-2 text-sm font-semibold text-emerald-950 disabled:opacity-40"
        disabled={value.trim() === "" || checking}
        onClick={() => {
          void openSamity();
        }}
      >
        {checking ? t("checking") : t("openSamity")}
      </button>
      {checking ? (
        <span aria-busy="true">
          <Skeleton className="inline-block h-4 w-56" />
        </span>
      ) : null}
      {error ? <p className="text-sm text-red-300">{format(error)}</p> : null}
    </section>
  );
}
