"use client";

import { useParams } from "next/navigation";
import { isAddress } from "viem";
import { SamityDesk } from "@/src/components/SamityDesk";
import { useI18n } from "@/src/i18n/LanguageProvider";

export default function SamityPage() {
  const { t } = useI18n();
  const params = useParams<{ address: string }>();
  const raw = typeof params.address === "string" ? params.address : "";

  if (!isAddress(raw)) {
    return (
      <main className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">{t("samityHeading")}</h1>
        <p className="text-sm text-emerald-50/70">{t("invalidUrlAddress")}</p>
      </main>
    );
  }

  return <SamityDesk samity={raw} />;
}
