const relativeFormat = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

/** Formats an ISO timestamp as a short relative time such as "5 minutes ago". */
export function formatRelativeTime(
  iso: string,
  now: number = Date.now(),
): string {
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000);
  const abs = Math.abs(seconds);

  if (abs < 60) return relativeFormat.format(seconds, "second");
  if (abs < 3600)
    return relativeFormat.format(Math.round(seconds / 60), "minute");
  if (abs < 86_400)
    return relativeFormat.format(Math.round(seconds / 3600), "hour");
  return relativeFormat.format(Math.round(seconds / 86_400), "day");
}
