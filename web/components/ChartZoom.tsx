/**
 * 그래프 '자세히 보기' — 그림 밑에 붙는 접이식 서랍.
 *
 * 【2026-08-18 대표님 요청】
 *   "그래프의 경우, 지금보다 더 자세하게 볼 수 있는 버튼을
 *    각 그래프마다 도서 페이지에서 하나씩 추가해줄래?"
 *
 * 【'자세히' 를 무엇으로 잡았나】
 * 처음엔 '더 긴 기간' 을 생각했는데, 그건 지금 할 수 있는 일이 아닙니다.
 * 데이터베이스에는 최근 14일치만 있고 그 앞은 보관 파일로 빠져 있어서,
 * 30일짜리 그래프가 이미 **있는 것을 전부** 그리고 있습니다.
 * 기간을 늘리는 버튼을 달면 눌러도 아무것도 안 늘어납니다.
 *
 * 그래서 이렇게 잡았습니다.
 *   ① 세로를 두 배 가까이 늘립니다 — 3위와 5위처럼 붙은 값이 갈라집니다
 *   ② 눈금을 5칸 → 9칸, 날짜를 3개 → 7개로 늘립니다
 *   ③ 🚨 **숫자를 표로 그대로 보여줍니다** — 그림은 어림이지만 표는 값입니다
 *   ④ 전날 대비 등락(▲▼)을 함께 적습니다
 *
 * 【왜 자바스크립트가 없나요?】
 * <details> 는 브라우저가 원래 갖고 있는 접이식 상자입니다. 코드 한 줄
 * 없이 열리고 닫힙니다. 느려지지도 않고, 자바스크립트가 막힌 환경에서도
 * 열립니다. 접혀 있을 때도 안의 내용은 이미 그려져 있어서, 눌렀을 때
 * 기다릴 것이 없습니다.
 */

import { STORE_NAME } from "@/lib/stores";
import TrendChart from "@/components/TrendChart";
import type { HistoryPoint, Period } from "@/lib/queries";
import { dayLabel } from "@/lib/format";

/** 한 날짜에 서점별로 무슨 값이었는지 */
type Row = {
  date: string;
  /** 서점 번호 → { 값, 그 값이 나온 분야 } */
  by: Map<number, { v: number; cat: string }>;
};

function buildRows(
  history: HistoryPoint[],
  period: Period,
  metric: "rank" | "sales"
): { rows: Row[]; stores: number[] } {
  const byDate = new Map<string, Row>();
  const stores = new Set<number>();

  for (const p of history) {
    if (p.period !== period) continue;
    const v = metric === "rank" ? p.rank : p.sales;
    if (v === null || v === undefined) continue;
    stores.add(p.storeId);
    if (!byDate.has(p.date)) byDate.set(p.date, { date: p.date, by: new Map() });
    // 같은 날 같은 서점에 여러 분야가 있으면 더 높은 순위(작은 수)를
    // 씁니다. 판매지수는 어느 분야에서 보든 같은 값이라 상관없습니다.
    const cur = byDate.get(p.date)!.by.get(p.storeId);
    const better =
      cur === undefined || (metric === "rank" ? v < cur.v : v > cur.v);
    if (better) {
      byDate.get(p.date)!.by.set(p.storeId, { v, cat: p.categoryName });
    }
  }

  // 최근 것을 위로 (표는 최신부터 보는 것이 자연스럽습니다)
  const rows = [...byDate.values()].sort((a, b) => (a.date < b.date ? 1 : -1));
  return { rows, stores: [...stores].sort((a, b) => a - b) };
}

/**
 * 전날 대비 등락.
 *
 * ⚠️ '전날' 이 아니라 **그 서점에 값이 있던 바로 앞 날** 과 견줍니다.
 *    순위 밖으로 나갔다 돌아온 책은 중간이 비어 있는데, 그것을 무시하고
 *    바로 앞 줄과 견주면 열흘 전 값과 비교해 놓고 '어제보다' 라고
 *    적게 됩니다.
 */
function delta(
  rows: Row[],
  i: number,
  storeId: number,
  metric: "rank" | "sales"
): { text: string; up: boolean } | null {
  const now = rows[i]?.by.get(storeId);
  if (!now) return null;
  for (let k = i + 1; k < rows.length; k++) {
    const prev = rows[k].by.get(storeId);
    if (!prev) continue;
    const d = now.v - prev.v;
    if (d === 0) return { text: "—", up: false };
    // 순위는 작아지는 것이 오르는 것입니다. 판매지수는 반대입니다.
    const up = metric === "rank" ? d < 0 : d > 0;
    return {
      text: `${up ? "▲" : "▼"}${Math.abs(d).toLocaleString("ko-KR")}`,
      up,
    };
  }
  return null;   // 앞 기록이 없음 = 이번이 처음
}

export default function ChartZoom({
  history,
  period,
  metric,
  storeId,
}: {
  history: HistoryPoint[];
  period: Period;
  metric: "rank" | "sales";
  /** 한 서점만 그리는 그래프면 그 번호 (판매지수 그래프) */
  storeId?: number;
}) {
  const { rows, stores } = buildRows(history, period, metric);
  if (!rows.length) return null;

  const unit = metric === "rank" ? "위" : "";
  const cols = storeId ? [storeId] : stores;
  // 순위는 어느 분야에서 나온 값인지가 중요합니다 (종합 150위 vs 소설 3위).
  // 판매지수는 분야와 상관없는 값이라 안 적습니다.
  const showCat = metric === "rank";

  return (
    <details className="group border-t border-line-soft">
      <summary
        className="flex cursor-pointer list-none items-center justify-between px-4 py-2.5 text-xs font-semibold text-ink-soft transition-colors hover:bg-surface-2 sm:px-5"
      >
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden>🔍</span>
          자세히 보기
          <span className="font-normal text-ink-faint">
            숫자 {rows.length}일치
          </span>
        </span>
        {/* 열려 있으면 화살표가 돕니다 (아이콘 파일 없이 글자만으로) */}
        <span
          aria-hidden
          className="text-ink-faint transition-transform group-open:rotate-180"
        >
          ▾
        </span>
      </summary>

      <div className="border-t border-line-soft bg-surface-2/40">
        {/* ① 크게 그린 그림 */}
        <TrendChart history={history} period={period} metric={metric} tall />

        {/* ② 🚨 숫자 그대로 — 그림은 어림이고 표가 값입니다 */}
        <div className="scroll-x border-t border-line-soft">
          <table className="w-full min-w-[380px] border-collapse text-xs">
            <thead>
              <tr className="border-b border-line-soft text-ink-faint">
                <th className="px-3 py-2 text-left font-medium sm:px-5">날짜</th>
                {cols.map((sid) => (
                  <th key={sid} className="px-3 py-2 text-right font-medium">
                    {STORE_NAME[sid] ?? `서점 ${sid}`}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr
                  key={r.date}
                  className="border-b border-line-soft/60 last:border-0"
                >
                  <td className="whitespace-nowrap px-3 py-1.5 text-ink-soft sm:px-5">
                    {dayLabel(r.date)}
                  </td>
                  {cols.map((sid) => {
                    const cell = r.by.get(sid);
                    const d = delta(rows, i, sid, metric);
                    if (!cell) {
                      return (
                        <td
                          key={sid}
                          className="px-3 py-1.5 text-right text-ink-faint"
                        >
                          {/* 🚨 0 이나 '-' 로 적으면 '그날 0위' 처럼 읽힙니다.
                              값이 없는 것과 값이 낮은 것은 다릅니다. */}
                          <span className="text-2xs">순위 밖</span>
                        </td>
                      );
                    }
                    return (
                      <td key={sid} className="px-3 py-1.5 text-right">
                        <span className="tnum font-semibold">
                          {cell.v.toLocaleString("ko-KR")}
                          {unit}
                        </span>
                        {d && (
                          <span
                            className={`ml-1.5 text-2xs tnum ${
                              d.text === "—"
                                ? "text-ink-faint"
                                : d.up
                                  ? "text-emerald-600 dark:text-emerald-400"
                                  : "text-rose-600 dark:text-rose-400"
                            }`}
                          >
                            {d.text}
                          </span>
                        )}
                        {showCat && (
                          <span className="block text-2xs text-ink-faint">
                            {cell.cat}
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="border-t border-line-soft px-4 py-2.5 text-2xs leading-relaxed text-ink-faint sm:px-5">
          ▲▼ 는 <strong>바로 앞 기록과의 차이</strong>입니다. 중간에 순위
          밖으로 나갔던 날이 있으면 그날을 건너뛰고, 값이 있던 마지막 날과
          견줍니다.
          {showCat && (
            <>
              {" "}
              날짜 아래 회색 글씨는 그 순위가 나온 <strong>분야</strong>입니다.
              분야가 다르면 숫자의 뜻도 다릅니다.
            </>
          )}{" "}
          여기 없는 날짜는 자료가 보관 파일로 빠져 있습니다.
        </p>
      </div>
    </details>
  );
}
