import { CreateSamity } from "@/src/components/CreateSamity";
import { HowItWorks } from "@/src/components/HowItWorks";
import { JoinSamity } from "@/src/components/JoinSamity";
import { MySamities } from "@/src/components/MySamities";

export default function HomePage() {
  return (
    <main className="flex flex-col gap-8">
      <section className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold">Confidential rotating savings</h1>
        <p className="max-w-xl text-emerald-50/80">
          Installments and collateral are ERC-20 transfers. Discount bids stay encrypted until the winning bid is
          verified.
        </p>
      </section>
      <HowItWorks />
      <CreateSamity />
      <MySamities />
      <JoinSamity />
    </main>
  );
}
