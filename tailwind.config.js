/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'] },
      colors: {
        brand: { 50: '#ecfdf3', 100: '#d1fadf', 500: '#12b76a', 600: '#039855', 700: '#027a48', 900: '#054f31' }
      }
    }
  },
  plugins: []
}
