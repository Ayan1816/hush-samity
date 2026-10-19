"use client";

import { CreateSamity } from "@/src/components/CreateSamity";
import { HowItWorks } from "@/src/components/HowItWorks";
import { JoinSamity } from "@/src/components/JoinSamity";
import { MySamities } from "@/src/components/MySamities";
import { useI18n } from "@/src/i18n/LanguageProvider";

export default function HomePage() {
  const { t } = useI18n();

  return (
    <main className="flex flex-col gap-8">
      <section className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold">{t("homeTitle")}</h1>
        <p className="max-w-xl text-emerald-50/80">{t("homeBody")}</p>
      </section>
      <HowItWorks />
      <CreateSamity />
      <MySamities />
      <JoinSamity />
    </main>
  );
}
