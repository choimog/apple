import Cover from "@/components/Cover";
import DataError from "@/components/DataError";
import SalesPoint from "@/components/SalesPoint";
import TrendChart from "@/components/TrendChart";
import { configError, STORE_COLOR, STORE_NAME } from "@/lib/supabase";
import {
  getBookDetail,
  PERIOD_HELP,
  PERIOD_LABEL,
  type CurrentPlacement,
  type Period,
} from "@/lib/queries";

export const revalidate = 600;

const STORE_ORDER = [1, 2, 3];
const SALES_STORES = new Set([2, 3]);

export default async function BookPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (configError) {
    return (
      <div className="rounded-lg border border-amber-300 bg-amber-50 p-6 text-sm text-amber-800">
        {configError}
      </div>
    );
  }

  const { id } = await params;
  let detail;
  try {
    detail = await getBookDetail(Number(id));
  } catch (e) {
    return <DataError detail={String(e)} />;
  }
  const { stores, history, placements, latestDate } = detail;

  if (!stores.length) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-600">
        해당 도서를 찾을 수 없습니다.
      </div>
    );
  }

  // 표지 우선순위: 알라딘(3) → 예스24(2) → 교보(1)
  const main =
    [3, 2, 1].map((s) => stores.find((b) => b.store_id === s && b.cover_url)).find(Boolean) ??
    stores[0];

  // 최신 날짜의 대표 순위 (서점 × 기간) — 요약 카드용
  const latest = new Map<string, { rank: number; sales: number | null }>();
  for (const h of history) {
    if (h.date !== latestDate) continue;
    const k = `${h.storeId}|${h.period}`;
    const cur = latest.get(k);
    if (!cur || h.rank < cur.rank) latest.set(k, { rank: h.rank, sales: h.sales });
  }

  const online = placements.filter((p) => !p.branchName);
  const branches = placements.filter((p) => p.branchName);

  return (
    <div className="space-y-4">
      {/* ================= 도서 정보 ================= */}
      <section className="flex items-start gap-4 rounded-lg border border-slate-200 bg-white p-4">
        <Cover
          url={main.cover_url}
          alt={main.raw_title}
          className="h-40 w-28"
        />
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-bold">{main.raw_title}</h1>
          <p className="mt-1 text-sm text-slate-600">
            {main.raw_author || "저자 정보 없음"}
            {main.raw_publisher ? ` · ${main.raw_publisher}` : ""}
            {main.pub_ym ? ` · ${main.pub_ym}` : ""}
          </p>
          {main.isbn13 ? (
            <p className="mt-1 text-xs text-slate-500">ISBN {main.isbn13}</p>
          ) : (
            <p className="mt-1 text-xs text-slate-400">
              ISBN 정보 없음 (목록에 ISBN 을 노출하지 않는 서점입니다)
            </p>
          )}
          <p className="mt-2 text-xs text-slate-500">
            {stores.length}개 서점에서 발견됨 ·{" "}
            {latestDate ? `최근 기록 ${latestDate}` : "순위 기록 없음"}
          </p>
        </div>
      </section>

      {/* ================= 지금 순위 (서점 × 기간) ================= */}
      <section className="rounded-lg border border-slate-200 bg-white">
        <h2 className="border-b border-slate-200 px-4 py-3 text-sm font-semibold">
          지금 순위 {latestDate && <span className="text-slate-400">({latestDate})</span>}
        </h2>
        <div className="grid gap-3 p-4 sm:grid-cols-3">
          {STORE_ORDER.map((sid) => (
            <div key={sid} className="rounded border border-slate-200 p-3">
              <span className={`rounded px-1.5 py-0.5 text-xs ${STORE_COLOR[sid]}`}>
                {STORE_NAME[sid]}
              </span>
              <div className="mt-2 space-y-2">
                {(["daily", "weekly"] as Period[]).map((p) => {
                  const cell = latest.get(`${sid}|${p}`);
                  return (
                    <div key={p} className="flex items-baseline justify-between gap-2">
                      <span
                        className="text-xs text-slate-500"
                        title={PERIOD_HELP[p]}
                      >
                        {PERIOD_LABEL[p]}
                      </span>
                      <span className="text-base font-bold tabular-nums">
                        {cell ? (
                          `${cell.rank}위`
                        ) : (
                          <span className="text-xs font-normal text-slate-400">
                            순위권 밖
                          </span>
                        )}
                      </span>
                    </div>
                  );
                })}
                <div className="border-t border-slate-100 pt-2">
                  <div className="text-[10px] text-slate-500">판매지수</div>
                  <SalesPoint
                    value={latest.get(`${sid}|daily`)?.sales ?? null}
                    storeProvides={SALES_STORES.has(sid)}
                    size="sm"
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ================= 추이 그래프 ================= */}
      {(["daily", "weekly"] as Period[]).map((p) => (
        <section key={p} className="rounded-lg border border-slate-200 bg-white">
          <h2 className="border-b border-slate-200 px-4 py-3 text-sm font-semibold">
            {PERIOD_LABEL[p]} 순위 추이{" "}
            <span className="font-normal text-slate-400">({PERIOD_HELP[p]})</span>
          </h2>
          <TrendChart history={history} period={p} metric="rank" />

          <h2 className="border-y border-slate-200 px-4 py-3 text-sm font-semibold">
            {PERIOD_LABEL[p]} 판매지수 추이
          </h2>
          <TrendChart history={history} period={p} metric="sales" />
          <p className="px-4 py-3 text-xs text-slate-500">
            판매지수는 예스24·알라딘만 공개합니다. 두 서점의 값은 계산식이 다른 별개의
            수치라 서로 더하거나 평균 내지 않고 그대로 그립니다.
          </p>
        </section>
      ))}

      {/* ================= 올라 있는 분야 ================= */}
      <PlacementTable
        title="올라 있는 분야"
        rows={online}
        empty="이 날짜에 온라인 순위에 올라 있지 않습니다."
      />
      {branches.length > 0 && (
        <PlacementTable
          title="올라 있는 교보문고 매장"
          rows={branches}
          empty=""
          showBranch
        />
      )}

      {/* ================= 서점별 표기 ================= */}
      <section className="rounded-lg border border-slate-200 bg-white">
        <h2 className="border-b border-slate-200 px-4 py-3 text-sm font-semibold">
          서점별 표기
        </h2>
        <div className="space-y-1.5 p-4">
          {stores.map((s) => (
            <div key={s.id} className="flex items-start gap-2 text-xs">
              <span
                className={`shrink-0 rounded px-1.5 py-0.5 ${STORE_COLOR[s.store_id]}`}
              >
                {STORE_NAME[s.store_id]}
              </span>
              <span className="text-slate-600">
                {s.raw_title}
                {s.raw_author ? ` / ${s.raw_author}` : ""}
                {s.raw_publisher ? ` / ${s.raw_publisher}` : ""}
              </span>
            </div>
          ))}
        </div>
        <p className="px-4 pb-4 text-xs text-slate-500">
          같은 책이라도 서점마다 제목·저자 표기가 조금씩 다릅니다. 원본 그대로
          보여드립니다. (묶기가 잘못됐다고 보이면 알려주세요)
        </p>
      </section>
    </div>
  );
}

function PlacementTable({
  title,
  rows,
  empty,
  showBranch = false,
}: {
  title: string;
  rows: CurrentPlacement[];
  empty: string;
  showBranch?: boolean;
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white">
      <h2 className="border-b border-slate-200 px-4 py-3 text-sm font-semibold">
        {title} <span className="font-normal text-slate-400">({rows.length})</span>
      </h2>
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-slate-500">{empty}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs text-slate-500">
                <th className="px-4 py-2 text-left">서점</th>
                <th className="px-4 py-2 text-left">
                  {showBranch ? "매장" : "분야"}
                </th>
                {!showBranch && <th className="px-4 py-2 text-left">기간</th>}
                <th className="px-4 py-2 text-right">순위</th>
                <th className="px-4 py-2 text-right">판매지수</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p, i) => (
                <tr key={i} className="border-b border-slate-100">
                  <td className="px-4 py-2">
                    <span
                      className={`rounded px-1.5 py-0.5 text-xs ${STORE_COLOR[p.storeId]}`}
                    >
                      {STORE_NAME[p.storeId]}
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    {showBranch ? p.branchName : p.categoryName}
                  </td>
                  {!showBranch && (
                    <td className="px-4 py-2 text-xs text-slate-600">
                      {PERIOD_LABEL[p.period]}
                    </td>
                  )}
                  <td className="px-4 py-2 text-right font-bold tabular-nums">
                    {p.rank}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {SALES_STORES.has(p.storeId) ? (
                      p.sales !== null ? (
                        p.sales.toLocaleString()
                      ) : (
                        <span className="text-slate-400">–</span>
                      )
                    ) : (
                      <span className="text-xs text-slate-400">미제공</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
