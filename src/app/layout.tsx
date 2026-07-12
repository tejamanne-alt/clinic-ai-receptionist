import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Vaani — clinic voice receptionist",
  description: "Telugu-first AI voice receptionist for Indian clinics",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily: "system-ui, sans-serif",
          margin: 0,
          background: "#fafaf7",
          color: "#1a1a1a",
        }}
      >
        {children}
      </body>
    </html>
  );
}
