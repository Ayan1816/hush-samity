import { NextResponse } from "next/server";
import { abi, bytecode } from "@/src/lib/samityArtifact";

export const runtime = "nodejs";

export function GET() {
  return NextResponse.json({ abi, bytecode });
}
