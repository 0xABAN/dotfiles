// configs:powerline-meter-v1
/** Clamp the five-cell gauge, but retain the reported percentage and approximation. */
function contextMeter(percent: number | null, approximate: boolean): string {
  if (percent === null || !Number.isFinite(percent)) return "● [-----] ? context";
  const filled = Math.round(Math.max(0, Math.min(100, percent)) / 20);
  return `● [${"▰".repeat(filled)}${"▱".repeat(5 - filled)}] ${approximate ? "~" : ""}${Math.round(percent)}% context`;
}
