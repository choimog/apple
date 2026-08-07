import Link from "next/link";
import Cover from "@/components/Cover";
import RankChange from "@/components/RankChange";
import ExportButton from "@/components/ExportButton";
import DataError from "@/components/DataError";
import SalesPoint from "@/components/SalesPoint";
import { configError, STORE_COLOR, STORE_NAME } from "@/lib/supabase";
import {
  buildStoreTree,
  countRankings,
  getCategories,
  getPreviousDate,
  getRankings,
  getSnapshotDates,
  isWeekly,
  PERIOD_HELP,
  type Category,
} from "@/lib/queries";

export const revalidate = 600;

/** 한 번에 보여주는 권수. 200개를 한꺼번에 그리면 화면이 버벅입니다. */
const PAGE_SIZE = 50;

/** 판매지수를 제공하는 서점 */
const SALES_STORES = new Set([2, 3]);

type Tab = "daily" | "weekly" | "branch";

export default async function StorePage({
  searchParams,
}: {
  searchParams: Promise<{
    store?: string;
    tab?: string;
    cat?: string;
    date?: string;
    n?: string;
  }>;
}) {
  if (configError) {
    return (
      <div className="rounded-lg border border-amber-300 bg-amber-50 p-6 text-sm text-amber-800">
        {configError}
      </div>
    );
  }
  const params = await searchParams;

  let categories, dates;
  try {
    [categories, dates] = await Promise.all([getCategories(), getSnapshotDates(30)]);
  } catch (e) {
    return <DataError detail={String(e)} />;
  }

  if (!categories.length || !dates.length) {
    return (
      <div className="rounded-lg border border-slate-300 bg-white p-6 text-sm text-slate-600">
        아직 수집된 데이터가 없습니다. (분야 {categories.length}개 · 날짜{" "}
        {dates.length}일)
      </div>
    );
  }

  const tree = buildStoreTree(categories);
  const storeId = tree.some((t) => t.storeId === Number(params.store))
    ? Number(params.store)
    : tree[0].storeId;
  const node = tree.find((t) => t.storeId === storeId)!;

  // 이 서점에 있는 탭만 보여줍니다 (예스24·알라딘은 매장이 없습니다)
  const ALL_TABS: { key: Tab; label: string; list: Category[]; help: string }[] = [
    { key: "daily", label: "일간", list: node.daily, help: PERIOD_HELP.daily },
    { key: "weekly", label: "주간", list: node.weekly, help: PERIOD_HELP.weekly },
    {
      key: "branch",
      label: "매장별",
      list: node.branches,
      help: "전국 교보문고 매장에서 어제 하루 많이 팔린 책",
    },
  ];
  const tabs = ALL_TABS.filter((t) => t.list.length > 0);

  const tab: Tab =
    (tabs.find((t) => t.key === params.tab)?.key as Tab) ?? tabs[0].key;
  const list = tabs.find((t) => t.key === tab)!.list;

  const category =
    list.find((c) => c.id === Number(params.cat)) ?? list[0];
  const date = params.date && dates.includes(params.date) ? params.date : dates[0];
  const shown = Math.max(PAGE_SIZE, Number(params.n) || PAGE_SIZE);

  let rows, prevDate, total;
  try {
    [rows, prevDate, total] = await Promise.all([
      getRankings(category.id, date, shown),
      getPreviousDate(category.id, date),
      countRankings(category.id, date),
    ]);
  } catch (e) {
    return <DataError detail={String(e)} />;
  }

  const href = (over: Record<string, string>) => {
    const p = new URLSearchParams({
      store: String(storeId),
      tab,
      cat: String(category.id),
      date,
      n: String(shown),
      ...over,
    });
    return `/store?${p.toString()}`;
  };

  return (
    <div className="space-y-4">
      {/* ================= 1단계: 서점 ================= */}
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="mb-1.5 text-xs font-semibold text-slate-500">1. 서점</h2>
        <div className="flex flex-wrap gap-1.5">
          {tree.map((t) => (
            <Link
              key={t.storeId}
              // 서점을 바꾸면 분야·탭은 처음부터 다시 고릅니다
              href={`/store?store=${t.storeId}&date=${date}`}
              className={`rounded-full border px-3 py-1 text-xs ${
                t.storeId === storeId
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-300 bg-white text-slate-700 hover:border-slate-500"
              }`}
            >
              {STORE_NAME[t.storeId]}
            </Link>
          ))}
        </div>

        {/* ================= 2단계: 집계 기간 ================= */}
        <h2 className="mb-1.5 mt-4 text-xs font-semibold text-slate-500">
          2. 집계 기간
        </h2>
        <div className="flex flex-wrap gap-1.5">
          {tabs.map((t) => (
            <Link
              key={t.key}
              href={`/store?store=${storeId}&tab=${t.key}&date=${date}`}
              title={t.help}
              className={`rounded-full border px-3 py-1 text-xs ${
                t.key === tab
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-300 bg-white text-slate-700 hover:border-slate-500"
              }`}
            >
              {t.label} <span className="opacity-60">({t.list.length})</span>
            </Link>
          ))}
        </div>
        <p className="mt-1 text-xs text-slate-500">
          {tabs.find((t) => t.key === tab)?.help}
        </p>

        {/* ================= 3단계: 분야 / 매장 ================= */}
        <h2 className="mb-1.5 mt-4 text-xs font-semibold text-slate-500">
          3. {tab === "branch" ? "매장" : "분야"} ({list.length}개)
        </h2>
        <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto rounded border border-slate-100 bg-slate-50 p-2">
          {list.map((c) => (
            <Link
              key={c.id}
              href={href({ cat: String(c.id), n: String(PAGE_SIZE) })}
              className={`rounded-full border px-2.5 py-1 text-xs ${
                c.id === category.id
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-300 bg-white text-slate-700 hover:border-slate-500"
              }`}
            >
              {tab === "branch" ? c.branch_name : c.name}
            </Link>
          ))}
        </div>

        {/* ================= 날짜 ================= */}
        <h2 className="mb-1.5 mt-4 text-xs font-semibold text-slate-500">날짜</h2>
        <div className="flex flex-wrap gap-1.5">
          {dates.slice(0, 14).map((d) => (
            <Link
              key={d}
              href={href({ date: d })}
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
          ※ 목록에 없는 날짜는 그날 수집이 되지 않았다는 뜻입니다. (빈 데이터를 채워
          넣지 않습니다)
        </p>
      </section>

      {/* ================= 순위표 ================= */}
      <section className="rounded-lg border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div>
            <h1 className="text-base font-bold">
              <span
                className={`mr-2 rounded px-1.5 py-0.5 text-xs ${STORE_COLOR[storeId]}`}
              >
                {STORE_NAME[storeId]}
              </span>
              {category.branch_name && `${category.branch_name} · `}
              {category.name}
              {/* 일간과 주간은 분야 이름이 같습니다. 반드시 구분해 보여줍니다. */}
              <span className="ml-2 rounded border border-slate-300 px-1.5 py-0.5 text-xs font-normal text-slate-600">
                {isWeekly(category)
                  ? "주간 · 최근 7일"
                  : category.kind === "offline"
                    ? "매장 · 어제 하루"
                    : "일간 · 어제 하루"}
              </span>
            </h1>
            <p className="mt-1 text-xs text-slate-500">
              {date} 기준 · 전체 {total.toLocaleString()}권 중 {rows.length}권 표시
              {prevDate ? ` · 등락은 ${prevDate} 대비` : " · 비교할 이전 기록 없음"}
            </p>
          </div>
          <ExportButton
            rows={rows}
            filename={`${STORE_NAME[storeId]}_${category.branch_name || category.name}_${
              isWeekly(category) ? "주간" : "일간"
            }_${date}`}
          />
        </div>

        {rows.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-slate-500">
            이 날짜에 수집된 데이터가 없습니다.
          </p>
        ) : (
          <>
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
                      {r.store_book.raw_publisher &&
                        ` · ${r.store_book.raw_publisher}`}
                      {r.store_book.pub_ym && ` · ${r.store_book.pub_ym}`}
                    </p>
                    {r.store_book.isbn13 && (
                      <p className="mt-0.5 text-xs text-slate-400">
                        ISBN {r.store_book.isbn13}
                      </p>
                    )}
                  </div>

                  <div className="w-28 shrink-0 text-right">
                    <SalesPoint
                      value={r.sales_point}
                      storeProvides={SALES_STORES.has(storeId)}
                    />
                    {SALES_STORES.has(storeId) && r.sales_point !== null && (
                      <div className="mt-0.5 text-[10px] text-slate-500">판매지수</div>
                    )}
                  </div>
                </li>
              ))}
            </ul>

            {/* 더보기: 한 번에 다 그리지 않고 50권씩 늘립니다 */}
            {rows.length < total && (
              <div className="border-t border-slate-100 px-4 py-3 text-center">
                <Link
                  href={href({ n: String(shown + PAGE_SIZE) })}
                  className="inline-block rounded border border-slate-300 px-4 py-2 text-sm hover:border-slate-500"
                >
                  {PAGE_SIZE}권 더보기 ({rows.length} / {total.toLocaleString()})
                </Link>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
