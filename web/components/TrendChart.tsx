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
 *
 * 【2026-08-08 대표님 지적】
 *   · "판매지수를 k 단위로 쓰지 말 것" → 눈금에 숫자를 그대로 적습니다.
 *   · "그래프에는 명확한 지수를 적어줄 것" → 눈금을 5칸으로 늘리고,
 *     각 선의 마지막 값을 선 옆에 직접 적습니다. 마우스를 올리지 않아도
 *     지금 값이 얼마인지 보입니다.
 */

import { STORE_NAME } from "@/lib/stores";
import type { HistoryPoint, Period } from "@/lib/queries";

const LINE_COLOR: Record<number, string> = {
  1: "#059669", // 교보문고 — 초록
  2: "#2563eb", // 예스24 — 파랑
  3: "#ea580c", // 알라딘 — 주황
};

const W = 480;
const H = 220;
const PAD = { top: 16, right: 54, bottom: 26, left: 54 };

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

/** 눈금 숫자. 줄임말(k) 없이 그대로 적습니다. */
const tickText = (v: number, metric: "rank" | "sales") =>
  metric === "rank" ? String(Math.round(v)) : Math.round(v).toLocaleString("ko-KR");

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
      <p className="px-4 py-10 text-center text-sm text-ink-faint">
        {metric === "rank"
          ? "아직 순위 기록이 없습니다."
          : "판매지수 기록이 없습니다."}
      </p>
    );
  }

  const values = series.flatMap((s) =>
    dates.map((d) => s.points.get(d)).filter((v): v is number => v !== undefined)
  );
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  // 값이 하나뿐이면 위아래로 여유를 줍니다 (0 으로 나누는 것 방지)
  const span = hi - lo || Math.max(1, Math.abs(hi) * 0.2);

  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;

  const x = (i: number) =>
    PAD.left + (dates.length === 1 ? innerW / 2 : (i / (dates.length - 1)) * innerW);
  const y = (v: number) => {
    // 순위는 작을수록 좋으므로 위쪽에 그립니다 (축을 뒤집습니다)
    const t = (v - lo) / span;
    return metric === "rank" ? PAD.top + t * innerH : PAD.top + (1 - t) * innerH;
  };

  // 눈금 5칸 — 값을 눈으로 읽을 수 있을 만큼 촘촘하게
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => lo + span * f);
  const dateIndex = new Map(dates.map((d, i) => [d, i]));

  return (
    <div className="px-2 py-3">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-label={metric === "rank" ? "순위 추이 그래프" : "판매지수 추이 그래프"}
      >
        {/* 가로 눈금선 — 색은 화면 모드를 따라갑니다 */}
        {ticks.map((t, i) => (
          <g key={i}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={y(t)}
              y2={y(t)}
              stroke="var(--line)"
              strokeWidth="1"
            />
            <text
              x={PAD.left - 6}
              y={y(t) + 3}
              textAnchor="end"
              fontSize="9"
              fill="var(--ink-faint)"
            >
              {tickText(t, metric)}
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
              fontSize="9"
              fill="var(--ink-faint)"
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

          // 마지막으로 값이 있던 날 — 그 값을 선 끝에 직접 적습니다
          const lastDate = [...dates].reverse().find((d) => s.points.has(d));
          const lastVal = lastDate ? s.points.get(lastDate)! : null;

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
                  <circle key={d} cx={x(i)} cy={y(v)} r="2.5" fill={LINE_COLOR[s.storeId]}>
                    <title>
                      {d} · {STORE_NAME[s.storeId]} ·{" "}
                      {metric === "rank"
                        ? `${v}위`
                        : `판매지수 ${v.toLocaleString("ko-KR")}`}
                    </title>
                  </circle>
                );
              })}
              {lastDate && lastVal !== null && (
                <text
                  x={x(dateIndex.get(lastDate)!) + 6}
                  y={y(lastVal) + 3}
                  fontSize="10"
                  fontWeight="700"
                  fill={LINE_COLOR[s.storeId]}
                >
                  {metric === "rank"
                    ? `${lastVal}위`
                    : lastVal.toLocaleString("ko-KR")}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 px-2 text-xs text-ink-soft">
        {series.map((s) => (
          <span key={s.storeId} className="inline-flex items-center gap-1.5">
            <span
              className="inline-block h-2 w-4 rounded-full"
              style={{ backgroundColor: LINE_COLOR[s.storeId] }}
            />
            {STORE_NAME[s.storeId]}
          </span>
        ))}
      </div>
    </div>
  );
}
