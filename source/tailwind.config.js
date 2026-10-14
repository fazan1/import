/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        teal: { 50: '#fdf1ec', 100: '#fbe0d5', 200: '#f6bfa9', 300: '#f09a78', 400: '#ec7a4f', 500: '#e8552a', 600: '#cf4a22', 700: '#a83a1b', 800: '#812d16', 900: '#5a1f10' },
        navy: { 50: '#eef2f8', 100: '#d5deec', 200: '#aebfd9', 300: '#7f98bd', 400: '#4f6f9c', 500: '#2d4f7c', 600: '#1c3a66', 700: '#15305a', 800: '#0f2340', 900: '#0a1830' },
      },
      fontFamily: { sans: ['"IBM Plex Sans"', '"Segoe UI"', 'system-ui', '-apple-system', 'sans-serif'], mono: ['"IBM Plex Mono"', 'Consolas', '"SF Mono"', 'Menlo', 'monospace'] },
      gridTemplateColumns: {
        '16': 'repeat(16, minmax(0, 1fr))',
      },
    },
  },
  plugins: [],
};
