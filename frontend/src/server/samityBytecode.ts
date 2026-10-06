import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NextResponse } from "next/server";

const ARTIFACT = path.join("artifacts", "contracts", "Samity.sol", "Samity.json");

/**
 * This module lives outside `src/app`. Route handlers under `src/app` make
 * Next treat that folder as an app directory and scandir route children.
 */
function artifactCandidates(): string[] {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const roots = [
    moduleDir,
    path.resolve(moduleDir, ".."),
    path.resolve(moduleDir, "../.."),
    path.resolve(moduleDir, "../../.."),
    path.resolve(moduleDir, "../../../.."),
    process.cwd(),
    path.resolve(process.cwd(), ".."),
  ];
  return roots.map((root) => path.join(root, ARTIFACT));
}

async function readArtifact(): Promise<{ bytecode: string }> {
  const seen = new Set<string>();
  let lastError: unknown;
  for (const file of artifactCandidates()) {
    if (seen.has(file)) continue;
    seen.add(file);
    try {
      const info = await stat(file);
      if (!info.isFile()) continue;
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
