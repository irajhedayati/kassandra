/** @type {import('tailwindcss').Config} */
// Kassandra brand palette, drawn from the logo's deep navy, electric blue,
// and cyan gradient. Existing blue/slate utility classes inherit the brand
// without requiring one-off colors throughout the component tree.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        blue: {
          50:  '#effbff',
          100: '#d6f6ff',
          200: '#adefff',
          300: '#70e4f8',
          400: '#28cde8',
          500: '#0aa9d1',
          600: '#087fb8',
          700: '#075f9e',
          800: '#084a7d',
          900: '#073866',
          950: '#03244d',
        },
        cyan: {
          50:  '#edfeff',
          100: '#cffbff',
          200: '#a4f6fc',
          300: '#65edf5',
          400: '#20d8e5',
          500: '#06bccd',
          600: '#0797aa',
          700: '#0d7889',
          800: '#12616f',
          900: '#134f5c',
          950: '#05343f',
        },
        slate: {
          50:  '#f7fafc',
          100: '#edf4f8',
          200: '#dce8f0',
          300: '#bdceda',
          400: '#8ba3b5',
          500: '#627b90',
          600: '#465f75',
          700: '#30475c',
          800: '#1b3248',
          900: '#0d243a',
          950: '#06182c',
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
