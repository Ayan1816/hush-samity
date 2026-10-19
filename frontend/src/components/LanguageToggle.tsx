"use client";

import { useI18n } from "@/src/i18n/LanguageProvider";
import type { Locale } from "@/src/i18n/messages";

const OPTIONS: { locale: Locale; label: string }[] = [
  { locale: "bn", label: "বাংলা" },
  { locale: "en", label: "EN" },
];

export function LanguageToggle() {
  const { locale, setLocale, t } = useI18n();

  return (
    <div
      role="group"
      aria-label={t("language")}
      className="flex h-10 items-center self-start rounded-lg border border-emerald-200/40 bg-emerald-950/40 p-0.5 text-xs font-semibold"
    >
      {OPTIONS.map((option, index) => {
        const active = locale === option.locale;
        return (
          <span key={option.locale} className="flex items-center">
            {index > 0 ? (
              <span className="px-0.5 text-emerald-200/40" aria-hidden="true">
                |
              </span>
            ) : null}
            <button
              type="button"
              aria-pressed={active}
              className={
                active
                  ? "rounded-md bg-emerald-400 px-2.5 py-1 text-emerald-950"
                  : "rounded-md px-2.5 py-1 text-emerald-100 hover:text-white"
              }
              onClick={() => setLocale(option.locale)}
            >
              {option.label}
            </button>
          </span>
        );
      })}
    </div>
  );
}
