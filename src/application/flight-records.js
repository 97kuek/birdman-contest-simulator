// 滑空機部門の公式記録（2026年大会まで）。採点と表示はセンチメートル単位。
export const GLIDER_RECORDS = Object.freeze({
  winner2026: 44299,
  allTime: 64515,
});

export class FlightRecords {
  #best = new Map();
  #scores = new WeakMap();
  #storage;

  constructor(getStorage) {
    this.#storage = getStorage;
  }

  record(run) {
    if (this.#scores.has(run)) return this.#scores.get(run);
    const metres = run.distance.toFixed(2);
    const cm = Number(metres.replace('.', ''));
    const key = 'ryukai.personal-best.cm.v1.' + run.weather;
    let prior = this.#best.get(key) ?? null;
    let storage;
    try {
      storage = this.#storage();
      const saved = storage.getItem(key);
      if (saved !== null && /^\d+$/.test(saved) && Number.isSafeInteger(Number(saved))) {
        prior = Math.max(prior ?? 0, Number(saved));
      }
    } catch {
      // Browser privacy settings can also deny access to the storage object itself.
    }
    const best = Math.max(prior ?? 0, cm);
    this.#best.set(key, best);
    if (prior === null || cm > prior) {
      try {
        storage?.setItem(key, String(best));
      } catch {
        // A full or disabled store still leaves the best available for retries in this session.
      }
    }
    const personal = prior === null ? 'first' : cm > prior ? 'improved' : cm === prior ? 'tied' : 'below';
    const official = cm > GLIDER_RECORDS.allTime ? 'allTime' : cm > GLIDER_RECORDS.winner2026 ? 'winner2026' : null;
    const score = { metres, personal, best, official };
    this.#scores.set(run, score);
    return score;
  }

  forRun(run) {
    return this.#scores.get(run);
  }
}
