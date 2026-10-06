import type { Metadata } from "next";
import { getCanonicalPublicOrigin } from "../lib/inssa-ops/request-security";
import "./globals.css";

const title = "INSSA QA Operations | KBean";
const description = "KBean QA operations console for safe INSSA testing, monitoring, evidence, and security workflows.";
const brandPath = "/brand/kbean";

export const metadata: Metadata = {
  metadataBase: process.env.INSSA_OPS_PUBLIC_ORIGIN?.trim()
    ? new URL(getCanonicalPublicOrigin())
    : undefined,
  title,
  description,
  icons: {
    icon: [32, 48, 192, 512].map((size) => ({
      url: `${brandPath}/kbean-icon-${size}.png`,
      sizes: `${size}x${size}`,
      type: "image/png"
    })),
    apple: { url: `${brandPath}/kbean-icon-180.png`, sizes: "180x180", type: "image/png" }
  },
  openGraph: {
    title,
    description,
    type: "website",
    images: [{ url: `${brandPath}/kbean-og.png`, width: 1200, height: 630, alt: "KBean" }]
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: [{ url: `${brandPath}/kbean-og.png`, alt: "KBean" }]
  }
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var t=localStorage.getItem('qa-ops-theme');document.documentElement.dataset.theme=t==='light'?'light':'dark'}catch(e){document.documentElement.dataset.theme='dark'}"
          }}
        />
        {children}
      </body>
    </html>
  );
}
