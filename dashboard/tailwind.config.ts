import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        canvas: "#f5f1e8",
        ink: "#18161f",
        line: "#d9d1c4",
        panel: "#fffaf1",
        accent: "#d4ff4f",
        slow: "#f0c14b",
        fail: "#ff6b57",
        pass: "#1e9c64",
        muted: "#6d6558"
      },
      boxShadow: {
        panel: "0 18px 40px rgba(24, 22, 31, 0.08)"
      },
      keyframes: {
        pulseLine: {
          "0%, 100%": { opacity: "0.35", transform: "scaleX(0.92)" },
          "50%": { opacity: "1", transform: "scaleX(1)" }
        }
      },
      animation: {
        pulseLine: "pulseLine 1.8s ease-in-out infinite"
      }
    }
  },
  plugins: []
};

export default config;
