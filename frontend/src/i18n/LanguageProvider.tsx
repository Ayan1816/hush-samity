"use client";

import { isCofheError } from "@cofhe/sdk";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { LOCALE_COOKIE, LOCALE_STORAGE_KEY, isNotice, translate, type Locale, type MessageKey } from "@/src/i18n/messages";
import { classifyError } from "@/src/lib/errors";

type Vars = Record<string, string | number>;

type I18nValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: MessageKey, vars?: Vars) => string;
  format: (error: unknown) => string;
};

const I18nContext = createContext<I18nValue | null>(null);

function readStoredLocale(): Locale | null {
  try {
    const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    if (stored === "bn" || stored === "en") return stored;
  } catch {
    return null;
  }
  return null;
}

function persistLocale(locale: Locale) {
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Private browsing can reject storage. The cookie still carries the choice.
  }
  document.cookie = `${LOCALE_COOKIE}=${locale}; Path=/; Max-Age=31536000; SameSite=Lax`;
  document.documentElement.lang = locale;
}

export function LanguageProvider({ initialLocale, children }: { initialLocale: Locale; children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  useEffect(() => {
    const stored = readStoredLocale();
    const next = stored ?? locale;
    if (next !== locale) setLocaleState(next);
    persistLocale(next);
    // The stored choice is applied once, after hydration, so the server cookie and the first paint agree.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = useMemo<I18nValue>(() => {
    const t = (key: MessageKey, vars?: Vars) => translate(locale, key, vars);
    const format = (error: unknown) => {
      if (isNotice(error)) return t(error.k, error.vars);
      if (isCofheError(error)) return error.message;
      const classified = classifyError(error);
      return t(classified.key, classified.vars);
    };
    return {
      locale,
      setLocale: (next: Locale) => {
        setLocaleState(next);
        persistLocale(next);
      },
      t,
      format,
    };
  }, [locale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (value == null) {
    throw new Error("useI18n must be used inside LanguageProvider");
  }
  return value;
}
