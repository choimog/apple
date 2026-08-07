import Link from "next/link";
import Cover from "@/components/Cover";
import RankChange from "@/components/RankChange";
import ExportButton from "@/components/ExportButton";
import DataError from "@/components/DataError";
import { configError, STORE_COLOR, STORE_NAME } from "@/lib/supabase";
import {
  getCategories,
  getPreviousDate,
  getRankings,
  getSnapshotDates,
} from "@/lib/queries";

// 매일 한 번 새 데이터가 들어오므로, 10분마다 다시 읽습니다.
export const revalidate = 600;

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ cat?: string; date?: string }>;
}) {
  if (configError) return <SetupNotice message={configError} />;

  const params = await searchParams;

  let categories, dates;
  try {
    [categories, dates] = await Promise.all([getCategories(), getSnapshotDates()]);
  } catch (e) {
    // 데이터베이스에 못 닿았을 때. "0건" 으로 위장하지 않고 사실대로 보여줍니다.
    return <DataError detail={String(e)} />;
  }

  if (!categories.length || !dates.length) return <EmptyNotice />;

  const categoryId = Number(params.cat) || categories[0].id;
  const date = params.date && dates.includes(params.date) ? params.date : dates[0];
  const category = categories.find((c) => c.id === categoryId) ?? categories[0];

  let rows, prevDate;
  try {
    [rows, prevDate] = await Promise.all([
      getRankings(category.id, date, 200),
      getPreviousDate(category.id, date),
    ]);
  } catch (e) {
    return <DataError detail={String(e)} />;
  }

  return (
    <div className="space-y-5">
      {/* ---------- 분야 고르기 ---------- */}
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="mb-2 text-sm font-semibold text-slate-700">분야</h2>
        <div className="flex flex-wrap gap-1.5">
          {categories.map((c) => (
            <Link
              key={c.id}
              href={`/?cat=${c.id}&date=${date}`}
              className={`rounded-full border px-3 py-1 text-xs ${
                c.id === category.id
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-300 bg-white text-slate-700 hover:border-slate-500"
              }`}
            >
              {STORE_NAME[c.store_id]} · {c.branch_name || c.name}
              {c.branch_name ? ` · ${c.name}` : ""}
            </Link>
          ))}
        </div>

        <h2 className="mb-2 mt-4 text-sm font-semibold text-slate-700">날짜</h2>
        <div className="flex flex-wrap gap-1.5">
          {dates.slice(0, 14).map((d) => (
            <Link
              key={d}
              href={`/?cat=${category.id}&date=${d}`}
              className={`rounded border px-2 py-1 text-xs ${
                d === date
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-300 bg-white text-slate-700 hover:border-slate-500"
              }`}
            >
              {d.slice(5)}
            </Link>
          ))}
        </div>
        <p className="mt-2 text-xs text-slate-500">
          ※ 목록에 없는 날짜는 그날 수집이 되지 않았다는 뜻입니다.
          (빈 데이터를 채워 넣지 않습니다)
        </p>
      </section>

      {/* ---------- 순위표 ---------- */}
      <section className="rounded-lg border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div>
            <h1 className="text-base font-bold">
              <span
                className={`mr-2 rounded px-1.5 py-0.5 text-xs ${
                  STORE_COLOR[category.store_id]
                }`}
              >
                {STORE_NAME[category.store_id]}
              </span>
              {category.branch_name && `${category.branch_name} · `}
              {category.name}
            </h1>
            <p className="mt-1 text-xs text-slate-500">
              {date} 기준 · {rows.length}권
              {prevDate ? ` · 등락은 ${prevDate} 대비` : " · 비교할 이전 기록 없음"}
            </p>
          </div>
          <ExportButton
            rows={rows}
            filename={`${STORE_NAME[category.store_id]}_${
              category.branch_name || category.name
            }_${date}`}
          />
        </div>

        {rows.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-slate-500">
            이 날짜에 수집된 데이터가 없습니다.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((r) => (
              <li key={r.rank} className="flex items-start gap-3 px-4 py-3">
                <div className="w-10 shrink-0 text-center">
                  <div className="text-lg font-bold tabular-nums">{r.rank}</div>
                  <RankChange change={r.change} isNew={r.isNew} />
                </div>

                <Cover url={r.store_book.cover_url} alt={r.store_book.raw_title} />

                <div className="min-w-0 flex-1">
                  {r.store_book.book_id ? (
                    <Link
                      href={`/book/${r.store_book.book_id}`}
                      className="font-medium hover:underline"
                    >
                      {r.store_book.raw_title}
                    </Link>
                  ) : (
                    <span className="font-medium">{r.store_book.raw_title}</span>
                  )}
                  <p className="mt-0.5 text-sm text-slate-600">
                    {r.store_book.raw_author || "저자 정보 없음"}
                    {r.store_book.raw_publisher && ` · ${r.store_book.raw_publisher}`}
                    {r.store_book.pub_ym && ` · ${r.store_book.pub_ym}`}
                  </p>
                  {r.store_book.isbn13 && (
                    <p className="mt-0.5 text-xs text-slate-400">
                      ISBN {r.store_book.isbn13}
                    </p>
                  )}
                </div>

                <div className="w-24 shrink-0 text-right">
                  {r.sales_point === null ? (
                    <span
                      className="text-xs text-slate-400"
                      title="이 서점은 판매지수를 제공하지 않습니다"
                    >
                      판매지수 없음
                    </span>
                  ) : (
                    <>
                      <div className="text-sm font-medium tabular-nums">
                        {r.sales_point.toLocaleString()}
                      </div>
                      <div className="text-xs text-slate-500">판매지수</div>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function SetupNotice({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-6">
      <h1 className="text-base font-bold text-amber-900">설정이 아직 안 됐습니다</h1>
      <p className="mt-2 whitespace-pre-line text-sm text-amber-800">{message}</p>
    </div>
  );
}

function EmptyNotice() {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-6">
      <h1 className="text-base font-bold">아직 수집된 데이터가 없습니다</h1>
      <p className="mt-2 text-sm text-slate-600">
        GitHub → Actions → [매일 수집 (daily crawl)] → Run workflow 를 한 번 실행하면
        데이터가 채워집니다. 매일 아침 6시에는 자동으로 실행됩니다.
      </p>
    </div>
  );
}
