import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { AppShell } from "@/src/components/AppShell";
import { requestLocale } from "@/src/i18n/locale";
import { translate } from "@/src/i18n/messages";
import { Providers } from "@/src/providers";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

export async function generateMetadata(): Promise<Metadata> {
  const locale = await requestLocale();
  return {
    title: translate(locale, "brandTitle"),
    description: translate(locale, "brandDescription"),
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await requestLocale();
  return (
    <html lang={locale}>
      <body className={inter.className}>
        <Providers initialLocale={locale}>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
