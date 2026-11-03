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
        // A system serif stack rather than a web font. Deliberate: the Worker
        // runs at 2.14 MB against a 3 MB ceiling, and a build-time font fetch
        // is a network dependency on a build that fails for other reasons
        // often enough already. Iowan and Palatino render beautifully on
        // Apple devices, Georgia is a respectable floor everywhere else, and
        // all of them cost nothing.
        serif: [
          "Iowan Old Style",
          "Palatino Linotype",
          "Palatino",
          "Georgia",
          "ui-serif",
          "serif",
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
