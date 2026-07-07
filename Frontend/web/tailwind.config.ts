import type { Config } from 'tailwindcss';

/**
 * Tailwind is kept for layout utilities (flex, grid, spacing) only.
 * Colour, type and components come from the ported design system
 * (src/app/design-system.css) via CSS variables — single source of truth,
 * matching the final UI prototype.
 */
export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['Newsreader', 'Georgia', 'serif'],
        body: ['"Hanken Grotesk"', 'system-ui', 'sans-serif'],
      },
      colors: {
        parchment: 'var(--parchment)',
        accent: 'var(--accent)',
      },
    },
  },
  plugins: [],
} satisfies Config;
