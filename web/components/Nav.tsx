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
    { href: "/report", label: "리포트" },
    { href: "/search", label: "검색" },
    { href: "/status", label: "수집 상태" },
  ],
];

/** 관리자에게만 보이는 메뉴 */
const ADMIN_ITEMS = [
  { href: "/review", label: "매칭 검토" },
  { href: "/share", label: "공유 링크" },
];

export default function Nav({
  email,
  isAdmin,
}: {
  email: string | null;
  isAdmin: boolean;
}) {
  const path = usePathname();

  /**
   * 로그인 전에는 메뉴를 감춥니다.
   * 눌러도 어차피 로그인 화면으로 되돌아오므로, 보여줄 이유가 없습니다.
   */
  if (!email) {
    return (
      <header className="sticky top-0 z-30 border-b border-line bg-canvas/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <span className="text-[15px] font-bold tracking-[-0.01em]">
            <span aria-hidden>📚</span> 베스트셀러 트래커
          </span>
          <ThemeToggle />
        </div>
      </header>
    );
  }

  // 관리자에게만 [매칭 검토] 를 붙입니다.
  // 보기 전용 회원에게 보여봐야 눌러도 "권한이 없습니다" 만 뜹니다.
  const groups = isAdmin ? [...GROUPS, ADMIN_ITEMS] : GROUPS;

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
            {groups.map((items, gi) => (
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

          {/*
            로그아웃은 링크가 아니라 버튼입니다.
            링크로 두면 남이 보낸 주소를 눌렀을 때 나도 모르게 로그아웃됩니다.
          */}
          <form action="/auth/signout" method="post" className="shrink-0">
            <button
              type="submit"
              title={email}
              className="rounded-lg px-2.5 py-1.5 text-sm text-ink-soft hover:bg-surface-2 hover:text-ink"
            >
              로그아웃
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
