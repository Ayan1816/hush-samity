import { NextResponse } from "next/server";
import { abi, bytecode } from "@/src/lib/samityArtifact";

/** Bundled copy of the Samity artifact. Nothing is read from the gitignored artifacts directory. */
export function GET() {
  return NextResponse.json({ abi, bytecode });
}
