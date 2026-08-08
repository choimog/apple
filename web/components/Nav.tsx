"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * 위쪽 메뉴.
 *
 * 【두 덩어리로 나눈 이유 — 2026-08-08 대표님 지적】
 * "종합과 세부 분야에 대한 구분이 잘 안 된다."
 *   순위 = 무엇이 잘 팔리나 (종합 / 서점별)
 *   분석 = 누가·어느 분야가 잘 하나 (출판사 / 저자 / 분야)
 *
 * 지금 보고 있는 메뉴에 밑줄이 들어갑니다. 예전에는 어디에 있는지
 * 알 수 있는 표시가 전혀 없었습니다.
 */

const GROUPS = [
  {
    label: "순위",
    items: [
      { href: "/best", label: "종합" },
      { href: "/store", label: "서점별" },
    ],
  },
  {
    label: "분석",
    items: [
      { href: "/publishers", label: "출판사" },
      { href: "/authors", label: "저자" },
      { href: "/insights", label: "분야" },
    ],
  },
  {
    label: "",
    items: [
      { href: "/search", label: "검색" },
      { href: "/status", label: "수집 상태" },
    ],
  },
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
        <div className="flex h-14 items-center gap-5">
          <Link
            href="/"
            className={`shrink-0 text-[15px] font-bold tracking-[-0.01em] ${
              path === "/" ? "text-ink" : "text-ink-soft hover:text-ink"
            }`}
          >
            <span aria-hidden>📚</span> 베스트셀러 트래커
          </Link>

          <nav aria-label="주요 메뉴" className="scroll-x -mb-px flex items-stretch gap-4">
            {GROUPS.map((g, gi) => (
              <div key={gi} className="flex items-stretch gap-3">
                {gi > 0 && (
                  <span aria-hidden className="my-3.5 w-px shrink-0 bg-line" />
                )}
                {g.label && (
                  <span className="hidden self-center text-2xs font-semibold uppercase tracking-[0.1em] text-ink-faint sm:inline">
                    {g.label}
                  </span>
                )}
                {g.items.map((it) => {
                  const on = isOn(it.href);
                  return (
                    <Link
                      key={it.href}
                      href={it.href}
                      aria-current={on ? "page" : undefined}
                      className={`flex items-center whitespace-nowrap border-b-2 px-0.5 text-sm transition-colors ${
                        on
                          ? "border-accent font-semibold text-ink"
                          : "border-transparent text-ink-soft hover:text-ink"
                      }`}
                    >
                      {it.label}
                    </Link>
                  );
                })}
              </div>
            ))}
          </nav>
        </div>
      </div>
    </header>
  );
}
