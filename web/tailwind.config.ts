import type { Config } from "tailwindcss";

/**
 * 색을 이름으로 씁니다.
 *
 * 화면 코드에는 `bg-surface`, `text-ink` 처럼 '역할' 만 적고,
 * 실제 색값은 globals.css 의 한 곳에만 둡니다.
 * 그래서 밝은 화면/어두운 화면 전환이 저절로 됩니다.
 */
export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "var(--canvas)",
        surface: "var(--surface)",
        "surface-2": "var(--surface-2)",
        line: "var(--line)",
        "line-soft": "var(--line-soft)",
        ink: "var(--ink)",
        "ink-soft": "var(--ink-soft)",
        "ink-faint": "var(--ink-faint)",
        accent: "var(--accent)",
        "accent-soft": "var(--accent-soft)",
        "accent-ink": "var(--accent-ink)",
        daily: "var(--daily)",
        "daily-soft": "var(--daily-soft)",
        weekly: "var(--weekly)",
        "weekly-soft": "var(--weekly-soft)",
        kyobo: "var(--store-kyobo)",
        yes24: "var(--store-yes24)",
        aladin: "var(--store-aladin)",
      },
      borderRadius: { xl: "0.75rem", "2xl": "1rem" },
      boxShadow: {
        card: "0 1px 2px var(--shadow-1)",
        lift: "0 4px 16px -4px var(--shadow-2)",
      },
      fontSize: {
        "2xs": ["0.6875rem", { lineHeight: "1rem" }],
      },
    },
  },
  plugins: [],
} satisfies Config;
