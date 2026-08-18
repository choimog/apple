/**
 * 그래프 밑에 붙는 '숫자로 보기' 서랍.
 *
 * 【2026-08-18 대표님 지적】
 *   "'숫자로 자세히 보기' 영역이 지나치게 복잡하게 느껴지고,
 *    글자가 길어서 행이 넘어가서 가독성이 떨어지는 경우도 많아."
 *
 * 맞습니다. 요약 세 덩어리(한눈에 / 서점별 표 / 날짜별 표)를 쌓아 놓아서
 * 정작 보고 싶은 숫자가 파묻혔고, 칸마다 분야 이름을 전부 적어서 줄이
 * 계속 넘어갔습니다.
 *
 * 【남긴 것】 날짜별 표 하나.
 *   · 값과 등락(▲▼)
 *   · 분야는 **대표 하나만**, 그것도 종합이 아닐 때만
 *   · 맨 위에 한 줄 요약 (최고 기록과 기간)
 *
 * 【뺀 것】 서점별 요약표(최고·최저·평균·오른 날·연속·처음→지금).
 *   숫자가 아홉 칸이라 가로로 넘쳤고, 정작 매일 보시는 값은 아니었습니다.
 *   최고 기록만 한 줄로 남깁니다.
 */

import { STORE_NAME } from "@/lib/stores";
import type { HistoryPoint, Period } from "@/lib/queries";
import { dayLabel } from "@/lib/format";

/** 그날 그 서점의 값 (여러 분야에 올라 있으면 가장 좋은 것) */
type Cell = { v: number; cat: string; overall: boolean; more: number };
type Row = { date: string; by: Map<number, Cell> };

/** 순위는 작을수록 좋고, 판매지수는 클수록 좋습니다 */
const isBetter = (a: number, b: number, metric: "rank" | "sales") =>
  metric === "rank" ? a < b : a > b;

const fmt = (v: number, metric: "rank" | "sales") =>
  metric === "rank" ? `${v.toLocaleString("ko-KR")}위` : v.toLocaleString("ko-KR");

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
    const cell = byDate.get(p.date)!.by;
    const cur = cell.get(p.storeId);
    if (!cur) {
      cell.set(p.storeId, {
        v, cat: p.categoryName, overall: p.isOverall, more: 0,
      });
      continue;
    }
    // 같은 날 여러 분야에 올라 있으면 **가장 좋은 하나**만 적고, 나머지는
    // 개수만 셉니다. 이름을 전부 적으면 줄이 계속 넘어갑니다.
    cur.more += 1;
    if (isBetter(v, cur.v, metric)) {
      cur.v = v;
      cur.cat = p.categoryName;
      cur.overall = p.isOverall;
    }
  }

  // 최근 것이 위로
  const rows = [...byDate.values()].sort((a, b) => (a.date < b.date ? 1 : -1));
  return { rows, stores: [...stores].sort((a, b) => a - b) };
}

/**
 * 등락 — **바로 앞 기록**과의 차이입니다.
 *
 * ⚠️ '표의 윗줄' 이 아닙니다. 순위 밖으로 나갔다 돌아온 책은 중간이
 *    비어 있는데, 그것을 무시하고 윗줄과 견주면 열흘 전 값과 비교해
 *    놓고 '어제보다' 라고 적게 됩니다.
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
    if (d === 0) return null;          // 그대로면 아무것도 안 적습니다
    return {
      text: `${isBetter(now.v, prev.v, metric) ? "▲" : "▼"}${Math.abs(d).toLocaleString("ko-KR")}`,
      up: isBetter(now.v, prev.v, metric),
    };
  }
  return null;
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
  /** 한 서점만 그리는 그래프면 그 번호 (판매지수) */
  storeId?: number;
}) {
  const { rows, stores } = buildRows(history, period, metric);
  if (!rows.length) return null;

  const cols = storeId ? [storeId] : stores;
  const showCat = metric === "rank";

  // 기간 전체의 최고 기록 (한 줄 요약용)
  let best: { v: number; store: number; date: string } | null = null;
  for (const r of rows) {
    for (const sid of cols) {
      const c = r.by.get(sid);
      if (!c) continue;
      if (!best || isBetter(c.v, best.v, metric)) {
        best = { v: c.v, store: sid, date: r.date };
      }
    }
  }

  return (
    <details className="group border-t border-line-soft">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-2.5 text-xs font-medium text-ink-soft transition-colors hover:bg-surface-2 sm:px-5">
        <span>숫자로 보기</span>
        <span
          aria-hidden
          className="shrink-0 text-ink-faint transition-transform group-open:rotate-180"
        >
          ▾
        </span>
      </summary>

      <div className="border-t border-line-soft bg-surface-2/40">
        {best && (
          <p className="px-4 pt-2.5 text-2xs text-ink-faint sm:px-5">
            최고 <strong className="tnum text-ink-soft">{fmt(best.v, metric)}</strong>
            {" · "}
            {STORE_NAME[best.store] ?? ""} {dayLabel(best.date)}
            {" · "}
            기록 {rows.length}일
          </p>
        )}

        <div className="scroll-x">
          <table className="w-full min-w-[300px] border-collapse text-xs">
            <thead>
              <tr className="text-2xs text-ink-faint">
                <th className="px-4 py-1.5 text-left font-normal sm:px-5">날짜</th>
                {cols.map((sid) => (
                  <th key={sid} className="px-3 py-1.5 text-right font-normal">
                    {STORE_NAME[sid] ?? sid}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.date} className="border-t border-line-soft/60">
                  <td className="whitespace-nowrap px-4 py-1.5 text-ink-soft sm:px-5">
                    {dayLabel(r.date)}
                  </td>
                  {cols.map((sid) => {
                    const cell = r.by.get(sid);
                    if (!cell) {
                      return (
                        <td key={sid} className="px-3 py-1.5 text-right text-ink-faint">
                          —
                        </td>
                      );
                    }
                    const d = delta(rows, i, sid, metric);
                    return (
                      <td key={sid} className="whitespace-nowrap px-3 py-1.5 text-right">
                        <span className="tnum font-semibold">{fmt(cell.v, metric)}</span>
                        {d && (
                          <span
                            className={`tnum ml-1 text-2xs ${
                              d.up
                                ? "text-emerald-600 dark:text-emerald-400"
                                : "text-rose-600 dark:text-rose-400"
                            }`}
                          >
                            {d.text}
                          </span>
                        )}
                        {/* 분야는 종합이 아닐 때만, 이름 하나만 */}
                        {showCat && !cell.overall && (
                          <span className="block truncate text-2xs text-ink-faint">
                            {cell.cat}
                            {cell.more > 0 && ` 외 ${cell.more}`}
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

        <p className="border-t border-line-soft px-4 py-2 text-2xs text-ink-faint sm:px-5">
          ▲▼ 는 값이 있던 <strong>바로 앞 기록</strong>과의 차이입니다.
          — 는 그날 기록이 없다는 뜻입니다.
        </p>
      </div>
    </details>
  );
}
