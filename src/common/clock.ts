/** DI token for time. Batch runs and tests use a fixed clock so outputs are deterministic. */
export abstract class Clock {
  abstract now(): Date;
}

export class SystemClock extends Clock {
  now(): Date {
    return new Date();
  }
}

export class FixedClock extends Clock {
  constructor(private readonly at: Date) {
    super();
  }
  now(): Date {
    return new Date(this.at.getTime());
  }
}

/** Calendar date (YYYY-MM-DD) of an instant in the business timezone. */
export function localDate(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

export function hoursBetween(earlier: Date, later: Date): number {
  return (later.getTime() - earlier.getTime()) / 3_600_000;
}
