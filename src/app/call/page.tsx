"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Phase 1 browser-call page. Loads the public Vapi config from our server
 * (I2: only the public key reaches the browser), starts a WebRTC call, and
 * shows the live transcript + first-audio latency (R4). Barge-in and silence
 * handling live in the assistant config (§6 rules 6 & 9).
 */

interface TranscriptLine {
  role: "assistant" | "user";
  text: string;
}

type Status = "idle" | "connecting" | "live" | "ended" | "error";

export default function CallPage() {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [firstAudioMs, setFirstAudioMs] = useState<number | null>(null);
  const [clinicName, setClinicName] = useState<string>("");
  const vapiRef = useRef<unknown>(null);
  const startedAtRef = useRef<number>(0);

  const start = useCallback(async () => {
    setError(null);
    setTranscript([]);
    setFirstAudioMs(null);
    setStatus("connecting");
    try {
      const res = await fetch("/api/call/session", { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? `session error ${res.status}`);
      }
      const cfg = (await res.json()) as {
        publicKey: string;
        assistantId: string;
        metadata: Record<string, unknown>;
        clinicName: string;
      };
      setClinicName(cfg.clinicName);

      const { default: Vapi } = await import("@vapi-ai/web");
      const vapi = new Vapi(cfg.publicKey);
      vapiRef.current = vapi;

      vapi.on("call-start", () => {
        startedAtRef.current = performance.now();
        setStatus("live");
      });
      vapi.on("speech-start", () => {
        if (firstAudioMs === null && startedAtRef.current) {
          setFirstAudioMs(Math.round(performance.now() - startedAtRef.current));
        }
      });
      vapi.on("message", (msg: { type?: string; role?: string; transcript?: string; transcriptType?: string }) => {
        if (msg.type === "transcript" && msg.transcriptType === "final" && msg.transcript) {
          setTranscript((prev) => [
            ...prev,
            { role: msg.role === "user" ? "user" : "assistant", text: msg.transcript as string },
          ]);
        }
      });
      vapi.on("call-end", () => setStatus("ended"));
      vapi.on("error", (e: unknown) => {
        setError(e instanceof Error ? e.message : "call error");
        setStatus("error");
      });

      await vapi.start(cfg.assistantId, { metadata: cfg.metadata });
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not start call");
      setStatus("error");
    }
  }, [firstAudioMs]);

  const stop = useCallback(() => {
    const vapi = vapiRef.current as { stop?: () => void } | null;
    vapi?.stop?.();
    setStatus("ended");
  }, []);

  useEffect(() => {
    return () => {
      const vapi = vapiRef.current as { stop?: () => void } | null;
      vapi?.stop?.();
    };
  }, []);

  return (
    <main style={{ maxWidth: 640, margin: "0 auto", padding: "3rem 1.5rem" }}>
      <h1 style={{ marginBottom: "0.25rem" }}>వాణి · Vaani</h1>
      <p style={{ color: "#666", marginTop: 0 }}>
        {clinicName ? `Talking to ${clinicName}` : "Browser call demo (Phase 1)"}
      </p>

      <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", margin: "1.5rem 0" }}>
        {status !== "live" ? (
          <button
            onClick={start}
            disabled={status === "connecting"}
            style={{
              padding: "0.75rem 1.5rem",
              fontSize: "1rem",
              borderRadius: 8,
              border: "none",
              background: "#0a7d4b",
              color: "white",
              cursor: "pointer",
            }}
          >
            {status === "connecting" ? "Connecting…" : "📞 Start call"}
          </button>
        ) : (
          <button
            onClick={stop}
            style={{
              padding: "0.75rem 1.5rem",
              fontSize: "1rem",
              borderRadius: 8,
              border: "none",
              background: "#c0392b",
              color: "white",
              cursor: "pointer",
            }}
          >
            ■ End call
          </button>
        )}
        <span style={{ color: "#888", fontSize: "0.9rem" }}>status: {status}</span>
      </div>

      {firstAudioMs !== null && (
        <p style={{ fontSize: "0.9rem", color: firstAudioMs < 1500 ? "#0a7d4b" : "#c0392b" }}>
          first-audio latency: {firstAudioMs} ms {firstAudioMs < 1500 ? "✅ (< 1.5s target)" : "⚠️ over target"}
        </p>
      )}

      {error && (
        <div style={{ background: "#fdecea", padding: "1rem", borderRadius: 8, color: "#a3322a" }}>
          {error}
        </div>
      )}

      <div style={{ marginTop: "1.5rem" }}>
        {transcript.map((line, i) => (
          <div
            key={i}
            style={{
              margin: "0.5rem 0",
              textAlign: line.role === "user" ? "right" : "left",
            }}
          >
            <span
              style={{
                display: "inline-block",
                padding: "0.5rem 0.85rem",
                borderRadius: 12,
                background: line.role === "user" ? "#e8f0fe" : "#eef7f0",
                maxWidth: "80%",
              }}
            >
              {line.text}
            </span>
          </div>
        ))}
      </div>
    </main>
  );
}
