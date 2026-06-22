/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        sidebar: {
          bg: '#f7f6f3',
          hover: '#ebebea',
          active: '#e3e2e0',
          border: '#e9e9e7',
          text: '#37352f',
          muted: '#9b9a97',
        },
        notion: {
          bg: '#ffffff',
          text: '#37352f',
          muted: '#9b9a97',
          hover: '#f7f6f3',
        },
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Helvetica', 'Arial', 'sans-serif'],
      },
    },
  },
  plugins: [],
}

