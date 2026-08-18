import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      borderRadius: {
        lg: "var(--radius)",
        card: "var(--radius-card)",
        frame: "var(--radius-frame)",
        pill: "var(--radius-pill)",
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: { DEFAULT: "hsl(var(--primary))", foreground: "hsl(var(--primary-foreground))" },
        secondary: { DEFAULT: "hsl(var(--secondary))", foreground: "hsl(var(--secondary-foreground))" },
        muted: { DEFAULT: "hsl(var(--muted))", foreground: "hsl(var(--muted-foreground))" },
        accent: { DEFAULT: "hsl(var(--accent))", foreground: "hsl(var(--accent-foreground))" },
        positive: "hsl(var(--positive))",
        negative: "hsl(var(--negative))",
        warning: "hsl(var(--warning))",
        chart: {
          blue: "hsl(var(--chart-blue))",
          purple: "hsl(var(--chart-purple))",
          teal: "hsl(var(--chart-teal))",
          amber: "hsl(var(--chart-amber))",
          coral: "hsl(var(--chart-coral))",
        },
      },
      boxShadow: { soft: "var(--shadow-soft)", float: "var(--shadow-float)" },
      fontFamily: { display: ["var(--font-display)"], sans: ["var(--font-body)"] },
    },
  },
  plugins: [],
} satisfies Config;
