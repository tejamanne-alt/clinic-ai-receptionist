import { loadDashboard } from "@/lib/dashboard/queries";

export const dynamic = "force-dynamic";

const DEMO_CLINIC_ID = process.env.DEMO_CLINIC_ID ?? "00000000-0000-0000-0000-000000000001";

const card: React.CSSProperties = {
  background: "white",
  border: "1px solid #e6e6e2",
  borderRadius: 12,
  padding: "1.25rem 1.5rem",
  marginBottom: "1.5rem",
};
const th: React.CSSProperties = { textAlign: "left", padding: "0.5rem 0.75rem", color: "#666", fontWeight: 600, fontSize: "0.8rem", textTransform: "uppercase" };
const td: React.CSSProperties = { padding: "0.5rem 0.75rem", borderTop: "1px solid #f0f0ec" };

function Badge({ text }: { text: string }) {
  const colors: Record<string, string> = {
    confirmed: "#0a7d4b",
    booked: "#0a7d4b",
    cancelled: "#c0392b",
    abandoned: "#a06a00",
    escalated: "#a06a00",
    info_given: "#2c6cb0",
  };
  return (
    <span style={{ color: colors[text] ?? "#555", fontWeight: 600, fontSize: "0.85rem" }}>{text}</span>
  );
}

export default async function DashboardPage() {
  let data: Awaited<ReturnType<typeof loadDashboard>> = null;
  let dbError: string | null = null;
  try {
    data = await loadDashboard(DEMO_CLINIC_ID);
  } catch (err) {
    dbError = err instanceof Error ? err.message : "database unavailable";
  }

  if (dbError || !data) {
    return (
      <main style={{ maxWidth: 900, margin: "0 auto", padding: "3rem 1.5rem" }}>
        <h1>Vaani dashboard</h1>
        <div style={{ ...card, background: "#fdf6ec", borderColor: "#f0d9a8" }}>
          <p style={{ margin: 0 }}>
            {dbError
              ? `Database not reachable: ${dbError}`
              : "Demo clinic not found. Run the migrations and seed (scripts/db/setup-local.sh)."}
          </p>
        </div>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: "2.5rem 1.5rem" }}>
      <h1 style={{ marginBottom: "0.25rem" }}>{data.clinicName}</h1>
      <p style={{ color: "#777", marginTop: 0 }}>Vaani reception dashboard</p>

      <section style={card}>
        <h2 style={{ marginTop: 0 }}>Today&apos;s appointments ({data.appointments.length})</h2>
        {data.appointments.length === 0 ? (
          <p style={{ color: "#888" }}>No appointments today.</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={th}>Time</th>
                <th style={th}>Patient</th>
                <th style={th}>Phone</th>
                <th style={th}>Doctor</th>
                <th style={th}>Status</th>
                <th style={th}>Source</th>
              </tr>
            </thead>
            <tbody>
              {data.appointments.map((a) => (
                <tr key={a.id}>
                  <td style={td}>{a.label}</td>
                  <td style={td}>{a.patientName}</td>
                  <td style={td}>{a.patientPhone}</td>
                  <td style={td}>{a.doctorName}</td>
                  <td style={td}><Badge text={a.status} /></td>
                  <td style={td}>{a.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section style={card}>
        <h2 style={{ marginTop: 0 }}>Call log ({data.calls.length})</h2>
        {data.calls.length === 0 ? (
          <p style={{ color: "#888" }}>No calls yet.</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={th}>Started</th>
                <th style={th}>From</th>
                <th style={th}>Lang</th>
                <th style={th}>Intent</th>
                <th style={th}>Outcome</th>
                <th style={th}>Turns</th>
                <th style={th}>Duration</th>
              </tr>
            </thead>
            <tbody>
              {data.calls.map((c) => (
                <tr key={c.id}>
                  <td style={td}>{new Date(c.startedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</td>
                  <td style={td}>{c.fromPhone ?? "—"}</td>
                  <td style={td}>{c.language ?? "—"}</td>
                  <td style={td}>{c.intent ?? "—"}</td>
                  <td style={td}>{c.outcome ? <Badge text={c.outcome} /> : "—"}</td>
                  <td style={td}>{c.turns}</td>
                  <td style={td}>{c.durationSec !== null ? `${c.durationSec}s` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section style={card}>
        <h2 style={{ marginTop: 0 }}>Callback queue ({data.callbacks.length})</h2>
        {data.callbacks.length === 0 ? (
          <p style={{ color: "#888" }}>No open callbacks.</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={th}>Requested</th>
                <th style={th}>Name</th>
                <th style={th}>Phone</th>
                <th style={th}>Reason</th>
              </tr>
            </thead>
            <tbody>
              {data.callbacks.map((cb) => (
                <tr key={cb.id}>
                  <td style={td}>{new Date(cb.createdAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</td>
                  <td style={td}>{cb.name ?? "—"}</td>
                  <td style={td}>{cb.phone ?? "—"}</td>
                  <td style={td}>{cb.reason ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
