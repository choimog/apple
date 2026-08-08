/**
 * 추이 그래프 (순위 / 판매지수).
 *
 * 【왜 직접 그리나요?】
 * 그래프 라이브러리를 쓰면 사이트가 무거워지고 보안 점검 대상도 늘어납니다.
 * 선 몇 개를 긋는 정도라 SVG 로 직접 그립니다. 외부 코드 0개.
 *
 * 【지키는 것 — 없는 날은 잇지 않습니다】
 * 어떤 날 순위권 밖으로 나갔거나 수집이 실패했으면 그 자리를 비웁니다.
 * 앞뒤를 직선으로 이어 버리면 "그날도 그 정도였다" 는 거짓말이 됩니다.
 */

import { STORE_NAME } from "@/lib/supabase";
import type { HistoryPoint, Period } from "@/lib/queries";

const LINE_COLOR: Record<number, string> = {
  1: "#059669", // 교보문고 — 초록
  2: "#2563eb", // 예스24 — 파랑
  3: "#ea580c", // 알라딘 — 주황
};

const W = 720;
const H = 210;
const PAD = { top: 14, right: 12, bottom: 26, left: 42 };

type Series = { storeId: number; period: Period; points: Map<string, number> };

function buildSeries(
  history: HistoryPoint[],
  period: Period,
  pick: (p: HistoryPoint) => number | null
): Series[] {
  const byStore = new Map<number, Map<string, number>>();
  for (const p of history) {
    if (p.period !== period) continue;
    const v = pick(p);
    if (v === null || v === undefined) continue;
    if (!byStore.has(p.storeId)) byStore.set(p.storeId, new Map());
    byStore.get(p.storeId)!.set(p.date, v);
  }
  return [...byStore.entries()]
    .map(([storeId, points]) => ({ storeId, period, points }))
    .sort((a, b) => a.storeId - b.storeId);
}

export default function TrendChart({
  history,
  period,
  metric,
  days = 30,
}: {
  history: HistoryPoint[];
  period: Period;
  /** 'rank' = 순위(작을수록 위) | 'sales' = 판매지수(클수록 위) */
  metric: "rank" | "sales";
  days?: number;
}) {
  const pick = (p: HistoryPoint) => (metric === "rank" ? p.rank : p.sales);
  const series = buildSeries(history, period, pick);

  const dates = [
    ...new Set(
      history.filter((p) => p.period === period && pick(p) !== null).map((p) => p.date)
    ),
  ]
    .sort()
    .slice(-days);

  if (!dates.length || !series.length) {
    return (
      <p className="px-4 py-8 text-center text-sm text-ink-soft">
        {metric === "rank"
          ? "아직 순위 기록이 없습니다."
          : "판매지수 기록이 없습니다. (교보문고는 판매지수를 제공하지 않습니다)"}
      </p>
    );
  }

  const values = series.flatMap((s) =>
    dates.map((d) => s.points.get(d)).filter((v): v is number => v !== undefined)
  );
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  // 값이 하나뿐이면 위아래로 여유를 줍니다 (0 으로 나누는 것 방지)
  const span = hi - lo || Math.max(1, hi * 0.2);

  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;

  const x = (i: number) =>
    PAD.left + (dates.length === 1 ? innerW / 2 : (i / (dates.length - 1)) * innerW);
  const y = (v: number) => {
    // 순위는 작을수록 좋으므로 위쪽에 그립니다 (축을 뒤집습니다)
    const t = (v - lo) / span;
    return metric === "rank"
      ? PAD.top + t * innerH
      : PAD.top + (1 - t) * innerH;
  };

  const ticks = [lo, lo + span / 2, hi];
  const dateIndex = new Map(dates.map((d, i) => [d, i]));

  return (
    <div className="overflow-x-auto px-2 py-3">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full min-w-[560px]"
        role="img"
        aria-label={metric === "rank" ? "순위 추이 그래프" : "판매지수 추이 그래프"}
      >
        {/* 가로 눈금선 */}
        {ticks.map((t, i) => (
          <g key={i}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={y(t)}
              y2={y(t)}
              stroke="#e2e8f0"
              strokeWidth="1"
            />
            <text
              x={PAD.left - 6}
              y={y(t) + 3}
              textAnchor="end"
              fontSize="10"
              fill="#94a3b8"
            >
              {metric === "rank"
                ? Math.round(t)
                : t >= 10000
                  ? `${Math.round(t / 1000)}k`
                  : Math.round(t)}
            </text>
          </g>
        ))}

        {/* 날짜 (양 끝과 가운데만 — 촘촘하면 못 읽습니다) */}
        {[0, Math.floor((dates.length - 1) / 2), dates.length - 1]
          .filter((i, k, arr) => i >= 0 && arr.indexOf(i) === k)
          .map((i) => (
            <text
              key={i}
              x={x(i)}
              y={H - 8}
              textAnchor={i === 0 ? "start" : i === dates.length - 1 ? "end" : "middle"}
              fontSize="10"
              fill="#94a3b8"
            >
              {dates[i].slice(5)}
            </text>
          ))}

        {/* 서점별 선. 값이 없는 날은 잇지 않습니다. */}
        {series.map((s) => {
          const segments: string[] = [];
          let cur: string[] = [];
          for (const d of dates) {
            const v = s.points.get(d);
            if (v === undefined) {
              if (cur.length) segments.push(cur.join(" "));
              cur = [];
              continue;
            }
            const i = dateIndex.get(d)!;
            cur.push(`${cur.length ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`);
          }
          if (cur.length) segments.push(cur.join(" "));

          return (
            <g key={`${s.storeId}-${s.period}`}>
              {segments.map((d, i) => (
                <path
                  key={i}
                  d={d}
                  fill="none"
                  stroke={LINE_COLOR[s.storeId]}
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ))}
              {dates.map((d) => {
                const v = s.points.get(d);
                if (v === undefined) return null;
                const i = dateIndex.get(d)!;
                return (
                  <circle
                    key={d}
                    cx={x(i)}
                    cy={y(v)}
                    r="2.5"
                    fill={LINE_COLOR[s.storeId]}
                  >
                    <title>
                      {d} · {STORE_NAME[s.storeId]} ·{" "}
                      {metric === "rank" ? `${v}위` : `판매지수 ${v.toLocaleString()}`}
                    </title>
                  </circle>
                );
              })}
            </g>
          );
        })}
      </svg>

      <div className="mt-1 flex flex-wrap items-center gap-3 px-2 text-xs text-ink-soft">
        {series.map((s) => (
          <span key={s.storeId} className="inline-flex items-center gap-1.5">
            <span
              className="inline-block h-2 w-4 rounded-full"
              style={{ backgroundColor: LINE_COLOR[s.storeId] }}
            />
            {STORE_NAME[s.storeId]}
          </span>
        ))}
        <span className="text-ink-faint">
          · 선이 끊긴 곳은 그날 순위권 밖이었거나 수집되지 않았다는 뜻입니다
        </span>
      </div>
    </div>
  );
}
