/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        display: ['"Oswald"', "system-ui", "sans-serif"],
        mono: ['"IBM Plex Mono"', "ui-monospace", "SFMono-Regular", "monospace"],
        sans: ['system-ui', '-apple-system', '"PingFang SC"', '"Microsoft YaHei"', '"Noto Sans CJK SC"', '"Noto Sans SC"', "sans-serif"],
      },
      colors: {
        // Call-sheet surface tokens (light: paper, dark: night shoot)
        paper: "hsl(var(--paper))",
        ink: "hsl(var(--ink))",
        rule: "hsl(var(--rule))",
        muted: "hsl(var(--muted))",
        panel: "hsl(var(--panel))",
        // Semantic accents — stable across themes
        stamp: "hsl(var(--stamp))",
        location: "hsl(var(--location))",
        alert: "hsl(var(--alert))",
        // shadcn-compatible aliases kept so untouched pages still resolve
        border: "hsl(var(--rule))",
        background: "hsl(var(--paper))",
        foreground: "hsl(var(--ink))",
        primary: {
          DEFAULT: "hsl(var(--stamp))",
          foreground: "hsl(0 0% 100%)",
        },
      },
      borderRadius: {
        none: "0",
        sm: "2px",
        DEFAULT: "3px",
        md: "4px",
        lg: "5px",
        xl: "6px",
      },
    },
  },
  plugins: [],
};
