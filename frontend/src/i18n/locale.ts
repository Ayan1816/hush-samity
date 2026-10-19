import { cookies } from "next/headers";
import { LOCALE_COOKIE, type Locale } from "@/src/i18n/messages";

/** Locale for server metadata. The client copies the same choice into this cookie. */
export async function requestLocale(): Promise<Locale> {
  const jar = await cookies();
  return jar.get(LOCALE_COOKIE)?.value === "bn" ? "bn" : "en";
}
