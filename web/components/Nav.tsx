"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import ThemeToggle from "@/components/ThemeToggle";

/**
 * 위쪽 메뉴.
 *
 * 【2026-08-08 대표님 지적】
 * "순위, 분석 표시는 없앨 것, 메뉴는 카테고리마다 더 분명히 구분되도록."
 * 그래서 '순위/분석' 이라는 머리글자를 없애고, 대신 메뉴 하나하나를
 * 알약 모양으로 떼어 놓았습니다. 지금 보고 있는 곳은 색이 채워집니다.
 * 성격이 다른 묶음 사이에는 얇은 세로선만 둡니다.
 */

const GROUPS: { href: string; label: string }[][] = [
  [
    { href: "/best", label: "종합 순위" },
    { href: "/store", label: "서점별 순위" },
  ],
  [
    { href: "/publishers", label: "출판사" },
    { href: "/authors", label: "저자" },
    { href: "/insights", label: "분야" },
  ],
  [
    { href: "/search", label: "검색" },
    { href: "/status", label: "수집 상태" },
  ],
];

export default function Nav() {
  const path = usePathname();

  const isOn = (href: string) => {
    if (href === "/best") return path === "/best";
    if (href === "/store") return path === "/store";
    if (href === "/publishers") return path.startsWith("/publisher");
    if (href === "/authors") return path.startsWith("/author");
    return path.startsWith(href);
  };

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-canvas/85 backdrop-blur-md">
      <div className="mx-auto max-w-6xl px-4">
        <div className="flex h-14 items-center gap-4">
          <Link
            href="/"
            className={`shrink-0 text-[15px] font-bold tracking-[-0.01em] ${
              path === "/" ? "text-ink" : "text-ink-soft hover:text-ink"
            }`}
          >
            <span aria-hidden>📚</span> 베스트셀러 트래커
          </Link>

          <nav aria-label="주요 메뉴" className="scroll-x flex min-w-0 flex-1 items-center gap-2">
            {GROUPS.map((items, gi) => (
              <div key={gi} className="flex items-center gap-1">
                {gi > 0 && <span aria-hidden className="mx-1.5 h-5 w-px shrink-0 bg-line" />}
                {items.map((it) => {
                  const on = isOn(it.href);
                  return (
                    <Link
                      key={it.href}
                      href={it.href}
                      aria-current={on ? "page" : undefined}
                      className={`whitespace-nowrap rounded-lg px-2.5 py-1.5 text-sm transition-colors ${
                        on
                          ? "bg-accent font-semibold text-accent-ink"
                          : "text-ink-soft hover:bg-surface-2 hover:text-ink"
                      }`}
                    >
                      {it.label}
                    </Link>
                  );
                })}
              </div>
            ))}
          </nav>

          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
