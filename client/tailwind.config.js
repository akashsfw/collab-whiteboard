/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        canvas: '#1e1e2e',
        surface: '#2a2a3e',
        accent: '#7c6af7',
        'accent-hover': '#6457d4',
        muted: '#a0a0bf',
      },
    },
  },
  plugins: [],
};
