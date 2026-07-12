export default function Home() {
  return (
    <main style={{ maxWidth: 640, margin: "0 auto", padding: "4rem 1.5rem" }}>
      <h1 style={{ fontSize: "2rem", marginBottom: "0.25rem" }}>వాణి · Vaani</h1>
      <p style={{ color: "#555" }}>
        Telugu-first AI voice receptionist for Indian clinics.
      </p>
      <ul style={{ lineHeight: 1.9 }}>
        <li>Phase 0 — scaffold, migrations, STT/TTS bake-off harness ✅</li>
        <li>Phase 1 — browser voice loop (upcoming)</li>
        <li>Phase 2 — real bookings + WhatsApp (upcoming)</li>
        <li>Phase 3 — PSTN number + demo polish (upcoming)</li>
      </ul>
      <p style={{ color: "#777", fontSize: "0.9rem" }}>
        Dashboard (appointments, call log, callback queue) lands in Phase 2.
      </p>
    </main>
  );
}
