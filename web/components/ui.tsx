/**
 * 화면을 이루는 기본 조각들.
 *
 * 같은 모양을 페이지마다 따로 만들면 조금씩 어긋나서 "누더기" 가 됩니다.
 * 여기서 한 번만 만들고 전부 돌려 씁니다.
 */

import Link from "next/link";
import type { ReactNode } from "react";
import { store, STORE_ORDER, type StoreId } from "@/lib/stores";

/* ═══════════════════════════════════════════════════════════ 페이지 머리 */

/**
 * 모든 화면 맨 위에 붙는 제목 줄.
 *
 * eyebrow(작은 분류 글자)를 반드시 넣게 만들어서, 지금 보고 있는 화면이
 * '순위' 인지 '분석' 인지 항상 드러나게 합니다.
 */
export function PageHead({
  eyebrow,
  title,
  lead,
  right,
}: {
  eyebrow: string;
  title: ReactNode;
  lead?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
      <div className="min-w-0">
        <p className="text-2xs font-semibold uppercase tracking-[0.14em] text-accent">
          {eyebrow}
        </p>
        <h1 className="mt-1 text-[26px] font-bold leading-tight tracking-[-0.02em] sm:text-3xl">
          {title}
        </h1>
        {lead && (
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-soft">{lead}</p>
        )}
      </div>
      {right}
    </div>
  );
}

/**
 * "지금 무엇을 보고 있는가" 를 한 줄로 못박는 띠.
 *
 * 【왜 만들었나요? — 2026-08-08 대표님 지적】
 * "지금 순위도 이게 분야 순위인지, 전체 순위인지도 불분명하고."
 * 순위표만 보면 그 숫자가 무엇 안에서의 순위인지 알 수 없습니다.
 * 그래서 모든 순위 화면 위에 '범위' 를 문장으로 적어 둡니다.
 */
export function ScopeBar({ parts, note }: { parts: ReactNode[]; note?: ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-surface-2 px-4 py-2.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        {parts.map((p, i) => (
          <span key={i} className="flex items-center gap-2">
            {i > 0 && <span className="text-ink-faint">›</span>}
            {p}
          </span>
        ))}
      </div>
      {note && <p className="mt-1 text-xs text-ink-soft">{note}</p>}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════ 카드 */

export function Card({
  children,
  className = "",
  id,
  as: Tag = "section",
}: {
  children: ReactNode;
  className?: string;
  /** 화면 안에서 이 카드로 바로 이동하고 싶을 때 (#report 같은 주소) */
  id?: string;
  as?: "section" | "div" | "article";
}) {
  return (
    <Tag
      id={id}
      className={`rounded-2xl border border-line bg-surface shadow-card ${className}`}
    >
      {children}
    </Tag>
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
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line-soft px-4 py-3.5 sm:px-5">
      <div className="min-w-0">
        <h2 className="text-[15px] font-bold tracking-[-0.01em]">{title}</h2>
        {desc && <p className="mt-0.5 text-xs leading-relaxed text-ink-soft">{desc}</p>}
      </div>
      {right}
    </div>
  );
}

/** 카드 안에서 '전체 보기' 같은 작은 버튼 */
export function GhostLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="shrink-0 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-ink-soft transition-colors hover:border-ink-faint hover:text-ink"
    >
      {children}
    </Link>
  );
}

/* ═════════════════════════════════════════════════════════ 기간 고르기 */

export function PeriodSwitch({
  period,
  hrefFor,
  size = "md",
}: {
  period: "daily" | "weekly";
  hrefFor: (p: "daily" | "weekly") => string;
  size?: "sm" | "md";
}) {
  const items = [
    { key: "daily" as const, label: "일간", sub: "어제 하루" },
    { key: "weekly" as const, label: "주간", sub: "최근 7일 누적" },
  ];
  return (
    <div
      className="inline-flex rounded-xl border border-line bg-surface-2 p-1"
      role="group"
      aria-label="집계 기간 고르기"
    >
      {items.map((it) => {
        const on = it.key === period;
        return (
          <Link
            key={it.key}
            href={hrefFor(it.key)}
            aria-current={on ? "true" : undefined}
            className={`rounded-lg text-center transition-colors ${
              size === "sm" ? "px-3 py-1" : "px-4 py-1.5"
            } ${
              on
                ? it.key === "weekly"
                  ? "bg-surface text-weekly shadow-card ring-1 ring-line"
                  : "bg-surface text-daily shadow-card ring-1 ring-line"
                : "text-ink-faint hover:text-ink-soft"
            }`}
          >
            <span className="block text-sm font-bold">{it.label}</span>
            {size === "md" && (
              <span className="block text-2xs opacity-70">{it.sub}</span>
            )}
          </Link>
        );
      })}
    </div>
  );
}

/** 일간/주간 배지 — 표·제목 어디에나 붙일 수 있게 */
export function PeriodBadge({
  period,
  withHelp = false,
}: {
  period: "daily" | "weekly";
  withHelp?: boolean;
}) {
  const weekly = period === "weekly";
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-0.5 text-2xs font-semibold ${
        weekly ? "bg-weekly-soft text-weekly" : "bg-daily-soft text-daily"
      }`}
    >
      {weekly ? "주간" : "일간"}
      {withHelp && (
        <span className="font-normal opacity-80">
          · {weekly ? "최근 7일 누적" : "어제 하루"}
        </span>
      )}
    </span>
  );
}

/* ═══════════════════════════════════════════════════════════════ 고르기 */

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
          ? "border-transparent bg-accent font-semibold text-accent-ink"
          : "border-line bg-surface text-ink-soft hover:border-ink-faint hover:text-ink"
      }`}
    >
      {children}
    </Link>
  );
}

export function FieldLabel({
  children,
  hint,
}: {
  children: ReactNode;
  hint?: string;
}) {
  return (
    <h3 className="mb-1.5 flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-[0.1em] text-ink-faint">
      {children}
      {hint && <span className="normal-case tracking-normal opacity-80">{hint}</span>}
    </h3>
  );
}

/* ═══════════════════════════════════════════════════════════════ 순위 배지 */

export function RankBadge({
  rank,
  size = "md",
}: {
  rank: number;
  size?: "sm" | "md";
}) {
  const top =
    rank === 1
      ? "bg-amber-400/15 text-amber-700 ring-amber-400/40 dark:text-amber-300"
      : rank === 2
        ? "bg-slate-400/15 text-ink-soft ring-slate-400/40 dark:text-ink-faint"
        : rank === 3
          ? "bg-orange-400/15 text-orange-700 ring-orange-400/40 dark:text-orange-300"
          : "bg-surface-2 text-ink-soft ring-line";
  return (
    <span
      className={`tnum inline-flex items-center justify-center rounded-lg font-bold ring-1 ${top} ${
        size === "sm" ? "h-6 min-w-[1.75rem] px-1 text-xs" : "h-8 min-w-[2.25rem] px-1.5 text-sm"
      }`}
    >
      {rank}
    </span>
  );
}

/* ═══════════════════════════════════════════════════════════════ 서점 배지 */

export function StoreChip({
  id,
  rank,
  size = "md",
}: {
  id: number;
  rank?: number | null;
  size?: "sm" | "md";
}) {
  const s = store(id);
  const off = rank === null || rank === undefined;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md font-medium ${
        size === "sm" ? "px-1.5 py-0.5 text-2xs" : "px-2 py-1 text-xs"
      } ${off ? "bg-surface-2 text-ink-faint ring-1 ring-line" : s.chip}`}
      title={off ? `${s.name} 순위 밖` : `${s.name} ${rank}위`}
    >
      {s.short}
      {rank !== undefined && (
        <span className="tnum font-bold">{off ? "–" : `${rank}`}</span>
      )}
    </span>
  );
}

/** 3사 순위를 한 줄로 (표·목록에서 자리를 아낄 때) */
export function StoreRankStrip({ ranks }: { ranks: Record<number, number> }) {
  return (
    <span className="flex gap-1">
      {STORE_ORDER.map((sid: StoreId) => (
        <StoreChip key={sid} id={sid} rank={ranks[sid] ?? null} size="sm" />
      ))}
    </span>
  );
}

/* ═══════════════════════════════════════════════════════════════ 통계 타일 */

export function StatTile({
  label,
  value,
  unit,
  hint,
  tone = "plain",
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  hint?: string;
  tone?: "plain" | "accent";
}) {
  return (
    <div
      className={`rounded-xl border px-4 py-3 ${
        tone === "accent"
          ? "border-transparent bg-accent-soft"
          : "border-line bg-surface"
      }`}
      title={hint}
    >
      <div className="text-xs text-ink-soft">{label}</div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className="tnum truncate text-xl font-bold tracking-[-0.02em]">
          {value}
        </span>
        {unit && <span className="shrink-0 text-xs text-ink-soft">{unit}</span>}
      </div>
      {hint && <div className="mt-1 text-2xs leading-snug text-ink-faint">{hint}</div>}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════ 가로 막대 */

export function BarList({
  items,
  hrefFor,
  unit = "",
}: {
  items: { key: string; label: string; value: number; sub?: string }[];
  hrefFor?: (key: string) => string;
  unit?: string;
}) {
  const top = Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className="divide-y divide-line-soft">
      {items.map((it, i) => {
        const pct = Math.max(2, Math.round((it.value / top) * 100));
        const body = (
          <>
            <div className="flex items-baseline justify-between gap-3">
              <span className="flex min-w-0 items-baseline gap-2">
                <span className="tnum w-4 shrink-0 text-2xs text-ink-faint">
                  {i + 1}
                </span>
                <span className="truncate text-sm font-medium">{it.label}</span>
              </span>
              <span className="tnum shrink-0 text-sm font-bold">
                {it.value.toLocaleString()}
                {unit && (
                  <span className="ml-0.5 text-2xs font-normal text-ink-faint">
                    {unit}
                  </span>
                )}
              </span>
            </div>
            {it.sub && (
              <p className="ml-6 mt-0.5 truncate text-2xs text-ink-faint">{it.sub}</p>
            )}
            <div className="ml-6 mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-2">
              <div
                className="h-full rounded-full bg-accent"
                style={{ width: `${pct}%` }}
              />
            </div>
          </>
        );
        return (
          <li key={it.key} className="px-4 py-2.5 sm:px-5">
            {hrefFor ? (
              <Link
                href={hrefFor(it.key)}
                className="block rounded-lg transition-opacity hover:opacity-75"
              >
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

/* ═══════════════════════════════════════════════════════════════ 빈 상태 */

export function Empty({
  title,
  children,
  action,
}: {
  title?: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="px-4 py-14 text-center">
      {title && <p className="text-sm font-semibold text-ink-soft">{title}</p>}
      {children && (
        <div className="mx-auto mt-1.5 max-w-md text-xs leading-relaxed text-ink-faint">
          {children}
        </div>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** 값이 없을 때 — 지어내지 않고 그대로 알립니다 */
export function NoValue({ label = "없음", why }: { label?: string; why?: string }) {
  return (
    <span className="text-xs text-ink-faint" title={why}>
      {label}
    </span>
  );
}

/* ═════════════════════════════════════════════════════════════ 접기 설명 */

export function Explain({
  summary,
  children,
}: {
  summary: string;
  children: ReactNode;
}) {
  return (
    <details className="group rounded-2xl border border-line bg-surface px-4 py-3 sm:px-5">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-sm font-semibold text-ink-soft">
        {summary}
        <span className="text-ink-faint transition-transform group-open:rotate-180">
          ⌄
        </span>
      </summary>
      <div className="mt-2.5 space-y-1.5 text-sm leading-relaxed text-ink-soft">
        {children}
      </div>
    </details>
  );
}
