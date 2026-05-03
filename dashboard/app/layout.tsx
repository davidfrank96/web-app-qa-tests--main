import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Local Man QA Dashboard",
  description: "Live dashboard for Local Man Playwright results."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
