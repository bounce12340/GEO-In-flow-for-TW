import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { setTestUrl } from '@/test/navigation';
import { useApp } from '@/store/app';
import * as storage from '@/lib/storage';

const state = vi.hoisted(() => ({ share: null as any }));
vi.mock('./context/useShare', () => ({ useShare: () => state.share }));
import { useTimezone } from './useTimezone';
import {useDateRange} from './useDateRange';

beforeEach(() => {
  state.share = null;
  setTestUrl('/');
  useApp.setState({ timezone: 'Asia/Tokyo' });
});

it('keeps private account timezone behavior', () => {
  expect(renderHook(() => useTimezone()).result.current.timezone).toBe('Asia/Tokyo');
});

it('pins the public share timezone and leaves account settings unchanged', () => {
  state.share = { parameters: { timezone: 'America/New_York' } };
  setTestUrl('/share/published?legacy=1');
  const save = vi.spyOn(storage, 'setItem');
  const { result } = renderHook(() => useTimezone());
  expect(result.current.timezone).toBe('America/New_York');
  expect(result.current.localTimeZone).toBe('America/New_York');
  act(() => result.current.saveTimezone('Europe/London'));
  expect(useApp.getState().timezone).toBe('Asia/Tokyo');
  expect(save).not.toHaveBeenCalled();
});

it('uses Taipei while an old or pending public share has no saved timezone', () => {
  setTestUrl('/share/old?legacy=1');
  expect(renderHook(() => useTimezone()).result.current.timezone).toBe('Asia/Taipei');
});

it('advances a public Today preset even when the viewer saved a custom private range', async () => {
 vi.useFakeTimers();
 try {
  vi.setSystemTime(new Date('2026-10-24T15:59:59Z'));
  useApp.setState({dateRangeValue:'range:1:2'});
  state.share={parameters:{timezone:'Asia/Shanghai',range:'0day'}};
  setTestUrl('/share/published?legacy=1');
  const hook=renderHook(()=>useDateRange({timezone:'Asia/Shanghai'}));
  const before=hook.result.current.sharedRange;
  await act(async()=>vi.advanceTimersByTimeAsync(31000));
  expect(hook.result.current.sharedRange.startAt).toBe(before.endAt+1);
 } finally {vi.useRealTimers();}
});
