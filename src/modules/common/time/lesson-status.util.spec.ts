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

  it.each([
    ['UTC-5 (EST)', '2026-06-26T19:00:00.000Z'],
    ['UTC-8 (PST)', '2026-06-26T22:00:00.000Z'],
    ['UTC+0 (GMT)', '2026-06-26T14:00:00.000Z'],
    ['UTC+1 (CET)', '2026-06-26T13:00:00.000Z'],
    ['UTC+8 (CST)', '2026-06-26T06:00:00.000Z'],
  ])('supports frontend dropdown timezone value %s', (timeZone, expected) => {
    const startsAt = combineDateAndTime(
      new Date('2026-06-26T00:00:00.000Z'),
      '14:00',
      timeZone,
    );

    expect(startsAt.toISOString()).toBe(expected);
  });
});
