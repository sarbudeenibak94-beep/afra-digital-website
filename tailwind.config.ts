import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        /* AFRA DIGITAL design tokens */
        bg: "#020617",
        surface: "#0F172A",
        "surface-2": "#0A1628",
        "surface-3": "#060D1A",
        gold: "#D4AF37",
        "gold-bright": "#F0CF5A",
        orange: "#FF6B35",
        "afra-green": "#22C55E",
        /* shadcn/ui compat */
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        "afra-xl": "28px",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "sans-serif"],
      },
      keyframes: {
        "fade-slide": {
          from: { opacity: "0", transform: "translateY(12px)" },
          to: { opacity: "1", transform: "none" },
        },
        "logo-float": {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-14px)" },
        },
        "spotlight-move": {
          "0%": { opacity: "0", transform: "translate(-72%, -62%) rotate(0deg)" },
          "100%": { opacity: "1", transform: "translate(-50%, -40%) rotate(0deg)" },
        },
        "card-float": {
          "0%, 100%": { transform: "translateY(0px) rotateX(0deg)" },
          "50%": { transform: "translateY(-8px) rotateX(1deg)" },
        },
      },
      animation: {
        "fade-slide": "fade-slide 0.8s cubic-bezier(0.16,1,0.3,1) both",
        "logo-float": "logo-float 6s ease-in-out infinite",
        "spotlight-move": "spotlight-move 0.6s ease both",
        "card-float": "card-float 4s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
