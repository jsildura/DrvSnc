/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/web/**/*.{js,ts,jsx,tsx}',
    './src/components/**/*.{js,ts,jsx,tsx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Roboto', 'sans-serif'],
      },
      colors: {
        slate: {
          50: '#f9f9fb',
          100: '#f1f1f5',
          200: '#e2e2ea',
          300: '#c8c8d2',
          400: '#a9a9b4',
          500: '#898994',
          600: '#6c6c75',
          700: '#565660',
          800: '#43434a',
          900: '#343439',
          950: '#252527',
        },
        accent: {
          DEFAULT: 'var(--color-accent, #4f46e5)',
          hover: 'var(--color-accent-hover, #4338ca)',
          active: 'var(--color-accent-active, #3730a3)',
          contrast: 'var(--color-accent-contrast, #ffffff)',
          on: 'var(--color-accent-on, #ffffff)',
          light: 'var(--color-accent-light, rgba(79, 70, 229, 0.12))',
          dark: 'var(--color-accent-dark, rgba(79, 70, 229, 0.28))',
          text: 'var(--color-accent-text, #4f46e5)',
          textDark: 'var(--color-accent-text-dark, #818cf8)',
          border: 'var(--color-accent-border, rgba(99, 102, 241, 0.35))',
          ring: 'var(--color-accent-ring, rgba(79, 70, 229, 0.45))',
        },
      },
    },
  },
  plugins: [],
};
