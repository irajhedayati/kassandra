/** @type {import('tailwindcss').Config} */
// TailAdmin-flavoured palette.
//
// We REMAP Tailwind's `slate`, `blue`, `green`, `red` to TailAdmin's tones
// so the components we already wrote — which use slate/blue/etc. classes
// throughout — pick up the new look without per-component churn.
//
// Source: the open-source TailAdmin React dashboard design tokens.
//   - brand blue: #3641f5 / #3c50e0 family
//   - cool gray (their `gray-*`): #f9fafb / #f1f5f9 / #e5e7eb / ... / #1d2939
//   - meta-green for success: #12b76a
//   - meta-red for danger: #f04438
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // TailAdmin's "brand" — we project it onto Tailwind `blue` so
        // existing `bg-blue-600 / text-blue-700` classes Just Work.
        blue: {
          50:  '#ecf3ff',
          100: '#dde9ff',
          200: '#c2d6ff',
          300: '#9cb9ff',
          400: '#7592ff',
          500: '#5570f1',
          600: '#3641f5', // brand
          700: '#2a31d8',
          800: '#252dae',
          900: '#252e89',
          950: '#171c50',
        },
        // TailAdmin's "gray" scale — projected onto `slate` for the
        // same reason. Cooler and slightly lighter than Tailwind's
        // default slate.
        slate: {
          50:  '#f9fafb',
          100: '#f2f4f7',
          200: '#e4e7ec',
          300: '#d0d5dd',
          400: '#98a2b3',
          500: '#667085',
          600: '#475467',
          700: '#344054',
          800: '#1d2939',
          900: '#101828',
          950: '#0c111d',
        },
        green: {
          50:  '#ecfdf3',
          100: '#d1fadf',
          200: '#a6f4c5',
          300: '#6ce9a6',
          400: '#32d583',
          500: '#12b76a', // success
          600: '#039855',
          700: '#027a48',
          800: '#05603a',
          900: '#054f31',
          950: '#053321',
        },
        red: {
          50:  '#fef3f2',
          100: '#fee4e2',
          200: '#fecdca',
          300: '#fda29b',
          400: '#f97066',
          500: '#f04438', // danger
          600: '#d92d20',
          700: '#b42318',
          800: '#912018',
          900: '#7a271a',
          950: '#55160c',
        },
      },
      fontFamily: {
        sans: [
          'Inter',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
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
        // Subtle card shadow — TailAdmin uses a very light single-layer drop.
        card: '0 1px 3px 0 rgba(16, 24, 40, 0.06), 0 1px 2px 0 rgba(16, 24, 40, 0.04)',
      },
    },
  },
  plugins: [],
};
