import Cover from "@/components/Cover";
import { configError, STORE_COLOR, STORE_NAME } from "@/lib/supabase";
import { getBookHistory } from "@/lib/queries";
import DataError from "@/components/DataError";

export const revalidate = 600;

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
  let stores, history;
  try {
    ({ stores, history } = await getBookHistory(Number(id)));
  } catch (e) {
    return <DataError detail={String(e)} />;
  }

  if (!stores.length) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-600">
        해당 도서를 찾을 수 없습니다.
      </div>
    );
  }

  // 표지 우선순위: 알라딘(3) → 예스24(2) → 교보(1)
  const order = [3, 2, 1];
  const withCover = order
    .map((s) => stores.find((b) => b.store_id === s && b.cover_url))
    .find(Boolean);
  const main = withCover ?? stores[0];

  // 서점별 순위 이력을 날짜순으로 모읍니다
  const byStoreBook = new Map(stores.map((s) => [s.id as number, s]));
  const dates = [...new Set(history.map((h) => h.snapshot_date as string))].sort();

  type Cell = { rank: number; sales: number | null };
  const table = new Map<number, Map<string, Cell>>();
  for (const h of history) {
    const sb = byStoreBook.get(h.store_book_id as number);
    if (!sb) continue;
    const storeId = sb.store_id as number;
    if (!table.has(storeId)) table.set(storeId, new Map());
    const row = table.get(storeId)!;
    const date = h.snapshot_date as string;
    const cur = row.get(date);
    // 같은 날 여러 분야에 올랐으면 가장 높은(작은) 순위를 대표로 씁니다
    if (!cur || (h.rank as number) < cur.rank) {
      row.set(date, {
        rank: h.rank as number,
        sales: (h.sales_point as number | null) ?? null,
      });
    }
  }

  const recent = dates.slice(-14);

  return (
    <div className="space-y-5">
      {/* ---------- 도서 정보 ---------- */}
      <section className="flex items-start gap-4 rounded-lg border border-slate-200 bg-white p-4">
        <Cover
          url={main.cover_url as string | null}
          alt={main.raw_title as string}
          className="h-40 w-28"
        />
        <div className="min-w-0">
          <h1 className="text-lg font-bold">{main.raw_title as string}</h1>
          <p className="mt-1 text-sm text-slate-600">
            {(main.raw_author as string) || "저자 정보 없음"}
            {main.raw_publisher ? ` · ${main.raw_publisher}` : ""}
            {main.pub_ym ? ` · ${main.pub_ym}` : ""}
          </p>
          {main.isbn13 ? (
            <p className="mt-1 text-xs text-slate-500">ISBN {main.isbn13 as string}</p>
          ) : (
            <p className="mt-1 text-xs text-slate-400">
              ISBN 정보 없음 (서점 목록에 노출되지 않는 서점입니다)
            </p>
          )}

          <div className="mt-3 space-y-1">
            <p className="text-xs font-semibold text-slate-700">서점별 표기</p>
            {stores.map((s) => (
              <div key={s.id as number} className="flex items-start gap-2 text-xs">
                <span
                  className={`shrink-0 rounded px-1.5 py-0.5 ${
                    STORE_COLOR[s.store_id as number]
                  }`}
                >
                  {STORE_NAME[s.store_id as number]}
                </span>
                <span className="text-slate-600">
                  {s.raw_title as string}
                  {s.raw_author ? ` / ${s.raw_author}` : ""}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- 3사 순위 이력 ---------- */}
      <section className="rounded-lg border border-slate-200 bg-white">
        <h2 className="border-b border-slate-200 px-4 py-3 text-sm font-semibold">
          서점별 순위 흐름 (최근 {recent.length}일)
        </h2>

        {recent.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-slate-500">
            아직 순위 기록이 없습니다.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs text-slate-500">
                  <th className="px-4 py-2 text-left">서점</th>
                  {recent.map((d) => (
                    <th key={d} className="px-2 py-2 text-center tabular-nums">
                      {d.slice(5)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[3, 2, 1].map((storeId) => {
                  const row = table.get(storeId);
                  if (!row) return null;
                  return (
                    <tr key={storeId} className="border-b border-slate-100">
                      <td className="px-4 py-2">
                        <span
                          className={`rounded px-1.5 py-0.5 text-xs ${STORE_COLOR[storeId]}`}
                        >
                          {STORE_NAME[storeId]}
                        </span>
                      </td>
                      {recent.map((d) => {
                        const cell = row.get(d);
                        return (
                          <td
                            key={d}
                            className="px-2 py-2 text-center tabular-nums"
                            title={
                              cell?.sales != null
                                ? `판매지수 ${cell.sales.toLocaleString()}`
                                : undefined
                            }
                          >
                            {cell ? (
                              <span className="font-medium">{cell.rank}</span>
                            ) : (
                              <span className="text-slate-300">·</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="px-4 py-3 text-xs text-slate-500">
          · 표시는 그날 순위권 밖이거나 수집되지 않았다는 뜻입니다.
          빈 값을 추정해서 채우지 않습니다.
        </p>
      </section>
    </div>
  );
}
