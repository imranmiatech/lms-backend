import {
  combineDateAndTime,
  getTimedClassStatusByDuration,
} from './lesson-status.util';

describe('lesson-status.util', () => {
  it('combines a date and clock time in an IANA timezone', () => {
    const startsAt = combineDateAndTime(
      new Date('2026-06-26T00:00:00.000Z'),
      '08:58',
      'Asia/Dhaka',
    );

    expect(startsAt.toISOString()).toBe('2026-06-26T02:58:00.000Z');
    expect(
      getTimedClassStatusByDuration(
        startsAt,
        45,
        new Date('2026-06-26T03:15:00.000Z'),
      ),
    ).toBe('live');
  });

  it('combines a date and clock time in a UTC offset timezone label', () => {
    const startsAt = combineDateAndTime(
      new Date('2026-06-26T00:00:00.000Z'),
      '08:58',
      'UTC+06:00',
    );

    expect(startsAt.toISOString()).toBe('2026-06-26T02:58:00.000Z');
  });

  it('combines a date and clock time in a UTC offset label with text', () => {
    const startsAt = combineDateAndTime(
      new Date('2026-06-26T00:00:00.000Z'),
      '08:58',
      'UTC-5 (EST)',
    );

    expect(startsAt.toISOString()).toBe('2026-06-26T13:58:00.000Z');
  });
});
