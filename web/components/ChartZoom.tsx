/**
 * 그래프 '숫자로 자세히 보기' — 그림 밑에 붙는 접이식 서랍.
 *
 * 【2026-08-18 대표님 요청】
 *   "그래프의 경우, 지금보다 더 자세하게 볼 수 있는 버튼을
 *    각 그래프마다 도서 페이지에서 하나씩 추가해줄래?"
 *
 * 【2026-08-18 다시 지시 — 그림은 빼기】
 *   "더 최대한 자세하게 풀어주고, 자세히보기를 클릭했을 때,
 *    그래프까지는 보여줄 필요는 없을 것 같아.
 *    말한 것처럼 숫자 정도만 나오면 좋을 것 같아."
 *
 * 맞습니다. 위에 이미 그림이 있는데 밑에 같은 그림을 한 번 더 크게
 * 그리는 건 자리만 먹습니다. **그림이 못 말해 주는 것**만 여기 둡니다.
 *
 * 【그림이 못 말해 주는 것 = 여기서 보여주는 것】
 *   ① 정확한 값       그림은 눈금 사이를 눈으로 어림합니다. 여기는 숫자입니다.
 *   ② 전날 대비 등락  몇 위 올랐는지 그림에서는 셀 수 없습니다.
 *   ③ 어느 분야인지   같은 날 '소설 3위' 이자 '종합 150위' 일 수 있습니다.
 *                     그림은 선 하나라 둘 중 하나만 그립니다.
 *   ④ 요약            최고·최저·평균·연속 며칠째·오른 날/내린 날 수.
 *   ⑤ 없는 날         그림에서 선이 끊긴 것이 '순위 밖' 인지 '수집 실패'
 *                     인지 구분이 안 됩니다. 표에서는 글자로 적습니다.
 *
 * 【왜 자바스크립트가 없나요?】
 * <details> 는 브라우저가 원래 갖고 있는 접이식 상자입니다. 코드 한 줄
 * 없이 열리고 닫힙니다. 사이트가 무거워지지 않고, 접혀 있을 때도 내용은
 * 이미 그려져 있어서 누르면 기다림 없이 바로 열립니다.
 */

import { STORE_NAME } from "@/lib/stores";
import type { HistoryPoint, Period } from "@/lib/queries";
import { dayLabel } from "@/lib/format";

/** 그날 그 서점에서 이 책이 올라 있던 자리 하나 */
type Place = { cat: string; v: number };

/** 그날 그 서점의 값 — 여러 분야에 올라 있으면 전부 들고 있습니다 */
type Cell = { best: number; places: Place[] };

type Row = { date: string; by: Map<number, Cell> };

/** 한 서점의 기간 전체 요약 */
type Stat = {
  storeId: number;
  days: number;
  best: number;
  worst: number;
  avg: number;
  first: { v: number; date: string };
  last: { v: number; date: string };
  ups: number;
  downs: number;
  sames: number;
  /** 최근 수집일부터 몇 번 연속으로 값이 있었나 */
  streak: number;
};

/* ───────────────────────────────────────────── 값 다루기 ── */

/** 순위는 작을수록 좋고, 판매지수는 클수록 좋습니다. */
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
      cell.set(p.storeId, { best: v, places: [{ cat: p.categoryName, v }] });
      continue;
    }
    // 같은 날 같은 서점에 여러 분야가 있으면 **전부** 들고 있다가,
    // 대표값만 더 좋은 쪽으로 올립니다. 그림은 이 대표값을 그립니다.
    cur.places.push({ cat: p.categoryName, v });
    if (isBetter(v, cur.best, metric)) cur.best = v;
  }

  // 최근 것이 위로 (표는 최신부터 보는 것이 자연스럽습니다)
  const rows = [...byDate.values()].sort((a, b) => (a.date < b.date ? 1 : -1));
  for (const r of rows) {
    for (const c of r.by.values()) {
      c.places.sort((a, b) => (isBetter(a.v, b.v, metric) ? -1 : 1));
    }
  }
  return { rows, stores: [...stores].sort((a, b) => a - b) };
}

/**
 * 등락 — **바로 앞 기록과의 차이**입니다.
 *
 * ⚠️ '표에서 바로 윗줄' 이 아닙니다. 순위 밖으로 나갔다 돌아온 책은
 *    중간이 비어 있는데, 그것을 무시하고 윗줄과 견주면 열흘 전 값과
 *    비교해 놓고 '어제보다' 라고 적게 됩니다.
 */
function delta(
  rows: Row[],
  i: number,
  storeId: number,
  metric: "rank" | "sales"
): { text: string; up: boolean; flat: boolean; since: string } | null {
  const now = rows[i]?.by.get(storeId);
  if (!now) return null;
  for (let k = i + 1; k < rows.length; k++) {
    const prev = rows[k].by.get(storeId);
    if (!prev) continue;
    const d = now.best - prev.best;
    if (d === 0) return { text: "그대로", up: false, flat: true, since: rows[k].date };
    const up = isBetter(now.best, prev.best, metric);
    return {
      text: `${up ? "▲" : "▼"}${Math.abs(d).toLocaleString("ko-KR")}`,
      up,
      flat: false,
      since: rows[k].date,
    };
  }
  return null; // 앞 기록이 없음 = 이번이 처음
}

function statOf(rows: Row[], storeId: number, metric: "rank" | "sales"): Stat | null {
  const seen = rows
    .map((r) => ({ date: r.date, cell: r.by.get(storeId) }))
    .filter((e): e is { date: string; cell: Cell } => !!e.cell);
  if (!seen.length) return null;

  const vals = seen.map((e) => e.cell.best);
  let best = vals[0];
  let worst = vals[0];
  for (const v of vals) {
    if (isBetter(v, best, metric)) best = v;
    if (isBetter(worst, v, metric)) worst = v;
  }

  // seen 은 최신이 앞입니다. 오래된 순으로 훑으며 오르내림을 셉니다.
  let ups = 0;
  let downs = 0;
  let sames = 0;
  for (let i = seen.length - 2; i >= 0; i--) {
    const d = seen[i].cell.best - seen[i + 1].cell.best;
    if (d === 0) sames++;
    else if (isBetter(seen[i].cell.best, seen[i + 1].cell.best, metric)) ups++;
    else downs++;
  }

  // 최근 수집일부터 몇 번 연속으로 값이 있었나.
  // ⚠️ '며칠' 이 아니라 '몇 번' 입니다. 수집이 안 된 날은 애초에
  //    rows 에 없으므로, 그 날을 끊긴 것으로 세면 안 됩니다.
  let streak = 0;
  for (const r of rows) {
    if (!r.by.has(storeId)) break;
    streak++;
  }

  return {
    storeId,
    days: seen.length,
    best,
    worst,
    avg: vals.reduce((a, b) => a + b, 0) / vals.length,
    first: { v: seen[seen.length - 1].cell.best, date: seen[seen.length - 1].date },
    last: { v: seen[0].cell.best, date: seen[0].date },
    ups,
    downs,
    sames,
    streak,
  };
}

/* ───────────────────────────────────────────── 화면 ── */

function Delta({
  d,
  metric,
}: {
  d: { text: string; up: boolean; flat: boolean } | null;
  metric: "rank" | "sales";
}) {
  if (!d) {
    return (
      <span className="text-2xs text-ink-faint" title="이 기간에 처음 나온 기록입니다">
        첫 기록
      </span>
    );
  }
  if (d.flat) return <span className="text-2xs text-ink-faint">그대로</span>;
  return (
    <span
      className={`tnum text-2xs font-medium ${
        d.up
          ? "text-emerald-600 dark:text-emerald-400"
          : "text-rose-600 dark:text-rose-400"
      }`}
      title={
        metric === "rank"
          ? d.up
            ? "앞 기록보다 순위가 올랐습니다"
            : "앞 기록보다 순위가 내렸습니다"
          : d.up
            ? "앞 기록보다 판매지수가 올랐습니다"
            : "앞 기록보다 판매지수가 내렸습니다"
      }
    >
      {d.text}
    </span>
  );
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

  const cols = storeId ? [storeId] : stores;
  const stats = cols
    .map((sid) => statOf(rows, sid, metric))
    .filter((s): s is Stat => s !== null);
  if (!stats.length) return null;

  // 순위는 어느 분야에서 나온 값인지가 중요합니다 (종합 150위 vs 소설 3위).
  // 판매지수는 서점이 책 한 권에 하나씩 매기는 값이라 분야와 무관합니다.
  const showCat = metric === "rank";
  // 🚨 값이 없는 것을 0 이나 '-' 로 적으면 '그날 0위' 처럼 읽힙니다.
  const missing = metric === "rank" ? "순위 밖" : "기록 없음";
  const oldest = rows[rows.length - 1].date;
  const newest = rows[0].date;

  // 기간 전체의 최고 기록 (여러 서점 중 가장 좋은 것)
  let top = stats[0];
  for (const s of stats) if (isBetter(s.best, top.best, metric)) top = s;
  const topDay = rows.find((r) => r.by.get(top.storeId)?.best === top.best);
  const topPlace = topDay?.by
    .get(top.storeId)
    ?.places.find((p) => p.v === top.best);

  return (
    <details className="group border-t border-line-soft">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-2.5 text-xs font-semibold text-ink-soft transition-colors hover:bg-surface-2 sm:px-5">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden>🔍</span>
          숫자로 자세히 보기
          <span className="font-normal text-ink-faint">
            {rows.length}일치 · 정확한 값과 등락
          </span>
        </span>
        <span
          aria-hidden
          className="shrink-0 text-ink-faint transition-transform group-open:rotate-180"
        >
          ▾
        </span>
      </summary>

      <div className="border-t border-line-soft bg-surface-2/40">
        {/* ═══ ① 한눈에 ═══ */}
        <dl className="grid gap-x-4 gap-y-1.5 px-4 py-3 text-xs sm:grid-cols-2 sm:px-5">
          <div className="flex gap-2">
            <dt className="w-16 shrink-0 text-ink-faint">기록된 날</dt>
            <dd className="tnum">
              {rows.length}일
              <span className="ml-1 text-ink-faint">
                ({dayLabel(oldest)} ~ {dayLabel(newest)})
              </span>
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-16 shrink-0 text-ink-faint">
              {metric === "rank" ? "최고 순위" : "최고 지수"}
            </dt>
            <dd>
              <strong className="tnum">{fmt(top.best, metric)}</strong>
              <span className="ml-1 text-ink-faint">
                {STORE_NAME[top.storeId] ?? ""}
                {topDay ? ` · ${dayLabel(topDay.date)}` : ""}
                {showCat && topPlace ? ` · ${topPlace.cat}` : ""}
              </span>
            </dd>
          </div>
          <div className="flex gap-2 sm:col-span-2">
            <dt className="w-16 shrink-0 text-ink-faint">가장 최근</dt>
            <dd className="flex flex-wrap gap-x-3 gap-y-1">
              {cols.map((sid) => {
                const cell = rows[0].by.get(sid);
                return (
                  <span key={sid}>
                    <span className="text-ink-faint">{STORE_NAME[sid] ?? sid} </span>
                    {cell ? (
                      <>
                        <strong className="tnum">{fmt(cell.best, metric)}</strong>{" "}
                        <Delta d={delta(rows, 0, sid, metric)} metric={metric} />
                      </>
                    ) : (
                      <span className="text-ink-faint">{missing}</span>
                    )}
                  </span>
                );
              })}
            </dd>
          </div>
        </dl>

        {/* ═══ ② 서점별 요약 ═══ */}
        <div className="scroll-x border-t border-line-soft">
          <table className="w-full min-w-[520px] border-collapse text-xs">
            <thead>
              <tr className="border-b border-line-soft text-2xs text-ink-faint">
                <th className="px-3 py-1.5 text-left font-medium sm:px-5">서점</th>
                <th className="px-2 py-1.5 text-right font-medium">
                  {metric === "rank" ? "순위권" : "기록"}
                </th>
                <th className="px-2 py-1.5 text-right font-medium">최고</th>
                <th className="px-2 py-1.5 text-right font-medium">최저</th>
                <th className="px-2 py-1.5 text-right font-medium">평균</th>
                <th className="px-2 py-1.5 text-right font-medium">오른 날</th>
                <th className="px-2 py-1.5 text-right font-medium">내린 날</th>
                <th className="px-2 py-1.5 text-right font-medium">연속</th>
                <th className="px-3 py-1.5 text-right font-medium sm:px-5">
                  처음 → 지금
                </th>
              </tr>
            </thead>
            <tbody>
              {stats.map((s) => {
                const move = s.last.v - s.first.v;
                const better = move !== 0 && isBetter(s.last.v, s.first.v, metric);
                return (
                  <tr
                    key={s.storeId}
                    className="border-b border-line-soft/60 last:border-0"
                  >
                    <td className="whitespace-nowrap px-3 py-1.5 font-medium sm:px-5">
                      {STORE_NAME[s.storeId] ?? s.storeId}
                    </td>
                    <td className="tnum px-2 py-1.5 text-right">{s.days}일</td>
                    <td className="tnum px-2 py-1.5 text-right font-semibold">
                      {fmt(s.best, metric)}
                    </td>
                    <td className="tnum px-2 py-1.5 text-right">
                      {fmt(s.worst, metric)}
                    </td>
                    <td className="tnum px-2 py-1.5 text-right">
                      {/* 순위 평균은 소수점 한 자리까지 (반올림하면 다 같아 보입니다) */}
                      {metric === "rank"
                        ? `${s.avg.toFixed(1)}위`
                        : Math.round(s.avg).toLocaleString("ko-KR")}
                    </td>
                    <td className="tnum px-2 py-1.5 text-right text-emerald-600 dark:text-emerald-400">
                      {s.ups || "—"}
                    </td>
                    <td className="tnum px-2 py-1.5 text-right text-rose-600 dark:text-rose-400">
                      {s.downs || "—"}
                    </td>
                    <td
                      className="tnum px-2 py-1.5 text-right"
                      title="가장 최근 수집일부터 몇 번 연속으로 기록이 있었는지"
                    >
                      {s.streak ? `${s.streak}회` : "—"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-right sm:px-5">
                      <span className="tnum text-ink-faint">
                        {fmt(s.first.v, metric)}
                      </span>
                      <span className="mx-1 text-ink-faint">→</span>
                      <span className="tnum font-semibold">{fmt(s.last.v, metric)}</span>
                      {move !== 0 && (
                        <span
                          className={`tnum ml-1 text-2xs font-medium ${
                            better
                              ? "text-emerald-600 dark:text-emerald-400"
                              : "text-rose-600 dark:text-rose-400"
                          }`}
                        >
                          {better ? "▲" : "▼"}
                          {Math.abs(move).toLocaleString("ko-KR")}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* ═══ ③ 날짜별 전부 ═══ */}
        <div className="scroll-x border-t border-line-soft">
          <table className="w-full min-w-[380px] border-collapse text-xs">
            <thead>
              <tr className="border-b border-line-soft text-2xs text-ink-faint">
                <th className="px-3 py-1.5 text-left font-medium sm:px-5">날짜</th>
                {cols.map((sid) => (
                  <th key={sid} className="px-3 py-1.5 text-right font-medium">
                    {STORE_NAME[sid] ?? `서점 ${sid}`}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr
                  key={r.date}
                  className="border-b border-line-soft/60 align-top last:border-0"
                >
                  <td className="whitespace-nowrap px-3 py-1.5 text-ink-soft sm:px-5">
                    {dayLabel(r.date)}
                  </td>
                  {cols.map((sid) => {
                    const cell = r.by.get(sid);
                    if (!cell) {
                      return (
                        <td
                          key={sid}
                          className="px-3 py-1.5 text-right text-2xs text-ink-faint"
                        >
                          {missing}
                        </td>
                      );
                    }
                    return (
                      <td key={sid} className="px-3 py-1.5 text-right">
                        <span className="tnum font-semibold">
                          {fmt(cell.best, metric)}
                        </span>{" "}
                        <Delta d={delta(rows, i, sid, metric)} metric={metric} />
                        {showCat && (
                          <span className="block text-2xs leading-snug text-ink-faint">
                            {/* 여러 분야에 올라 있으면 전부 적습니다.
                                그림은 대표값 하나만 그리기 때문에, 여기가
                                아니면 나머지 분야는 볼 곳이 없습니다. */}
                            {cell.places
                              .map((p) => `${p.cat} ${p.v.toLocaleString("ko-KR")}위`)
                              .join(" · ")}
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

        <div className="space-y-1 border-t border-line-soft px-4 py-2.5 text-2xs leading-relaxed text-ink-faint sm:px-5">
          <p>
            <strong>▲▼</strong> 는 <strong>바로 앞 기록과의 차이</strong>입니다.
            중간에 {missing}이던 날이 있으면 그 날을 건너뛰고, 값이 있던 마지막
            날과 견줍니다.
            {metric === "rank" && " 순위는 숫자가 작아지는 것이 오르는 것입니다."}
          </p>
          {showCat && (
            <p>
              값 아래 회색 글씨는 그 순위가 나온 <strong>분야</strong>입니다. 한
              날에 여러 분야에 올라 있으면 전부 적습니다. 위 그림은 그중 가장
              높은 순위 하나만 그립니다.
            </p>
          )}
          <p>
            <strong>연속</strong>은 가장 최근 수집일부터 몇 번 이어서 기록이
            있었는지입니다. 수집이 안 된 날은 애초에 이 표에 없으므로 끊긴
            것으로 세지 않습니다.
          </p>
          <p>
            여기 없는 날짜는 자료가 <strong>보관 파일</strong>로 빠져 있습니다.
            사이트에는 최근 14일치만 둡니다.
          </p>
        </div>
      </div>
    </details>
  );
}
