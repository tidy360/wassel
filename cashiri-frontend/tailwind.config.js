/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // "Nile teal" — deep, trustworthy, ledger-like. Not the generic SaaS blue/violet.
        nile: { 50: "#EAF3F2", 100: "#CFE4E2", 300: "#7FB3AE", 500: "#0E5F5A", 700: "#0A4642", 900: "#062E2B" },
        // Warm gold accent — market/currency association, used sparingly (one accent, per design guidance).
        gold: { 400: "#E8B23A", 500: "#D99E1F", 600: "#B77F14" },
        paper: "#FAF7F2",
        ink: "#1C231F",
        danger: "#C1432B",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        arabic: ["Tajawal", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
