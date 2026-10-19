import type { Metadata } from "next";
import type { ReactNode } from "react";
import { requestLocale } from "@/src/i18n/locale";
import { samityOpenGraph } from "@/src/lib/samityMetadata";

type SamityRouteProps = {
  params: Promise<{ address: string }>;
  children: ReactNode;
};

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: SamityRouteProps): Promise<Metadata> {
  const { address } = await params;
  return samityOpenGraph(address, await requestLocale());
}

export default function SamityAddressLayout({ children }: SamityRouteProps) {
  return children;
}
