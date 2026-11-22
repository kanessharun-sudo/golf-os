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
          // Remapped 2026-11-22 to the Quiet Heritage system (CLAUDE.md): an espresso
          // ink ramp. No green anywhere in the chrome. The name stays to avoid churn.
          50: "#EFEAE0",
          100: "#E0D9CB",
          200: "#C9C0AF",
          300: "#A39A8B",
          400: "#7A7368",
          500: "#5C574F",
          600: "#3E3A35",
          700: "#2A2724",
          800: "#181614",
          900: "#11100E",
          950: "#0A0908",
          DEFAULT: "#181614",
        },
        alabaster: {
          50: "#FAF8F3",
          100: "#F5F1E8",
          200: "#EBE5D8",
          300: "#D6CEBF",
          400: "#C4BAA8",
          DEFAULT: "#F5F1E8",
        },
        brass: {
          // Burnished terracotta, the single accent: primary actions and selected tee slots.
          100: "#F6E8DF",
          200: "#EBCDB9",
          300: "#D9A585",
          400: "#C47A52",
          500: "#B05E36",
          600: "#974E2C",
          700: "#7C4024",
          800: "#5E301B",
          DEFAULT: "#B05E36",
        },
        ink: {
          DEFAULT: "#181614",
          muted: "#5C574F",
          faint: "#8A8378",
        },
        score: {
          eagle: "#7C4024",
          birdie: "#B05E36",
          par: "#181614",
          bogey: "#5C574F",
          double: "#3E3A35",
        },
      },
      fontFamily: {
        display: ["var(--font-display)", "Georgia", "serif"],
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        // JetBrains Mono has no ₹ glyph; the sans face supplies it.
        mono: ["var(--font-mono)", "var(--font-sans)", "ui-monospace", "monospace"],
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
        hairline: "inset 0 0 0 1px rgb(24 22 20 / 0.08)",
        card: "0 1px 2px rgb(24 22 20 / 0.04), 0 8px 24px -12px rgb(24 22 20 / 0.18)",
        brass: "inset 0 -1px 0 0 #B05E36",
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
