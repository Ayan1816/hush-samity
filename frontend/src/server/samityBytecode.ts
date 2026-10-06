import { NextResponse } from "next/server";
import samityArtifact from "../../../artifacts/contracts/Samity.sol/Samity.json";

/**
 * Static import so Next bundles the Hardhat artifact into the server build.
 * Vercel serverless functions cannot scandir or read arbitrary files at runtime.
 */
export function GET() {
  return NextResponse.json(samityArtifact);
}
