import Link from "next/link";
import Cover from "@/components/Cover";
import RankChange from "@/components/RankChange";
import ExportButton from "@/components/ExportButton";
import DataError from "@/components/DataError";
import SalesPoint from "@/components/SalesPoint";
import {
  Card,
  CardHead,
  Empty,
  FieldLabel,
  PeriodBadge,
  Pill,
  RankBadge,
  ScopeBar,
} from "@/components/ui";
import { configError } from "@/lib/supabase";
import { store as storeMeta, STORE_NAME } from "@/lib/stores";
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
import { dayLabel } from "@/lib/format";

export const metadata = { title: "서점별 순위" };

export const revalidate = 600;

/** 한 번에 보여주는 권수. 200개를 한꺼번에 그리면 화면이 버벅입니다. */
const PAGE_SIZE = 50;

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
      <div className="rounded-lg border border-line bg-surface p-6 text-sm text-ink-soft">
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
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-blue-700">
          순위 · 서점별
        </p>
        <h1 className="mt-0.5 text-2xl font-bold tracking-tight">서점별 순위</h1>
        <p className="mt-1 text-sm text-ink-soft">
          각 서점이 <strong>스스로 발표한 순위</strong> 그대로입니다.
          3사를 섞지 않습니다. 섞은 순위는{" "}
          <Link href="/best" className="text-blue-700 hover:underline">
            종합 순위
          </Link>{" "}
          에서 보세요.
        </p>
      </div>

      {/* ============ 1 서점 → 2 기간 → 3 분야 ============ */}
      <Card className="p-4 sm:p-5">
        <FieldLabel>1. 서점</FieldLabel>
        <div className="flex flex-wrap gap-1.5">
          {tree.map((t) => (
            <Link
              key={t.storeId}
              href={`/store?store=${t.storeId}&date=${date}`}
              className={`rounded-lg border px-4 py-2 text-sm font-semibold transition-colors ${
                t.storeId === storeId
                  ? "border-transparent bg-accent text-accent-ink"
                  : "border-line bg-surface text-ink-soft hover:border-ink-faint"
              }`}
            >
              {STORE_NAME[t.storeId]}
            </Link>
          ))}
        </div>

        <div className="mt-4">
          <FieldLabel>2. 집계 기간</FieldLabel>
          <div className="flex flex-wrap gap-1.5">
            {tabs.map((t) => {
              const on = t.key === tab;
              return (
                <Link
                  key={t.key}
                  href={`/store?store=${storeId}&tab=${t.key}&date=${date}`}
                  title={t.help}
                  className={`rounded-lg border px-4 py-2 transition-colors ${
                    on
                      ? t.key === "weekly"
                        ? "border-violet-500 bg-violet-50 text-violet-900"
                        : "border-sky-500 bg-sky-50 text-sky-900"
                      : "border-line bg-surface text-ink-soft hover:border-ink-faint"
                  }`}
                >
                  <span className="block text-sm font-bold">
                    {t.label}{" "}
                    <span className="font-normal opacity-60">{t.list.length}</span>
                  </span>
                  <span className="block text-[11px] opacity-70">{t.help}</span>
                </Link>
              );
            })}
          </div>
        </div>

        <div className="mt-4">
          <FieldLabel>
            3. {tab === "branch" ? "매장" : "분야"} ({list.length}개)
          </FieldLabel>
          <div className="scroll-x flex max-h-36 flex-wrap gap-1.5 overflow-y-auto rounded-lg border border-line-soft bg-surface-2 p-2">
            {list.map((c) => (
              <Pill
                key={c.id}
                href={href({ cat: String(c.id), n: String(PAGE_SIZE) })}
                active={c.id === category.id}
              >
                {tab === "branch" ? c.branch_name : c.name}
              </Pill>
            ))}
          </div>
        </div>

        <div className="mt-4">
          <FieldLabel>날짜</FieldLabel>
          <div className="flex flex-wrap gap-1.5">
            {dates.slice(0, 10).map((d) => (
              <Pill key={d} href={href({ date: d })} active={d === date}>
                {d.slice(5)}
              </Pill>
            ))}
          </div>
          <p className="mt-2 text-xs text-ink-faint">
            ※ 목록에 없는 날짜는 그날 수집이 되지 않았다는 뜻입니다. 빈 데이터를
            채워 넣지 않습니다.
          </p>
        </div>
      </Card>

      {/* 지금 보고 있는 것이 무엇인지 문장으로 못박습니다 */}
      <ScopeBar
        parts={[
          <span key="a" className="font-semibold">{STORE_NAME[storeId]}</span>,
          tab === "branch" ? (
            <span key="b" className="font-semibold">{category.branch_name} 매장</span>
          ) : (
            <PeriodBadge key="b" period={tab === "weekly" ? "weekly" : "daily"} withHelp />
          ),
          <span key="c" className="font-semibold">{category.name}</span>,
          <span key="d" className="text-ink-soft">{dayLabel(date)}</span>,
        ]}
        note={
          category.unified_code === "all"
            ? `${STORE_NAME[storeId]} 가 발표한 '전체' 순위입니다. 분야를 가리지 않습니다.`
            : `${STORE_NAME[storeId]} 의 '${category.name}' 분야 안에서의 순위입니다. 전체 순위와는 다릅니다.`
        }
      />

      {/* ================= 순위표 ================= */}
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line-soft px-4 py-3 sm:px-5">
          <div>
            <h2 className="text-base font-bold">
              <span
                className={`mr-2 rounded-md px-2 py-0.5 text-2xs font-medium ${storeMeta(storeId).chip}`}
              >
                {STORE_NAME[storeId]}
              </span>
              {category.branch_name && `${category.branch_name} · `}
              {category.name}
              {/* 일간과 주간은 분야 이름이 같습니다. 반드시 구분해 보여줍니다. */}
              <span
                className={`ml-2 rounded-md px-2 py-0.5 text-[11px] font-semibold ${
                  isWeekly(category)
                    ? "bg-violet-100 text-violet-800"
                    : "bg-sky-100 text-sky-800"
                }`}
              >
                {isWeekly(category)
                  ? "주간 · 최근 7일"
                  : category.kind === "offline"
                    ? "매장 · 어제 하루"
                    : "일간 · 어제 하루"}
              </span>
            </h2>
            <p className="mt-1 text-xs text-ink-soft">
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
          <Empty>이 날짜에 수집된 데이터가 없습니다.</Empty>
        ) : (
          <>
            <ul className="divide-y divide-line-soft">
              {rows.map((r) => (
                <li key={r.rank} className="flex items-start gap-3 px-4 py-3">
                  <div className="w-11 shrink-0 text-center">
                    <RankBadge rank={r.rank} />
                    <div className="mt-1">
                      <RankChange change={r.change} isNew={r.isNew} />
                    </div>
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
                    <p className="mt-0.5 text-sm text-ink-soft">
                      {r.store_book.raw_author || "저자 정보 없음"}
                      {r.store_book.raw_publisher &&
                        ` · ${r.store_book.raw_publisher}`}
                      {r.store_book.pub_ym && ` · ${r.store_book.pub_ym}`}
                    </p>
                    {r.store_book.isbn13 && (
                      <p className="mt-0.5 text-xs text-ink-faint">
                        ISBN {r.store_book.isbn13}
                      </p>
                    )}
                  </div>

                  <div className="w-28 shrink-0 text-right">
                    <SalesPoint
                      value={r.sales_point}
                      storeProvides={storeMeta(storeId).hasSalesPoint}
                    />
                    {storeMeta(storeId).hasSalesPoint && r.sales_point !== null && (
                      <div className="mt-0.5 text-[10px] text-ink-soft">판매지수</div>
                    )}
                  </div>
                </li>
              ))}
            </ul>

            {/* 더보기: 한 번에 다 그리지 않고 50권씩 늘립니다 */}
            {rows.length < total && (
              <div className="border-t border-line-soft px-4 py-3 text-center">
                <Link
                  href={href({ n: String(shown + PAGE_SIZE) })}
                  className="inline-block rounded border border-line px-4 py-2 text-sm hover:border-ink-faint"
                >
                  {PAGE_SIZE}권 더보기 ({rows.length} / {total.toLocaleString()})
                </Link>
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
