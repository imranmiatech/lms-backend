export type TimedClassStatus = 'upcoming' | 'live' | 'completed';

export type ParsedClockTime = {
  hours: number;
  minutes: number;
  totalMinutes: number;
};

export function getTimedClassStatus(
  startsAt: Date,
  endsAt: Date,
  now = new Date(),
): TimedClassStatus {
  if (now < startsAt) {
    return 'upcoming';
  }

  if (now >= endsAt) {
    return 'completed';
  }

  return 'live';
}

export function getTimedClassStatusByDuration(
  startsAt: Date,
  durationMinutes: number,
  now = new Date(),
): TimedClassStatus {
  return getTimedClassStatus(
    startsAt,
    new Date(startsAt.getTime() + durationMinutes * 60 * 1000),
    now,
  );
}

export function parseClockTime(time: string): ParsedClockTime | null {
  const normalized = time.trim().toLowerCase();
  const match = normalized.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);

  if (!match) {
    return null;
  }

  let hours = Number(match[1]);
  const minutes = match[2] ? Number(match[2]) : 0;
  const meridiem = match[3];

  if (meridiem === 'pm' && hours < 12) {
    hours += 12;
  }

  if (meridiem === 'am' && hours === 12) {
    hours = 0;
  }

  if (hours > 23 || minutes > 59) {
    return null;
  }

  return {
    hours,
    minutes,
    totalMinutes: hours * 60 + minutes,
  };
}

export function combineDateAndTime(
  date: Date,
  time: string,
  timeZone?: string | null,
) {
  const parsed = parseClockTime(time);

  if (!parsed) {
    return new Date(date);
  }

  const normalizedTimeZone = normalizeTimeZone(timeZone);

  if (normalizedTimeZone?.type === 'offset') {
    return getOffsetDateTime(
      date,
      parsed.hours,
      parsed.minutes,
      normalizedTimeZone.offsetMinutes,
    );
  }

  if (normalizedTimeZone?.type === 'iana') {
    return getZonedDateTime(
      date,
      parsed.hours,
      parsed.minutes,
      normalizedTimeZone.timeZone,
    );
  }

  const combined = new Date(date);
  combined.setHours(parsed.hours, parsed.minutes, 0, 0);

  return combined;
}

function normalizeTimeZone(
  timeZone?: string | null,
):
  | { type: 'iana'; timeZone: string }
  | { type: 'offset'; offsetMinutes: number }
  | null {
  if (!timeZone?.trim()) {
    return null;
  }

  const normalized = timeZone.trim();
  const alias = TIME_ZONE_ALIASES[normalized.toLowerCase()];

  if (alias) {
    return { type: 'iana', timeZone: alias };
  }

  const offset = parseTimeZoneOffset(normalized);

  if (offset !== null) {
    return { type: 'offset', offsetMinutes: offset };
  }

  return { type: 'iana', timeZone: normalized };
}

const TIME_ZONE_ALIASES: Record<string, string> = {
  bdt: 'Asia/Dhaka',
  bangladesh: 'Asia/Dhaka',
  'bangladesh standard time': 'Asia/Dhaka',
  dhaka: 'Asia/Dhaka',
  gmt: 'UTC',
  utc: 'UTC',
};

function parseTimeZoneOffset(timeZone: string) {
  const match = timeZone.match(
    /\b(?:utc|gmt)\s*([+-])\s*(\d{1,2})(?::?(\d{2}))?\b/i,
  );

  if (!match) {
    return null;
  }

  const hours = Number(match[2]);
  const minutes = match[3] ? Number(match[3]) : 0;

  if (hours > 23 || minutes > 59) {
    return null;
  }

  const totalMinutes = hours * 60 + minutes;

  return match[1] === '-' ? -totalMinutes : totalMinutes;
}

function getOffsetDateTime(
  date: Date,
  hours: number,
  minutes: number,
  offsetMinutes: number,
) {
  const localTime = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    hours,
    minutes,
    0,
    0,
  );

  return new Date(localTime - offsetMinutes * 60 * 1000);
}

function getZonedDateTime(
  date: Date,
  hours: number,
  minutes: number,
  timeZone: string,
) {
  const target = {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hours,
    minutes,
  };
  let utcTime = Date.UTC(
    target.year,
    target.month - 1,
    target.day,
    target.hours,
    target.minutes,
    0,
    0,
  );

  try {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const parts = getDatePartsInTimeZone(new Date(utcTime), timeZone);
      const zonedTime = Date.UTC(
        parts.year,
        parts.month - 1,
        parts.day,
        parts.hours,
        parts.minutes,
        0,
        0,
      );
      const targetTime = Date.UTC(
        target.year,
        target.month - 1,
        target.day,
        target.hours,
        target.minutes,
        0,
        0,
      );
      const diff = zonedTime - targetTime;

      if (diff === 0) {
        break;
      }

      utcTime -= diff;
    }

    return new Date(utcTime);
  } catch {
    const combined = new Date(date);
    combined.setHours(hours, minutes, 0, 0);
    return combined;
  }
}

function getDatePartsInTimeZone(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = formatter.formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);

  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    hours: value('hour'),
    minutes: value('minute'),
  };
}
