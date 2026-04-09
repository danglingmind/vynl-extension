import type { Config } from 'tailwindcss'

export default {
  content: ['./src/**/*.{ts,tsx,html}'],
  theme: {
    extend: {
      colors: {
        vynl: {
          50:  '#f0f4ff',
          100: '#e0e9ff',
          500: '#4f6ef7',
          600: '#3b57e8',
          700: '#2d44c8',
          900: '#1a2a7a'
        }
      }
    }
  },
  plugins: []
} satisfies Config
