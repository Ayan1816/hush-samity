import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const ARTIFACT = path.join("artifacts", "contracts", "Samity.sol", "Samity.json");

async function readArtifact(): Promise<{ bytecode: string }> {
  const candidates = [
    path.join(process.cwd(), ARTIFACT),
    path.join(process.cwd(), "..", ARTIFACT),
  ];
  let lastError: unknown;
  for (const file of candidates) {
    try {
      const parsed = JSON.parse(await readFile(file, "utf8")) as { bytecode?: unknown };
      if (typeof parsed.bytecode !== "string" || !parsed.bytecode.startsWith("0x") || parsed.bytecode === "0x") {
        throw new Error(`${file} has no Samity creation bytecode.`);
      }
      return { bytecode: parsed.bytecode };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Samity artifact was not found.");
}

export async function GET() {
  try {
    const artifact = await readArtifact();
    return NextResponse.json(artifact);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not read the Samity artifact.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
