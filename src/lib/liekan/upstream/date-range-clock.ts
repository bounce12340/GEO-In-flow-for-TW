'use client';
import { useEffect, useRef, useState } from 'react';
import { calendarDayRange } from '../contracts/calendar';
import { useManualRefresh } from './manual-client';

/** Calendar presets share the current page's explicit read time. */
export function useDateRangeClock(timezone: string, dynamic = true) {
  const reading = useManualRefresh();
  const initial = useRef(Date.now());
  const [localNow, setLocalNow] = useState(initial.current);
  const now = reading?.page.now ?? localNow;
  useEffect(() => {
    if (!dynamic) return;
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone || 'Asia/Taipei',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
    });
    const check = () => {
      if (document.visibilityState === 'hidden') return;
      const next = Date.now();
      if (formatter.format(now) === formatter.format(next)) return;
      if (reading) reading.advanceClock(reading.page.token);
      else setLocalNow(next);
    };
    check();
    const delay = Math.min(
      30000,
      Math.max(
        20,
        calendarDayRange(Date.now(), timezone || 'Asia/Taipei').endAt + 2 - Date.now(),
      ),
    );
    const boundary = setTimeout(check, delay);
    const timer = setInterval(check, 30000);
    document.addEventListener('visibilitychange', check);
    window.addEventListener('focus', check);
    return () => {
      clearTimeout(boundary);
      clearInterval(timer);
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener('focus', check);
    };
  }, [now, timezone, dynamic, reading?.page.token, reading?.advanceClock]);
  return now;
}
