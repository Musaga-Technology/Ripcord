import { describe, expect, it } from 'vitest';
import { callReason, type WatchState } from '../src/band';

const base: WatchState = {
  distance: 40,
  lastCheckedDistance: 40,
  lastCheckAt: 0,
  now: 10_000,
  falling: false,
  mark: 2400,
  pendingLiqBefore: null,
  justRescued: false,
};

describe('when the poker wakes the checker', () => {
  it('stays quiet far from liquidation', () => expect(callReason(base)).toBeNull());
  it('calls on entering the band', () =>
    expect(callReason({ ...base, distance: 29, lastCheckedDistance: null })).toBe('band-drop'));
  it('calls when the distance drops 0.5 pp inside the band', () =>
    expect(callReason({ ...base, distance: 20, lastCheckedDistance: 20.6 })).toBe('band-drop'));
  it('stays quiet on a small move inside the band', () =>
    expect(callReason({ ...base, distance: 20, lastCheckedDistance: 20.2 })).toBeNull());
  it('calls every 3 s while falling inside the band', () => {
    expect(callReason({ ...base, distance: 20, lastCheckedDistance: 20.2, falling: true, now: 2_000 })).toBeNull();
    expect(callReason({ ...base, distance: 20, lastCheckedDistance: 20.2, falling: true, now: 3_000 })).toBe(
      'band-falling',
    );
  });
  it('sends the hourly heartbeat', () => expect(callReason({ ...base, now: 3_600_000 })).toBe('heartbeat'));
  it('watches settlement near the pre-rescue liquidation price', () =>
    expect(callReason({ ...base, mark: 2140, pendingLiqBefore: 2131 })).toBe('settlement'));
  it('records a rescue right away', () => expect(callReason({ ...base, justRescued: true })).toBe('after-rescue'));
});
