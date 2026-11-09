// On a regular Node server (Hostinger, a VPS) the queue is checked every two minutes. On Vercel the scheduled job
// (/api/cron), each webhook call and each panel visit do it instead.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.VERCEL) return;
  if (process.env.NEXT_PHASE === "phase-production-build" || !(process.env.DATABASE_URL || process.env.POSTGRES_URL)) return;
  const g = globalThis as unknown as { __igQueue?: ReturnType<typeof setInterval> };
  if (g.__igQueue) return;
  const { processQueue } = await import("@/lib/instagram");
  g.__igQueue = setInterval(() => void processQueue().catch(() => {}), 2 * 60_000);
  g.__igQueue.unref?.();
}
