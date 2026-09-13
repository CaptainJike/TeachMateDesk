/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eef7ff",
          100: "#d9edff",
          500: "#1a73e8",
          600: "#1557b0",
          700: "#0f3d7a",
        },
      },
    },
  },
  plugins: [],
};
