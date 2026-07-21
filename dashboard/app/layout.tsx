import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "INSSA QA Operations",
  description: "Operations console for safe INSSA QA campaign runs."
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
