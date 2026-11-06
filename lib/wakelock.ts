interface WakeLockSentinelLike {
  release: () => Promise<void>;
}

let sentinel: WakeLockSentinelLike | null = null;
let count = 0;

/** Impede a suspensão durante o processamento (Screen Wake Lock API). */
export async function acquireWakeLock() {
  count++;
  try {
    const wl = (navigator as unknown as { wakeLock?: { request: (t: "screen") => Promise<WakeLockSentinelLike> } }).wakeLock;
    if (wl && !sentinel) sentinel = await wl.request("screen");
  } catch {
    /* indisponível ou negado */
  }
}

export async function releaseWakeLock() {
  count = Math.max(0, count - 1);
  if (count === 0 && sentinel) {
    try {
      await sentinel.release();
    } catch {
      /* ignore */
    }
    sentinel = null;
  }
}
