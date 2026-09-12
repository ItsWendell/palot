export const sessionSnoozeChoices = [
  ["In 1 hour", (now: number) => now + 60 * 60 * 1_000],
  ["In 3 hours", (now: number) => now + 3 * 60 * 60 * 1_000],
  ["Tomorrow", tomorrowAtNine],
  ["Next week", nextWeekAtNine],
] as const;

export function formatSnoozeMenuTime(value: number): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
}

export function formatSnoozeWakeTime(value: number): string {
  const today = new Date();
  const date = new Date(value);
  const sameDay = today.toDateString() === date.toDateString();
  return new Intl.DateTimeFormat(
    undefined,
    sameDay
      ? { hour: "numeric", minute: "2-digit" }
      : { weekday: "short", hour: "numeric", minute: "2-digit" },
  ).format(date);
}

function tomorrowAtNine(now: number): number {
  const date = new Date(now);
  date.setDate(date.getDate() + 1);
  date.setHours(9, 0, 0, 0);
  return date.getTime();
}

function nextWeekAtNine(now: number): number {
  const date = new Date(now);
  const days = (8 - date.getDay()) % 7 || 7;
  date.setDate(date.getDate() + days);
  date.setHours(9, 0, 0, 0);
  return date.getTime();
}
