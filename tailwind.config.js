/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            fontFamily: {
                display: ['DM Sans', 'system-ui', '-apple-system', 'sans-serif'],
                body: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
                mono: ['JetBrains Mono', 'Fira Code', 'SF Mono', 'monospace'],
            },
            fontSize: {
                'xs': '0.75rem',       // 12px - micro labels, buttons
                'sm': '0.75rem',       // 12px - small labels
                'base': '0.875rem',    // 14px - body text
                'lg': '1.125rem',      // 18px - large text
                'xl': '1.25rem',       // 20px - section headers
                '2xl': '1.5rem',       // 24px - card titles
                '3xl': '2rem',         // 32px - page titles
                'timer': '4rem',       // 64px - timer display
            },
            letterSpacing: {
                'tighter': '-0.03em',
                'tight': '-0.02em',
                'normal': '0',
                'wide': '0.05em',
                'wider': '0.1em',
            },
        },
    },
    plugins: [],
}
