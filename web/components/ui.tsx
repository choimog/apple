/**
 * 화면 곳곳에서 쓰는 기본 조각들.
 *
 * 여기 모아 둔 이유: 같은 모양을 페이지마다 따로 만들면 조금씩 달라져서
 * "누더기" 처럼 보입니다. 한 곳에서 만들어 돌려 씁니다.
 */

import Link from "next/link";
import type { ReactNode } from "react";

/* ------------------------------------------------------------------ 카드 */

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] ${className}`}
    >
      {children}
    </section>
  );
}

export function CardHead({
  title,
  desc,
  right,
}: {
  title: ReactNode;
  desc?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-4 py-3 sm:px-5">
      <div className="min-w-0">
        <h2 className="text-[15px] font-bold tracking-tight">{title}</h2>
        {desc && <p className="mt-0.5 text-xs text-slate-500">{desc}</p>}
      </div>
      {right}
    </div>
  );
}

/* ----------------------------------------------------------- 기간 고르기 */

/**
 * 일간 / 주간.
 *
 * 【크게 만든 이유 — 2026-08-08 대표님 지적】
 * "주간과 일간 구분도 약하고".
 * 작은 알약 두 개로는 지금 뭘 보고 있는지 눈에 안 들어옵니다.
 * 그래서 큼직한 두 칸으로 만들고, 고른 쪽에 설명까지 붙였습니다.
 */
export function PeriodSwitch({
  period,
  hrefFor,
}: {
  period: "daily" | "weekly";
  hrefFor: (p: "daily" | "weekly") => string;
}) {
  const items = [
    { key: "daily" as const, label: "일간", sub: "어제 하루" },
    { key: "weekly" as const, label: "주간", sub: "최근 7일 누적" },
  ];
  return (
    <div
      className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1"
      role="group"
      aria-label="집계 기간"
    >
      {items.map((it) => {
        const on = it.key === period;
        return (
          <Link
            key={it.key}
            href={hrefFor(it.key)}
            aria-current={on ? "true" : undefined}
            className={`rounded-md px-4 py-1.5 text-center transition-colors ${
              on
                ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200"
                : "text-slate-500 hover:text-slate-800"
            }`}
          >
            <span className="block text-sm font-bold">{it.label}</span>
            <span
              className={`block text-[11px] ${on ? "text-slate-500" : "text-slate-400"}`}
            >
              {it.sub}
            </span>
          </Link>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ 알약 */

export function Pill({
  href,
  active,
  title,
  children,
}: {
  href: string;
  active: boolean;
  title?: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      title={title}
      aria-current={active ? "true" : undefined}
      className={`rounded-full border px-3 py-1 text-xs transition-colors ${
        active
          ? "border-slate-900 bg-slate-900 font-medium text-white"
          : "border-slate-200 bg-white text-slate-600 hover:border-slate-400 hover:text-slate-900"
      }`}
    >
      {children}
    </Link>
  );
}

export function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
      {children}
    </h3>
  );
}

/* -------------------------------------------------------------- 순위 배지 */

/** 1~3위는 눈에 띄게, 나머지는 담백하게 */
export function RankBadge({ rank, size = "md" }: { rank: number; size?: "sm" | "md" }) {
  const medal =
    rank === 1
      ? "bg-amber-100 text-amber-900 ring-amber-200"
      : rank === 2
        ? "bg-slate-200 text-slate-700 ring-slate-300"
        : rank === 3
          ? "bg-orange-100 text-orange-900 ring-orange-200"
          : "bg-white text-slate-700 ring-slate-200";
  return (
    <span
      className={`inline-flex items-center justify-center rounded-lg ring-1 tabular-nums ${medal} ${
        size === "sm" ? "h-6 min-w-[1.5rem] px-1 text-xs" : "h-8 min-w-[2rem] px-1.5 text-sm"
      } font-bold`}
    >
      {rank}
    </span>
  );
}

/* ------------------------------------------------------------- 통계 타일 */

export function StatTile({
  label,
  value,
  unit,
  hint,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3" title={hint}>
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className="text-xl font-bold tabular-nums tracking-tight">{value}</span>
        {unit && <span className="text-xs text-slate-500">{unit}</span>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ 가로 막대 */

/**
 * 크기를 비교해 보여주는 가로 막대 목록.
 *
 * 파이 차트를 쓰지 않은 이유: 항목이 10개가 넘고, 한 책이 여러 분야에
 * 걸치기 때문에 합이 100%가 아닙니다. 파이로 그리면 거짓말이 됩니다.
 * 막대는 '몇 권' 을 그대로 보여주므로 정직합니다.
 */
export function BarList({
  items,
  max,
  hrefFor,
}: {
  items: { key: string; label: string; value: number; note?: string }[];
  max?: number;
  hrefFor?: (key: string) => string;
}) {
  const top = max ?? Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className="divide-y divide-slate-100">
      {items.map((it) => {
        const pct = Math.max(2, Math.round((it.value / top) * 100));
        const body = (
          <>
            <div className="flex items-baseline justify-between gap-3">
              <span className="truncate text-sm font-medium text-slate-800">
                {it.label}
              </span>
              <span className="shrink-0 text-sm font-bold tabular-nums text-slate-900">
                {it.value.toLocaleString()}
                {it.note && (
                  <span className="ml-1 text-xs font-normal text-slate-400">
                    {it.note}
                  </span>
                )}
              </span>
            </div>
            <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-blue-600"
                style={{ width: `${pct}%` }}
              />
            </div>
          </>
        );
        return (
          <li key={it.key} className="px-4 py-2.5 sm:px-5">
            {hrefFor ? (
              <Link href={hrefFor(it.key)} className="block hover:opacity-80">
                {body}
              </Link>
            ) : (
              body
            )}
          </li>
        );
      })}
    </ul>
  );
}

/* --------------------------------------------------------------- 빈 상태 */

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="px-4 py-12 text-center text-sm text-slate-500">{children}</div>
  );
}

/** 값이 없을 때 지어내지 않고 그대로 알립니다 */
export function NoValue({ label = "없음" }: { label?: string }) {
  return <span className="text-xs text-slate-400">{label}</span>;
}
