import type { Config } from "tailwindcss";

/**
 * Golf OS design tokens. Tailwind v4 loads this file via `@config` in
 * src/app/globals.css; shadcn/ui semantic colours (background, primary, …)
 * are CSS variables defined there and mapped onto this palette.
 */
const config = {
  content: ["./src/**/*.{ts,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        pine: {
          50: "#EEF4F0",
          100: "#D5E3DA",
          200: "#A9C6B3",
          300: "#76A189",
          400: "#4A7A60",
          500: "#2C5A42",
          600: "#1C4330",
          700: "#133626",
          800: "#0B2B1E",
          900: "#071D14",
          950: "#04110C",
          DEFAULT: "#0B2B1E",
        },
        alabaster: {
          50: "#FDFCFA",
          100: "#F7F5F0",
          200: "#EFEBE2",
          300: "#E2DCCF",
          400: "#CFC6B4",
          DEFAULT: "#F7F5F0",
        },
        brass: {
          100: "#F4ECDB",
          200: "#E8D8B5",
          300: "#DBC28C",
          400: "#CFAE6E",
          500: "#C5A059",
          600: "#A88540",
          700: "#866932",
          800: "#5F4A24",
          DEFAULT: "#C5A059",
        },
        ink: {
          DEFAULT: "#1A1F1C",
          muted: "#5B625D",
          faint: "#8C928D",
        },
        score: {
          eagle: "#866932",
          birdie: "#2C5A42",
          par: "#1A1F1C",
          bogey: "#8C5A3C",
          double: "#7A2E2A",
        },
      },
      fontFamily: {
        display: ["var(--font-display)", "Georgia", "serif"],
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      fontSize: {
        eyebrow: ["0.6875rem", { lineHeight: "1rem", letterSpacing: "0.22em" }],
        "display-sm": ["2.25rem", { lineHeight: "2.5rem", letterSpacing: "-0.01em" }],
        "display-md": ["3rem", { lineHeight: "3.25rem", letterSpacing: "-0.015em" }],
        "display-lg": ["4.5rem", { lineHeight: "4.75rem", letterSpacing: "-0.02em" }],
      },
      borderRadius: {
        card: "0.375rem",
      },
      boxShadow: {
        hairline: "inset 0 0 0 1px rgb(11 43 30 / 0.08)",
        card: "0 1px 2px rgb(11 43 30 / 0.04), 0 8px 24px -12px rgb(11 43 30 / 0.18)",
        brass: "inset 0 -1px 0 0 #C5A059",
      },
      transitionTimingFunction: {
        quiet: "cubic-bezier(0.22, 1, 0.36, 1)",
      },
      keyframes: {
        "fade-up": {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "hold-drain": {
          from: { transform: "scaleX(1)" },
          to: { transform: "scaleX(0)" },
        },
      },
      animation: {
        "fade-up": "fade-up 600ms cubic-bezier(0.22, 1, 0.36, 1) both",
        "hold-drain": "hold-drain var(--hold-duration, 420s) linear forwards",
      },
    },
  },
} satisfies Config;

export default config;
