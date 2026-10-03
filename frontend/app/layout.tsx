import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { AppShell } from "@/src/components/AppShell";
import { Providers } from "@/src/providers";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Hush Samity",
  description: "Confidential rotating savings on Fhenix CoFHE",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
