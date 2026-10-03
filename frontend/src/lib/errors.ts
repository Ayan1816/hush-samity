export function errorText(error: unknown): string {
  if (typeof error === "object" && error !== null && "shortMessage" in error) {
    const shortMessage = error.shortMessage;
    if (typeof shortMessage === "string" && shortMessage.length > 0) return shortMessage;
  }
  if (error instanceof Error && error.message.length > 0) return error.message;
  return "The request failed.";
}
