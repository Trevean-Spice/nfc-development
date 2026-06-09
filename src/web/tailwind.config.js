/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx}',
    './components/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        amber: {
          50: '#FAFAF8',
          100: '#F3EBE1',
          200: '#E8D7C3',
          300: '#DCC3A5',
          400: '#D4A574',
          500: '#8B6F47',
          600: '#7A6040',
          700: '#6B5435',
          800: '#5C472D',
          900: '#4D3A25',
        },
      },
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          'Roboto',
          'Oxygen',
          'Ubuntu',
          'Cantarell',
          '"Fira Sans"',
          '"Droid Sans"',
          '"Helvetica Neue"',
          'sans-serif',
        ],
      },
      spacing: {
        '128': '32rem',
        '144': '36rem',
      },
      maxWidth: {
        '4xl': '56rem',
        '6xl': '72rem',
      },
      boxShadow: {
        'sm': '0 1px 2px 0 rgba(139, 111, 71, 0.05)',
        'md': '0 4px 6px -1px rgba(139, 111, 71, 0.1)',
        'lg': '0 10px 15px -3px rgba(139, 111, 71, 0.1)',
        'xl': '0 20px 25px -5px rgba(139, 111, 71, 0.1)',
      },
      animation: {
        'fade-in': 'fadeIn 0.3s ease-in',
        'slide-up': 'slideUp 0.3s ease-out',
      },
      keyframes: {
        fadeIn: {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        slideUp: {
          from: {
            opacity: '0',
            transform: 'translateY(10px)',
          },
          to: {
            opacity: '1',
            transform: 'translateY(0)',
          },
        },
      },
    },
  },
  plugins: [],
};
