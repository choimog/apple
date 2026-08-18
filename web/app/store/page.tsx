import Link from "next/link";
import Cover from "@/components/Cover";
import RankChange from "@/components/RankChange";
import ExportButton from "@/components/ExportButton";
import DataError from "@/components/DataError";
import DatePicker from "@/components/DatePicker";
import SalesPoint from "@/components/SalesPoint";
import { Card, Empty, FieldLabel, Pill, RankBadge } from "@/components/ui";
import { configError } from "@/lib/supabase";
import { store as storeMeta, STORE_NAME } from "@/lib/stores";
import {
  buildStoreTree,
  countRankings,
  getCategories,
  getCategoryDates,
  getPreviousDate,
  getRankings,
  isWeekly,
  type Category,
} from "@/lib/queries";
import { dayLabel } from "@/lib/format";

export const metadata = { title: "서점별 순위" };


/** 한 번에 보여주는 권수. 200개를 한꺼번에 그리면 화면이 버벅입니다. */
const PAGE_SIZE = 50;

type Tab = "daily" | "branch" | "weekly";

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

  let categories;
  try {
    categories = await getCategories();
  } catch (e) {
    return <DataError detail={String(e)} />;
  }
  if (!categories.length) {
    return (
      <Card>
        <Empty>아직 수집된 데이터가 없습니다.</Empty>
      </Card>
    );
  }

  const tree = buildStoreTree(categories);
  const storeId = tree.some((t) => t.storeId === Number(params.store))
    ? Number(params.store)
    : tree[0].storeId;
  const node = tree.find((t) => t.storeId === storeId)!;

  /**
   * 집계 기간 차례 — 온라인 일간 → 매장별 일간 → 주간.
   * 【2026-08-08 대표님 지시】 "교보문고에서 '온라인일간 - 매장별일간 - 주간'
   * 으로 집계기간을 바꿀 것." 같은 '어제 하루' 끼리 붙여 두는 것이 맞습니다.
   * 예스24·알라딘은 매장이 없으므로 그 칸이 아예 안 나옵니다.
   */
  const ALL_TABS: { key: Tab; label: string; list: Category[] }[] = [
    { key: "daily", label: "온라인 일간", list: node.daily },
    { key: "branch", label: "매장별 일간", list: node.branches },
    { key: "weekly", label: "주간", list: node.weekly },
  ];
  const tabs = ALL_TABS.filter((t) => t.list.length > 0);

  const tab: Tab = (tabs.find((t) => t.key === params.tab)?.key as Tab) ?? tabs[0].key;
  const list = tabs.find((t) => t.key === tab)!.list;
  const category = list.find((c) => c.id === Number(params.cat)) ?? list[0];

  // 고른 분야에 실제로 자료가 있는 날짜만 씁니다.
  // (예전에는 3사를 합친 날짜 목록이라, 자료가 없는 날도 고를 수 있었습니다)
  let dates;
  try {
    dates = await getCategoryDates(category.id);
  } catch (e) {
    return <DataError detail={String(e)} />;
  }

  const date = params.date && dates.includes(params.date) ? params.date : dates[0];
  const shown = Math.max(PAGE_SIZE, Number(params.n) || PAGE_SIZE);

  let rows: Awaited<ReturnType<typeof getRankings>> = [];
  let prevDate: string | null = null;
  let total = 0;
  if (date) {
    try {
      [rows, prevDate, total] = await Promise.all([
        getRankings(category.id, date, shown),
        getPreviousDate(category.id, date),
        countRankings(category.id, date),
      ]);
    } catch (e) {
      return <DataError detail={String(e)} />;
    }
  }

  const href = (over: Record<string, string>) => {
    const p = new URLSearchParams({
      store: String(storeId),
      tab,
      cat: String(category.id),
      date: date ?? "",
      n: String(shown),
      ...over,
    });
    return `/store?${p.toString()}`;
  };

  const periodTag = isWeekly(category)
    ? { text: "주간 · 최근 7일", cls: "bg-weekly-soft text-weekly" }
    : category.kind === "offline"
      ? { text: "매장 · 어제 하루", cls: "bg-daily-soft text-daily" }
      : { text: "일간 · 어제 하루", cls: "bg-daily-soft text-daily" };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">서점별 순위</h1>
        <p className="mt-1 text-sm text-ink-soft">
          각 서점이 발표한 순위 그대로입니다. 3사를 섞은 순위는{" "}
          <Link href="/best" className="text-accent hover:underline">
            종합 순위
          </Link>
          에 있습니다.
        </p>
      </div>

      {/* ============ 서점 → 기간 → 분야 → 날짜 ============ */}
      <Card className="p-4 sm:p-5">
        <FieldLabel>서점</FieldLabel>
        <div className="flex flex-wrap gap-1.5">
          {tree.map((t) => (
            <Link
              key={t.storeId}
              href={`/store?store=${t.storeId}`}
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
          <FieldLabel>집계 기간</FieldLabel>
          <div className="flex flex-wrap gap-1.5">
            {tabs.map((t) => {
              const on = t.key === tab;
              return (
                <Link
                  key={t.key}
                  href={`/store?store=${storeId}&tab=${t.key}`}
                  className={`rounded-lg border px-4 py-2 text-sm font-semibold transition-colors ${
                    on
                      ? t.key === "weekly"
                        ? "border-transparent bg-weekly-soft text-weekly"
                        : "border-transparent bg-daily-soft text-daily"
                      : "border-line bg-surface text-ink-soft hover:border-ink-faint"
                  }`}
                >
                  {t.label}{" "}
                  <span className="font-normal opacity-60">{t.list.length}</span>
                </Link>
              );
            })}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <FieldLabel>{tab === "branch" ? "매장" : "분야"}</FieldLabel>
            {/* 종합(전체)이 항상 맨 앞에 옵니다 — lib/queries.ts 의 overallFirst */}
            <div className="scroll-x flex max-h-48 flex-wrap gap-1.5 overflow-y-auto rounded-lg border border-line-soft bg-surface-2 p-2">
              {list.map((c) => (
                <Pill
                  key={c.id}
                  href={href({ cat: String(c.id), date: "", n: String(PAGE_SIZE) })}
                  active={c.id === category.id}
                >
                  {tab === "branch" ? c.branch_name : c.name}
                </Pill>
              ))}
            </div>
          </div>
          <div className="shrink-0">
            <FieldLabel>날짜</FieldLabel>
            {date ? (
              <DatePicker
                dates={dates}
                value={date}
                basePath="/store"
                query={{
                  store: String(storeId),
                  tab,
                  cat: String(category.id),
                  n: String(PAGE_SIZE),
                }}
              />
            ) : (
              <p className="text-sm text-ink-faint">기록 없음</p>
            )}
          </div>
        </div>
      </Card>

      {/* ================= 순위표 ================= */}
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line-soft px-4 py-3 sm:px-5">
          <div>
            <h2 className="flex flex-wrap items-center gap-2 text-base font-bold">
              <span
                className={`rounded-md px-2 py-0.5 text-2xs font-medium ${storeMeta(storeId).chip}`}
              >
                {STORE_NAME[storeId]}
              </span>
              <span>
                {category.branch_name && `${category.branch_name} · `}
                {category.name}
              </span>
              {/* 일간과 주간은 분야 이름이 같습니다. 반드시 구분해 보여줍니다. */}
              <span
                className={`rounded-md px-2 py-0.5 text-2xs font-semibold ${periodTag.cls}`}
              >
                {periodTag.text}
              </span>
            </h2>
            {date && (
              <p className="mt-1 text-xs text-ink-soft">
                {dayLabel(date)} · 전체 {total.toLocaleString()}권 중 {rows.length}권
                {prevDate && ` · 등락은 ${prevDate} 대비`}
              </p>
            )}
          </div>
          {rows.length > 0 && (
            <ExportButton
              rows={rows}
              filename={`${STORE_NAME[storeId]}_${category.branch_name || category.name}_${
                isWeekly(category) ? "주간" : "일간"
              }_${date}`}
            />
          )}
        </div>

        {!date ? (
          <Empty title="이 분야는 아직 수집된 적이 없습니다">
            분야가 새로 추가됐거나, 서점이 목록을 바꿨을 수 있습니다.{" "}
            <Link href="/status" className="text-accent hover:underline">
              수집 상태
            </Link>
            에서 실패 기록을 확인할 수 있습니다.
          </Empty>
        ) : rows.length === 0 ? (
          <Empty title="이 날짜에는 기록이 없습니다">
            <Link href="/status" className="text-accent hover:underline">
              수집 상태
            </Link>
            에서 그날 무엇이 실패했는지 볼 수 있습니다.
          </Empty>
        ) : (
          <>
            <ul className="divide-y divide-line-soft">
              {rows.map((r) => (
                /*
                  🚨 【2026-08-18 대표님 지적 — 휴대폰 가독성】
                  예전에는 판매지수 칸이 오른쪽에서 폭 112px 를 늘 차지해서,
                  360px 화면에서 제목에 남는 자리가 60px 남짓이었습니다.
                  제목이 두세 글자씩 끊겨 내려가 읽기가 어려웠습니다.

                  이제 휴대폰에서는 판매지수를 **아랫줄 전체**로 내립니다
                  (w-full). 제목이 폭을 다 쓰고, 판매지수 막대도 길어져
                  오히려 잘 보입니다. 넓은 화면은 예전 그대로입니다.
                */
                <li
                  key={r.rank}
                  className="flex flex-wrap items-start gap-x-3 gap-y-2 px-4 py-3"
                >
                  <div className="w-11 shrink-0 text-center">
                    <RankBadge rank={r.rank} />
                    <div className="mt-1">
                      <RankChange change={r.change} isNew={r.isNew} />
                    </div>
                  </div>

                  <Cover url={r.store_book.cover_url} alt={r.store_book.raw_title} />

                  <div className="min-w-0 flex-1 basis-40">
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
                      {r.store_book.raw_publisher && ` · ${r.store_book.raw_publisher}`}
                      {r.store_book.pub_ym && ` · ${r.store_book.pub_ym}`}
                      {/* 정가 — 2026-08-11 대표님 요청.
                          여기는 '그 서점이 적어 놓은 값' 을 그대로 보여줍니다.
                          서점별 화면이라 다른 서점 값을 섞으면 안 됩니다. */}
                      {r.store_book.list_price != null &&
                        ` · ${r.store_book.list_price.toLocaleString()}원`}
                    </p>
                  </div>

                  {/* 휴대폰에서는 아랫줄 전체, 넓은 화면에서는 오른쪽 */}
                  <div className="w-full shrink-0 pl-[3.5rem] sm:w-28 sm:pl-0 sm:text-right">
                    <SalesPoint
                      value={r.sales_point}
                      storeProvides={storeMeta(storeId).hasSalesPoint}
                    />
                  </div>
                </li>
              ))}
            </ul>

            {/*
              더보기.
              【2026-08-08 대표님 지적】 "더보기를 누르면 페이지 맨위로 올라가는
              문제 없앨 것. 그자리에서 추가되게끔."
              scroll={false} 를 주면 주소만 바뀌고 보던 자리에 그대로 있습니다.
            */}
            {rows.length < total && (
              <div className="border-t border-line-soft px-4 py-3 text-center">
                <Link
                  href={href({ n: String(shown + PAGE_SIZE) })}
                  scroll={false}
                  className="inline-block rounded-lg border border-line px-4 py-2 text-sm hover:border-ink-faint"
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
