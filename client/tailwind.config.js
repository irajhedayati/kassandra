/** @type {import('tailwindcss').Config} */
// The Kassandra brand palette (blue, cyan, slate, green, red) lives in
// src/index.css as @theme variables so the dark theme can override it.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          'Inter',
          'ui-sans-serif',
          'system-ui',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
      },
      borderRadius: {
        // TailAdmin cards use a soft ~12px corner.
        DEFAULT: '0.5rem',
        lg: '0.75rem',
        xl: '1rem',
      },
      boxShadow: {
        card: '0 1px 3px 0 rgba(3, 36, 77, 0.08), 0 1px 2px 0 rgba(3, 36, 77, 0.05)',
      },
    },
  },
  plugins: [],
};
