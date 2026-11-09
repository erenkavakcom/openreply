import { after, connection } from "next/server";
import { redirect } from "next/navigation";
import { Panel } from "@/components/panel";
import { hasDatabase, query } from "@/lib/db";
import { isSignedIn, passwordReady } from "@/lib/auth";
import { DEFAULT_GATE_TEXT, DM_PER_HOUR, REPLIES_PER_HOUR, hourStats, listEvents, listRules, processQueue, readIg, refreshTokenIfDue, tokenDaysLeft } from "@/lib/instagram";
import { siteUrl } from "@/lib/site-url";

export default async function Home() {
  // settings come from the environment and the database at request time, never from the build
  await connection();
  if (!hasDatabase() || !passwordReady() || !(await isSignedIn())) redirect("/giris");
  const [settings, rules, events, stats, url, [seen]] = await Promise.all([
    readIg().then(refreshTokenIfDue),
    listRules(),
    listEvents(),
    hourStats(),
    siteUrl(),
    query<{ id: number }>("SELECT id FROM ig_events LIMIT 1"),
  ]);
  // opening the panel also sends whatever waits in the queue
  if (stats.queued) after(() => processQueue(20));
  return (
    <Panel
      connection={{
        connected: Boolean(settings.token),
        username: settings.username ?? "",
        daysLeft: tokenDaysLeft(settings),
        hasSecret: Boolean(settings.appSecret),
        verifyToken: settings.verifyToken ?? "",
        siteUrl: url,
        webhookSeen: Boolean(seen),
      }}
      rules={rules.map((r) => ({ ...r, active: Boolean(r.active), follow_gate: Boolean(r.follow_gate) }))}
      events={events.map((e) => ({
        id: e.id,
        username: e.username,
        comment_text: e.comment_text,
        status: e.status,
        error: e.error,
        created_at: new Date(e.created_at).toISOString(),
      }))}
      stats={{ ...stats, dmCap: DM_PER_HOUR, replyCap: REPLIES_PER_HOUR }}
      defaultGateText={DEFAULT_GATE_TEXT}
    />
  );
}
