import type { Address } from "viem";
import { formatTokenAmount } from "@/src/lib/tokenFormat";

const UINT256_MAX = (1n << 256n) - 1n;

function icsUtc(seconds: bigint): string {
  if (seconds < 0n || seconds > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("The deadline does not fit a calendar timestamp.");
  }
  const date = new Date(Number(seconds) * 1000);
  const year = date.getUTCFullYear().toString().padStart(4, "0");
  const month = (date.getUTCMonth() + 1).toString().padStart(2, "0");
  const day = date.getUTCDate().toString().padStart(2, "0");
  const hour = date.getUTCHours().toString().padStart(2, "0");
  const minute = date.getUTCMinutes().toString().padStart(2, "0");
  const second = date.getUTCSeconds().toString().padStart(2, "0");
  return `${year}${month}${day}T${hour}${minute}${second}Z`;
}

function escapeText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

function foldLine(line: string): string {
  const encoder = new TextEncoder();
  const parts: string[] = [];
  let buffer = "";
  let size = 0;
  let cap = 75;
  for (const char of line) {
    const width = encoder.encode(char).length;
    if (size + width > cap && buffer !== "") {
      parts.push(buffer);
      buffer = char;
      size = width;
      cap = 74;
    } else {
      buffer += char;
      size += width;
    }
  }
  if (buffer !== "") parts.push(buffer);
  return parts.map((part, index) => (index === 0 ? part : ` ${part}`)).join("\r\n");
}

/**
 * RFC 5545 calendar whose event starts at the on-chain deadline.
 * `DTEND` is one second later so the interval is non-empty. The description carries the unix deadline.
 */
export function roundDeadlineIcs(input: {
  samity: Address;
  cycle: bigint;
  deadline: bigint;
  installment: bigint;
  decimals: number | undefined;
  symbol: string | undefined;
  url: string | null;
  summary?: string;
  description?: string;
  alarm?: string;
}): string {
  if (input.cycle < 1n) throw new Error("The round number is below 1.");
  if (input.installment < 0n) throw new Error("The installment amount is negative.");
  if (input.deadline === UINT256_MAX) throw new Error("The deadline does not fit a calendar end time.");
  const start = icsUtc(input.deadline);
  const end = icsUtc(input.deadline + 1n);
  const stamp = icsUtc(BigInt(Math.floor(Date.now() / 1000)));
  const amount =
    input.decimals == null
      ? `${input.installment.toString()} base units`
      : formatTokenAmount(input.installment, input.decimals, input.symbol);
  const description = escapeText(
    input.description ??
      `Samity ${input.samity}. Round ${input.cycle.toString()}. Installment ${amount}. Deadline ${input.deadline.toString()}.`,
  );
  const summary = escapeText(input.summary ?? `Samity round ${input.cycle.toString()} deadline`);
  const alarm = escapeText(input.alarm ?? "Samity round deadline");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Hush Samity//Round Deadline//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${input.samity.toLowerCase()}-cycle-${input.cycle.toString()}-deadline-${input.deadline.toString()}@hush-samity`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `SUMMARY;CHARSET=UTF-8:${summary}`,
    `DESCRIPTION;CHARSET=UTF-8:${description}`,
  ];
  if (input.url) lines.push(`URL:${escapeText(input.url)}`);
  lines.push(
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    `DESCRIPTION;CHARSET=UTF-8:${alarm}`,
    "TRIGGER:PT0S",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  );
  return `${lines.map(foldLine).join("\r\n")}\r\n`;
}
