import type { Config } from "tailwindcss";

const cssRgb = (name: string) => `rgb(var(${name}) / <alpha-value>)`;

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        surface: "var(--surface)",
        "surface-secondary": "var(--surface-secondary)",
        sidebar: "var(--sidebar)",
        card: "var(--card)",
        border: "var(--border)",
        "text-primary": "var(--text-primary)",
        "text-secondary": "var(--text-secondary)",
        "text-muted": "var(--text-muted)",
        canvas: cssRgb("--color-canvas"),
        ink: cssRgb("--color-ink"),
        line: cssRgb("--color-line"),
        panel: cssRgb("--color-panel"),
        accent: cssRgb("--color-accent"),
        slow: cssRgb("--color-warning"),
        fail: cssRgb("--color-danger"),
        pass: cssRgb("--color-success"),
        muted: cssRgb("--color-muted"),
        black: cssRgb("--color-black"),
        white: cssRgb("--color-white"),
        slate: {
          50: cssRgb("--color-slate-50"),
          100: cssRgb("--color-slate-100"),
          200: cssRgb("--color-slate-200"),
          300: cssRgb("--color-slate-300"),
          400: cssRgb("--color-slate-400"),
          500: cssRgb("--color-slate-500"),
          600: cssRgb("--color-slate-600"),
          700: cssRgb("--color-slate-700"),
          800: cssRgb("--color-slate-800"),
          900: cssRgb("--color-slate-900"),
          950: cssRgb("--color-slate-950")
        },
        cyan: {
          100: cssRgb("--color-cyan-100"),
          200: cssRgb("--color-cyan-200"),
          300: cssRgb("--color-cyan-300"),
          400: cssRgb("--color-cyan-400"),
          950: cssRgb("--color-cyan-950")
        },
        emerald: {
          100: cssRgb("--color-emerald-100"),
          200: cssRgb("--color-emerald-200"),
          300: cssRgb("--color-emerald-300")
        },
        amber: {
          100: cssRgb("--color-amber-100"),
          200: cssRgb("--color-amber-200"),
          300: cssRgb("--color-amber-300"),
          800: cssRgb("--color-amber-800")
        },
        rose: {
          100: cssRgb("--color-rose-100"),
          200: cssRgb("--color-rose-200"),
          300: cssRgb("--color-rose-300")
        },
        stone: {
          200: cssRgb("--color-stone-200"),
          300: cssRgb("--color-stone-300"),
          600: cssRgb("--color-stone-600")
        }
      },
      boxShadow: {
        panel: "var(--shadow-panel)"
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
