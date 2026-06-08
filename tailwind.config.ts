import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["selector", '[data-theme="dark"]'],
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        tg: {
          surface: "rgb(var(--tg-surface) / <alpha-value>)",
          "surface-elevated": "rgb(var(--tg-surface-elevated) / <alpha-value>)",
          border: "rgb(var(--tg-border) / <alpha-value>)",
          "bg-base": "rgb(var(--tg-bg-base) / <alpha-value>)",
          "bg-accent": "rgb(var(--tg-bg-accent) / <alpha-value>)",
        },
        wa: {
          green: "rgb(var(--wa-green) / <alpha-value>)",
          "green-dark": "rgb(var(--wa-green-dark) / <alpha-value>)",
          "green-light": "rgb(var(--wa-green-light) / <alpha-value>)",
          panel: "rgb(var(--wa-panel) / <alpha-value>)",
          "panel-secondary": "rgb(var(--wa-panel-secondary) / <alpha-value>)",
          "chat-bg": "rgb(var(--wa-chat-bg) / <alpha-value>)",
          "bubble-out": "rgb(var(--wa-bubble-out) / <alpha-value>)",
          "bubble-in": "rgb(var(--wa-bubble-in) / <alpha-value>)",
          "input-bg": "rgb(var(--wa-input-bg) / <alpha-value>)",
          "text-primary": "rgb(var(--wa-text-primary) / <alpha-value>)",
          "text-secondary": "rgb(var(--wa-text-secondary) / <alpha-value>)",
          border: "rgb(var(--wa-border) / <alpha-value>)",
        },
      },
      fontFamily: {
        sans: ["var(--font-segoe)", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "system-ui", "sans-serif"],
        tinder: ["var(--font-tinder)", "Nunito", "sans-serif"],
      },
      backdropBlur: {
        glass: "var(--tg-blur)",
      },
      borderRadius: {
        "glass-panel": "1rem",
        "glass-control": "0.75rem",
      },
      boxShadow: {
        glass: "var(--tg-shadow)",
        "glass-lg": "var(--tg-shadow-lg)",
      },
    },
  },
  plugins: [],
};

export default config;
