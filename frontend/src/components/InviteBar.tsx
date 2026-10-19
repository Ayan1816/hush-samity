"use client";

import { useEffect, useState } from "react";
import type { Address } from "viem";
import { useI18n } from "@/src/i18n/LanguageProvider";
import { roundDeadlineIcs } from "@/src/lib/ics";
import { formatTokenAmount } from "@/src/lib/tokenFormat";

type InviteBarProps = {
  samity: Address;
  installmentAmount: bigint | null;
  collateralAmount: bigint | null;
  deadline: bigint | null;
  currentCycle: bigint | null;
  decimals: number | undefined;
  symbol: string | undefined;
};

function money(amount: bigint | null, decimals: number | undefined, symbol: string | undefined): string | null {
  if (amount == null) return null;
  if (decimals == null) return null;
  return formatTokenAmount(amount, decimals, symbol);
}

function deadlineLabel(deadline: bigint): string {
  const seconds = Number(deadline);
  if (!Number.isSafeInteger(seconds)) return deadline.toString();
  return `${deadline.toString()} · ${new Date(seconds * 1000).toISOString()}`;
}

export function InviteBar({
  samity,
  installmentAmount,
  collateralAmount,
  deadline,
  currentCycle,
  decimals,
  symbol,
}: InviteBarProps) {
  const { t, format } = useI18n();
  const [origin, setOrigin] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<unknown>(null);
  const [icsError, setIcsError] = useState<unknown>(null);

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const url = origin == null ? null : `${origin}/samity/${samity}`;
  const installment = money(installmentAmount, decimals, symbol);
  const collateral = money(collateralAmount, decimals, symbol);
  const ready = url != null && installment != null && collateral != null && deadline != null;
  const message = ready
    ? `${url}\n${t("shareInstallment", { amount: installment })}\n${t("shareCollateral", { amount: collateral })}\n${t("shareDeadline", { time: deadlineLabel(deadline) })}`
    : null;
  const telegramText =
    ready && url != null
      ? `${t("shareInstallment", { amount: installment })}\n${t("shareCollateral", { amount: collateral })}\n${t("shareDeadline", { time: deadlineLabel(deadline) })}`
      : null;

  async function copyLink() {
    if (message == null) return;
    setCopyError(null);
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
    } catch (caught) {
      setCopied(false);
      setCopyError(caught);
    }
  }

  function downloadIcs() {
    if (installmentAmount == null || deadline == null || currentCycle == null) return;
    setIcsError(null);
    try {
      const amount =
        decimals == null
          ? t("baseUnits", { amount: installmentAmount.toString() })
          : formatTokenAmount(installmentAmount, decimals, symbol);
      const body = roundDeadlineIcs({
        samity,
        cycle: currentCycle,
        deadline,
        installment: installmentAmount,
        decimals,
        symbol,
        url,
        summary: t("icsSummary", { cycle: currentCycle.toString() }),
        description: t("icsDescription", {
          address: samity,
          cycle: currentCycle.toString(),
          amount,
          deadline: deadline.toString(),
        }),
        alarm: t("icsAlarm"),
      });
      const blob = new Blob([body], { type: "text/calendar;charset=utf-8" });
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = `samity-${samity.toLowerCase()}-round-${currentCycle.toString()}.ics`;
      anchor.click();
      URL.revokeObjectURL(objectUrl);
    } catch (caught) {
      setIcsError(caught);
    }
  }

  const waiting =
    installmentAmount == null || collateralAmount == null || deadline == null || decimals == null || origin == null;

  return (
    <section className="flex flex-col gap-3 rounded-2xl samity-card border border-emerald-200/70 bg-emerald-950/40 p-5 text-sm">
      <header className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">{t("inviteTitle")}</h2>
        <p className="text-emerald-50/70">{waiting ? t("inviteReading") : t("inviteReady")}</p>
      </header>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <button
          type="button"
          className="rounded-lg bg-emerald-400 px-4 py-2 text-sm font-semibold text-emerald-950 disabled:opacity-40"
          disabled={message == null}
          onClick={() => {
            void copyLink();
          }}
        >
          {copied ? t("copied") : t("copyLink")}
        </button>
        <button
          type="button"
          className="rounded-lg bg-emerald-400 px-4 py-2 text-sm font-semibold text-emerald-950 disabled:opacity-40"
          disabled={message == null}
          onClick={() => {
            if (message == null) return;
            window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, "_blank", "noopener,noreferrer");
          }}
        >
          {t("shareWhatsapp")}
        </button>
        <button
          type="button"
          className="rounded-lg bg-emerald-400 px-4 py-2 text-sm font-semibold text-emerald-950 disabled:opacity-40"
          disabled={url == null || telegramText == null}
          onClick={() => {
            if (url == null || telegramText == null) return;
            const href = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(telegramText)}`;
            window.open(href, "_blank", "noopener,noreferrer");
          }}
        >
          {t("shareTelegram")}
        </button>
        <button
          type="button"
          className="rounded-lg bg-emerald-400 px-4 py-2 text-sm font-semibold text-emerald-950 disabled:opacity-40"
          disabled={installmentAmount == null || deadline == null || currentCycle == null}
          onClick={downloadIcs}
        >
          {t("downloadIcs")}
        </button>
      </div>
      {copyError ? <p className="text-red-300">{format(copyError)}</p> : null}
      {icsError ? <p className="text-red-300">{format(icsError)}</p> : null}
    </section>
  );
}
