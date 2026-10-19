"use client";

import { useEffect, useState } from "react";
import type { Address, PublicClient } from "viem";
import { usePublicClient } from "wagmi";
import { Skeleton } from "@/src/components/Skeleton";
import { useI18n } from "@/src/i18n/LanguageProvider";
import type { MessageKey } from "@/src/i18n/messages";
import { loadRoundActivity, type RoundActivity } from "@/src/lib/roundActivity";

const STAGES: MessageKey[] = ["stagePay", "stageBid", "stageReveal", "stagePayout"];

type RoundTimelineProps = {
  samity: Address;
  bidEngine: Address | null;
  chainId: number;
  account: Address | undefined;
  blockNumber: bigint | undefined;
  currentRound: bigint | undefined;
  phase: number | undefined;
  deadline: bigint | undefined;
  chainTime: bigint | undefined;
  memberCount: bigint | undefined;
  memberCap: bigint | undefined;
};

function activeStage(input: {
  phase: number | undefined;
  chainTime: bigint | undefined;
  deadline: bigint | undefined;
  paidComplete: boolean | null;
  members: number | null;
  sealed: number | null;
  memberCap: bigint | undefined;
  currentRound: bigint | undefined;
}): number | null {
  if (input.phase == null) return null;
  if (input.phase === 2) return 3;
  if (input.phase === 1) return 2;
  if (input.phase !== 0) return null;
  if (input.chainTime == null || input.deadline == null) return null;
  if (input.chainTime >= input.deadline) {
    if (input.sealed == null) return null;
    return input.sealed > 0 ? 2 : 3;
  }
  if (input.paidComplete == null || input.members == null || input.memberCap == null || input.currentRound == null) return null;
  const rosterFull = input.memberCap > 0n && BigInt(input.members) >= input.memberCap;
  if (input.paidComplete && (rosterFull || input.currentRound > 1n)) return 1;
  return 0;
}

function timeText(value: bigint): string {
  const seconds = Number(value);
  if (!Number.isSafeInteger(seconds)) return value.toString();
  return `${value.toString()} · ${new Date(seconds * 1000).toISOString()}`;
}

function remainingText(
  deadline: bigint,
  now: bigint,
  t: (key: MessageKey, vars?: Record<string, string | number>) => string,
): string {
  if (now >= deadline) return t("windowClosed");
  const left = deadline - now;
  const days = left / 86_400n;
  const hours = (left / 3_600n) % 24n;
  const minutes = (left / 60n) % 60n;
  const seconds = left % 60n;
  const parts: string[] = [];
  if (days > 0n) parts.push(t("partDay", { n: days.toString() }));
  parts.push(
    t("partHour", { n: hours.toString() }),
    t("partMinute", { n: minutes.toString() }),
    t("partSecond", { n: seconds.toString() }),
  );
  return parts.join(" ");
}

function useSyncedChainTime(chainTime: bigint | undefined): bigint | undefined {
  const [now, setNow] = useState<bigint | undefined>(chainTime);
  useEffect(() => {
    if (chainTime == null) {
      setNow(undefined);
      return;
    }
    const base = chainTime;
    const observedAt = Date.now();
    setNow(base);
    const id = window.setInterval(() => {
      const elapsed = BigInt(Math.max(0, Math.floor((Date.now() - observedAt) / 1000)));
      setNow(base + elapsed);
    }, 1000);
    return () => window.clearInterval(id);
  }, [chainTime]);
  return now;
}

export function RoundTimeline({
  samity,
  bidEngine,
  chainId,
  account,
  blockNumber,
  currentRound,
  phase,
  deadline,
  chainTime,
  memberCount,
  memberCap,
}: RoundTimelineProps) {
  const { t, format } = useI18n();
  const publicClient = usePublicClient({ chainId });
  const now = useSyncedChainTime(chainTime);
  const scopeKey = `${samity}:${currentRound?.toString() ?? ""}`;
  const [scope, setScope] = useState(scopeKey);
  const [activity, setActivity] = useState<RoundActivity | null>(null);
  const [error, setError] = useState<unknown>(null);

  if (scope !== scopeKey) {
    setScope(scopeKey);
    setActivity(null);
    setError(null);
  }

  useEffect(() => {
    if (!publicClient || blockNumber == null || currentRound == null || memberCount == null) return;
    let cancelled = false;
    const client = publicClient;
    void loadRoundActivity(client as PublicClient, {
      samity,
      bidEngine,
      chainId,
      account,
      blockNumber,
      cycle: currentRound,
      memberCount,
    })
      .then((next) => {
        if (cancelled) return;
        setActivity(next);
        setError(null);
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setError(caught);
      });
    return () => {
      cancelled = true;
    };
  }, [account, bidEngine, blockNumber, chainId, currentRound, memberCount, publicClient, samity]);

  const members = activity?.members ?? null;
  const paid = members == null ? null : members.filter((member) => member.paid).length;
  const locked = members == null ? null : members.filter((member) => member.locked).length;
  const sealedMembers = members == null ? null : members.filter((member) => member.sealed === true);
  const sealedKnown = bidEngine != null && members != null && members.every((member) => member.sealed != null);
  const eligible = members == null ? null : members.filter((member) => !member.slashed);
  const paidComplete = eligible == null ? null : eligible.length > 0 && eligible.every((member) => member.paid);
  const active = activeStage({
    phase,
    chainTime,
    deadline,
    paidComplete,
    members: members?.length ?? null,
    sealed: sealedKnown && sealedMembers != null ? sealedMembers.length : null,
    memberCap,
    currentRound,
  });
  const total = members?.length;

  return (
    <section className="flex flex-col gap-4 rounded-2xl samity-card border border-emerald-200/70 bg-emerald-950/40 p-5 text-sm">
      <header className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">
          {t("roundHeading", { round: currentRound == null ? t("reading") : currentRound.toString() })}
        </h2>
        <p className="text-emerald-50/70">
          {memberCount == null || memberCap == null
            ? t("readingSeats")
            : t("seatsJoined", { count: memberCount.toString(), cap: memberCap.toString() })}
        </p>
      </header>

      <ol aria-label={t("timelineAria")} className="grid grid-cols-4 gap-2">
        {STAGES.map((label, index) => {
          const done = active != null && (phase === 2 ? index <= active : index < active);
          const current = active === index && phase !== 2;
          return (
            <li key={label} aria-current={current ? "step" : undefined} className="flex flex-col gap-2">
              <span
                className={
                  done
                    ? "h-2 rounded-full bg-emerald-400"
                    : current
                      ? "h-2 rounded-full bg-emerald-300"
                      : "h-2 rounded-full bg-emerald-200/20"
                }
              />
              <span className={current ? "text-emerald-100" : "text-emerald-50/70"}>{t(label)}</span>
            </li>
          );
        })}
      </ol>

      <div className="flex flex-col gap-1 font-mono text-xs">
        {phase !== 0 ? (
          <p>{phase === 1 ? t("revealClosed") : phase === 2 ? t("samityComplete") : t("readingPhase")}</p>
        ) : deadline == null || chainTime == null || now == null ? (
          <p>{t("gateWaitingTimestamp")}</p>
        ) : (
          <>
            <p>{remainingText(deadline, now, t)}</p>
            <p>{now >= deadline ? t("zeroSecondsLeft") : t("secondsLeft", { seconds: (deadline - now).toString() })}</p>
          </>
        )}
        <p>{t("deadlineAt", { time: deadline == null ? t("reading") : timeText(deadline) })}</p>
        <p>{t("chainTimeAt", { time: chainTime == null ? t("reading") : timeText(chainTime) })}</p>
      </div>

      {error ? <p className="text-red-300">{format(error)}</p> : null}

      {memberCount == null || blockNumber == null ? (
        <Skeleton className="inline-block h-4 w-48" />
      ) : members == null && error == null ? (
        <Skeleton className="inline-block h-4 w-48" />
      ) : members == null ? null : (
        <div className="flex flex-col gap-2">
          <p>{t("countCollateral", { done: locked ?? 0, total: total ?? 0 })}</p>
          <p>{t("countPaid", { done: paid ?? 0, total: total ?? 0 })}</p>
          {sealedKnown && sealedMembers != null ? (
            <>
              <p>{t("countSealed", { done: sealedMembers.length, total: total ?? 0 })}</p>
              {activity?.submittedCount != null && activity.submittedCount !== BigInt(sealedMembers.length) ? (
                <p className="text-emerald-50/70">
                  {t("submittedMismatch", {
                    count: activity.submittedCount.toString(),
                    roster: sealedMembers.length,
                  })}
                </p>
              ) : null}
              {sealedMembers.length === 0 ? (
                <p className="text-emerald-50/70">{t("noBidsSealed")}</p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {sealedMembers.map((member) => (
                    <li key={member.account} className="break-all font-mono text-xs">
                      {member.account}
                    </li>
                  ))}
                </ul>
              )}
              {members.some((member) => member.slashed) ? (
                <p className="text-emerald-50/70">
                  {t("slashedOut", {
                    addresses: members
                      .filter((member) => member.slashed)
                      .map((member) => member.account)
                      .join(", "),
                  })}
                </p>
              ) : null}
            </>
          ) : (
            <p className="text-emerald-50/70">{t("sealedUnavailable")}</p>
          )}
          <p className="text-emerald-50/60">{t("memberStorage", { block: activity?.blockNumber.toString() ?? "" })}</p>
          {activity?.logError ? <p className="text-red-300">{format(activity.logError)}</p> : null}
          {activity?.logs ? (
            activity.logs.cycleOpenedInWindow ? (
              <p className="text-emerald-50/70">
                {t("logsInclude", {
                  from: activity.logs.fromBlock.toString(),
                  to: activity.logs.toBlock.toString(),
                  locked: activity.logs.lockedAccounts.length,
                  paid: activity.logs.paidAccounts.length,
                  sealed: activity.logs.sealedAccounts.length,
                })}
              </p>
            ) : (
              <p className="text-emerald-50/70">
                {t("logsExclude", {
                  from: activity.logs.fromBlock.toString(),
                  to: activity.logs.toBlock.toString(),
                })}
              </p>
            )
          ) : null}
        </div>
      )}
    </section>
  );
}
