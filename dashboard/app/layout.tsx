import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "INSSA QA Operations",
  description: "Operations console for safe INSSA QA campaign runs."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
