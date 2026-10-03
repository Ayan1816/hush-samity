"use client";

import { useParams } from "next/navigation";
import { isAddress } from "viem";
import { SamityDesk } from "@/src/components/SamityDesk";

export default function SamityPage() {
  const params = useParams<{ address: string }>();
  const raw = typeof params.address === "string" ? params.address : "";

  if (!isAddress(raw)) {
    return (
      <main className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Samity</h1>
        <p className="text-sm text-emerald-50/70">The address in this URL is not a valid address.</p>
      </main>
    );
  }

  return <SamityDesk samity={raw} />;
}
