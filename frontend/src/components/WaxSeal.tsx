"use client";

import { useI18n } from "@/src/i18n/LanguageProvider";
import type { MessageKey } from "@/src/i18n/messages";

export type WaxSealStage =
  | "idle"
  | "initTfhe"
  | "fetchKeys"
  | "pack"
  | "prove"
  | "verify"
  | "awaitingReceipt"
  | "stamped"
  | "locked";

const STAGE_LABEL: Partial<Record<WaxSealStage, MessageKey>> = {
  initTfhe: "stepInit",
  fetchKeys: "stepFetch",
  pack: "stepPack",
  prove: "stepProve",
  verify: "stepVerify",
};

function sealCopy(
  stage: WaxSealStage,
  running: boolean,
  t: (key: MessageKey, vars?: { stage: string }) => string,
): string {
  if (stage === "stamped") return t("waxStamped");
  if (stage === "locked") return t("waxLocked");
  if (stage === "awaitingReceipt") return t("waxAwaiting");
  if (stage === "idle") return t("waxIdle");
  const label = STAGE_LABEL[stage];
  const name = label ? t(label) : stage;
  return running ? t("waxRunning", { stage: name }) : t("waxFinished", { stage: name });
}

const STYLE = `
.wax-melt { transform-origin: 80px 90px; animation: wax-melt 1.4s ease-in-out infinite; }
.wax-drip { transform-box: fill-box; transform-origin: center top; animation: wax-drip 1.2s ease-in-out infinite; }
.wax-stamped { transform-origin: 80px 74px; animation: wax-pulse 1.15s ease-out 1; }
@keyframes wax-melt {
  0% { transform: scale(1, 1) translateY(0); }
  50% { transform: scale(1.06, 0.9) translateY(6px); }
  100% { transform: scale(0.98, 1.02) translateY(0); }
}
@keyframes wax-drip {
  0% { transform: scaleY(0.35); opacity: 0.35; }
  100% { transform: scaleY(1); opacity: 1; }
}
@keyframes wax-pulse {
  0% { transform: scale(0.92); }
  45% { transform: scale(1.08); }
  100% { transform: scale(1); }
}
@media (prefers-reduced-motion: reduce) {
  .wax-melt, .wax-drip, .wax-stamped { animation: none; }
}
`;

export function WaxSeal({ stage, running }: { stage: WaxSealStage; running: boolean }) {
  const { t } = useI18n();
  const copy = sealCopy(stage, running, t);
  const melting = running && (stage === "pack" || stage === "prove");
  const forming = stage === "verify" || stage === "awaitingReceipt" || stage === "stamped" || stage === "locked";
  const motion = stage === "stamped" ? "wax-stamped" : melting ? "wax-melt" : undefined;

  return (
    <figure className="flex flex-col items-center gap-2">
      <svg viewBox="0 0 160 190" className="h-40 w-36" role="img" aria-label={copy}>
        <style>{STYLE}</style>
        <g className={motion}>
          <ellipse cx="80" cy="78" rx="54" ry="50" fill="#6e1220" />
          <ellipse cx="80" cy="74" rx="50" ry="46" fill="#9f1d2e" />
          <ellipse cx="64" cy="60" rx="16" ry="9" fill="#d45363" opacity="0.85" />
          {melting ? (
            <g className="wax-drip">
              <ellipse cx="58" cy="124" rx="8" ry="16" fill="#9f1d2e" />
              <ellipse cx="80" cy="136" rx="10" ry="22" fill="#8c1828" />
              <ellipse cx="104" cy="120" rx="7" ry="14" fill="#9f1d2e" />
            </g>
          ) : null}
          {forming ? (
            <g opacity={stage === "verify" && running ? 0.55 : 1}>
              <circle cx="80" cy="74" r="28" fill="none" stroke="#f3d7a1" strokeWidth="2" />
              <circle cx="80" cy="74" r="22" fill="none" stroke="#f3d7a1" strokeWidth="1" />
              <text
                x="80"
                y="80"
                textAnchor="middle"
                fill="#f3d7a1"
                fontSize="16"
                fontFamily="ui-monospace, monospace"
              >
                HS
              </text>
            </g>
          ) : null}
        </g>
      </svg>
      <figcaption className="text-center font-mono text-xs text-emerald-50/80">{copy}</figcaption>
    </figure>
  );
}
