// All trial phases use the same timeline, including input events between frames.
export function createFlightClock(readTime) {
  let pausedAt = null;
  let pausedDuration = 0;
  return {
    now: () => (pausedAt ?? readTime()) - pausedDuration,
    get paused() { return pausedAt !== null; },
    setPaused(paused) {
      if (paused === (pausedAt !== null)) return;
      if (paused) pausedAt = readTime();
      else {
        pausedDuration += readTime() - pausedAt;
        pausedAt = null;
      }
    },
  };
}
