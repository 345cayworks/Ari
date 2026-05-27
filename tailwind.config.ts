import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: {
          DEFAULT: "#0B1220",
          soft: "#1A2238",
        },
        sand: {
          DEFAULT: "#F7F4EE",
          warm: "#EFE7D8",
        },
        sea: {
          DEFAULT: "#0F6E8A",
          deep: "#0A4D63",
          mist: "#DCEBEF",
        },
        accent: {
          DEFAULT: "#E9A23B",
          deep: "#C5821E",
        },
      },
      fontFamily: {
        sans: [
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Inter",
          "sans-serif",
        ],
      },
      boxShadow: {
        card: "0 1px 2px rgba(11,18,32,0.04), 0 4px 16px rgba(11,18,32,0.06)",
      },
    },
  },
  plugins: [],
};

export default config;
