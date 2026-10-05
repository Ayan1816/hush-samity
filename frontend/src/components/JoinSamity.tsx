"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { isAddress } from "viem";

export function JoinSamity() {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  function openSamity() {
    const trimmed = value.trim();
    if (!isAddress(trimmed)) {
      setError("Enter the samity contract address.");
      return;
    }
    setError(null);
    router.push(`/samity/${trimmed}`);
  }

  return (
    <section className="flex flex-col gap-4 rounded-2xl samity-card border border-emerald-200/70 bg-emerald-950/40 p-5">
      <header className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">Join an existing samity</h2>
        <p className="text-sm text-emerald-50/70">Paste the deployed samity address. The next page reads that contract.</p>
      </header>
      <label className="flex flex-col gap-2 text-sm">
        Samity address
        <input
          className="rounded-lg border border-emerald-200/20 bg-black/30 px-3 py-2 font-mono"
          autoComplete="off"
          spellCheck={false}
          placeholder="0x..."
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
      </label>
      <button
        type="button"
        className="rounded-lg bg-emerald-400 px-4 py-2 text-sm font-semibold text-emerald-950 disabled:opacity-40"
        disabled={value.trim() === ""}
        onClick={openSamity}
      >
        Open samity
      </button>
      {error ? <p className="text-sm text-red-300">{error}</p> : null}
    </section>
  );
}
