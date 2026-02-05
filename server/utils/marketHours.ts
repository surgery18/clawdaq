const MARKET_TIME_ZONE = "America/New_York";
const MARKET_OPEN_HOUR = 9;
const MARKET_OPEN_MINUTE = 30;
const MARKET_CLOSE_HOUR = 16;

const WEEKDAY_MAP: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6
};

const MARKET_HOLIDAYS_2026 = new Set([
  "2026-01-01", // New Year's Day
  "2026-01-19", // MLK Day
  "2026-02-16", // Presidents' Day
  "2026-05-25", // Memorial Day
  "2026-06-19", // Juneteenth
  "2026-07-03", // Independence Day (observed)
  "2026-09-07", // Labor Day
  "2026-11-26", // Thanksgiving
  "2026-12-25"  // Christmas
]);

type ZonedParts = {
  year: number;
  month: number;
  day: number;
  weekday: number;
  hour: number;
  minute: number;
  second: number;
};

const getZonedParts = (date: Date): ZonedParts => {
  const options: Intl.DateTimeFormatOptions = {
    timeZone: MARKET_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  };

  const parts = new Intl.DateTimeFormat("en-US", options).formatToParts(date);
  const lookup = (type: string) => parts.find((part) => part.type === type)?.value ?? "";

  const hourValue = lookup("hour");
  const hour = (hourValue === "24") ? 0 : Number(hourValue);

  return {
    year: Number(lookup("year")),
    month: Number(lookup("month")),
    day: Number(lookup("day")),
    weekday: WEEKDAY_MAP[lookup("weekday")] ?? 0,
    hour,
    minute: Number(lookup("minute")),
    second: Number(lookup("second"))
  };
};

const getTimeZoneOffsetMs = (date: Date): number => {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: MARKET_TIME_ZONE,
    timeZoneName: "shortOffset",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });
  const parts = formatter.formatToParts(date);
  const tzName = parts.find((part) => part.type === "timeZoneName")?.value ?? "GMT";
  const match = tzName.match(/GMT([+-]\d{1,2})(?::(\d{2}))?/);
  if (!match) return 0;
  const offsetHours = Number(match[1]);
  const offsetMinutes = Number(match[2] ?? 0);
  const sign = offsetHours < 0 ? -1 : 1;
  const totalMinutes = offsetHours * 60 + sign * offsetMinutes;
  return totalMinutes * 60 * 1000;
};

const zonedTimeToUtcMs = (year: number, month: number, day: number, hour: number, minute: number, second = 0): number => {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second);
  const offsetMs = getTimeZoneOffsetMs(new Date(utcGuess));
  return utcGuess - offsetMs;
};

const isWeekday = (weekday: number) => weekday >= 1 && weekday <= 5;

const toDateKey = (parts: ZonedParts) => {
  const month = String(parts.month).padStart(2, "0");
  const day = String(parts.day).padStart(2, "0");
  return `${parts.year}-${month}-${day}`;
};

const isMarketHoliday = (parts: ZonedParts) => MARKET_HOLIDAYS_2026.has(toDateKey(parts));

const isMarketDay = (parts: ZonedParts) => isWeekday(parts.weekday) && !isMarketHoliday(parts);

export const isMarketOpen = (): boolean => {
  const nowParts = getZonedParts(new Date());
  if (!isMarketDay(nowParts)) return false;

  const minutesSinceMidnight = nowParts.hour * 60 + nowParts.minute;
  const openMinutes = MARKET_OPEN_HOUR * 60 + MARKET_OPEN_MINUTE;
  const closeMinutes = MARKET_CLOSE_HOUR * 60;

  return minutesSinceMidnight >= openMinutes && minutesSinceMidnight < closeMinutes;
};

export const getNextMarketOpenMs = (): number => {
  const now = new Date();
  const parts = getZonedParts(now);

  const openMinutes = MARKET_OPEN_HOUR * 60 + MARKET_OPEN_MINUTE;
  const closeMinutes = MARKET_CLOSE_HOUR * 60;
  const minutesSinceMidnight = parts.hour * 60 + parts.minute;

  let targetYear = parts.year;
  let targetMonth = parts.month;
  let targetDay = parts.day;

  if (isMarketDay(parts)) {
    if (minutesSinceMidnight < openMinutes) {
      // Market opens later today.
    } else if (minutesSinceMidnight >= closeMinutes) {
      const nextDate = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + 1, 12));
      const nextParts = getZonedParts(nextDate);
      targetYear = nextParts.year;
      targetMonth = nextParts.month;
      targetDay = nextParts.day;
    } else {
      return 0;
    }
  } else {
    const nextDate = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + 1, 12));
    const nextParts = getZonedParts(nextDate);
    targetYear = nextParts.year;
    targetMonth = nextParts.month;
    targetDay = nextParts.day;
  }

  let cursorDate = new Date(Date.UTC(targetYear, targetMonth - 1, targetDay, 12));
  let cursorParts = getZonedParts(cursorDate);
  while (!isMarketDay(cursorParts)) {
    cursorDate = new Date(Date.UTC(cursorParts.year, cursorParts.month - 1, cursorParts.day + 1, 12));
    cursorParts = getZonedParts(cursorDate);
  }

  const targetMs = zonedTimeToUtcMs(cursorParts.year, cursorParts.month, cursorParts.day, MARKET_OPEN_HOUR, MARKET_OPEN_MINUTE);
  return Math.max(0, targetMs - Date.now());
};
