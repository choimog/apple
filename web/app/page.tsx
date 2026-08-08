import Link from "next/link";
import Cover from "@/components/Cover";
import DataError from "@/components/DataError";
import SetupNotice from "@/components/SetupNotice";
import {
  BarList,
  Card,
  CardHead,
  Empty,
  PeriodSwitch,
  RankBadge,
  StatTile,
} from "@/components/ui";
import { configError, STORE_COLOR, STORE_NAME } from "@/lib/supabase";
import {
  getCategoryShare,
  getCombinedBest,
  getNameRanking,
  getSnapshotDates,
  PERIOD_HELP,
  PERIOD_LABEL,
  type Period,
} from "@/lib/queries";

export const revalidate = 600;

const STORE_ORDER = [1, 2, 3];

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; date?: string }>;
}) {
  if (configError) {
    return (
      <div className="rounded-xl border border-amber-300 bg-amber-50 p-6 text-sm text-amber-800">
        {configError}
      </div>
    );
  }
  const params = await searchParams;

  let dates;
  try {
    dates = await getSnapshotDates(30);
  } catch (e) {
    return <DataError detail={String(e)} />;
  }
  if (!dates.length) {
    return (
      <Card>
        <Empty>
          아직 수집된 데이터가 없습니다.
          <br />
          GitHub → Actions → <strong>매일 수집 (daily crawl)</strong> 에서 실행
          결과를 확인하세요.
        </Empty>
      </Card>
    );
  }

  const period: Period = params.period === "weekly" ? "weekly" : "daily";
  const date = params.date && dates.includes(params.date) ? params.date : dates[0];

  // 대시보드는 한 화면에 여러 조각을 보여주므로 한꺼번에 불러옵니다
  const [best, pubs, authors, share] = await Promise.all([
    getCombinedBest(date, period, "all", { minStores: 2, limit: 10 }),
    getNameRanking("publisher", date, period, "all", { limit: 8 }),
    getNameRanking("author", date, period, "all", { limit: 8 }),
    getCategoryShare(date, period, 100),
  ]);

  const needSetup = !best.fast || !pubs.ok || !authors.ok || !share.ok;
  const href = (p: Period) => `/?period=${p}&date=${date}`;
  const q = `period=${period}&date=${date}`;

  return (
    <div className="space-y-5">
      {/* ================= 머리말 ================= */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">오늘의 베스트셀러</h1>
          <p className="mt-1 text-sm text-slate-600">
            교보문고 · 예스24 · 알라딘 <strong>{date}</strong> 기준
          </p>
        </div>
        <PeriodSwitch period={period} hrefFor={href} />
      </div>

      {needSetup && (
        <SetupNotice what="아래 일부 화면은 데이터베이스 계산 기능이 있어야 값이 나옵니다." />
      )}

      {/* ================= 한눈 요약 ================= */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile
          label="집계 기간"
          value={PERIOD_LABEL[period]}
          hint={PERIOD_HELP[period]}
        />
        <StatTile
          label="3사 공통 상위권"
          value={best.rows.length ? `${best.rows.length}+` : "0"}
          unit="종"
          hint="2개 이상 서점 순위에 동시에 오른 책"
        />
        <StatTile
          label="가장 센 분야"
          value={share.rows[0]?.label ?? "–"}
          hint="종합 상위 100권을 가장 많이 차지한 분야"
        />
        <StatTile
          label="수집된 날짜"
          value={dates.length}
          unit="일"
          hint="수집이 실패한 날은 세지 않습니다"
        />
      </div>

      {/* ================= 종합 TOP 10 ================= */}
      <Card>
        <CardHead
          title={
            <span className="flex flex-wrap items-center gap-2">
              종합 베스트셀러 TOP 10
              <span
                className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${
                  period === "weekly"
                    ? "bg-violet-100 text-violet-800"
                    : "bg-sky-100 text-sky-800"
                }`}
              >
                {PERIOD_LABEL[period]}
              </span>
            </span>
          }
          desc="3사 순위를 평균낸 결과 · 2개 이상 서점에 오른 책"
          right={
            <Link
              href={`/best?${q}`}
              className="shrink-0 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:border-slate-400"
            >
              전체 보기 →
            </Link>
          }
        />
        {best.rows.length === 0 ? (
          <Empty>
            아직 3사에 걸쳐 묶인 책이 없습니다.
            <br />
            <span className="text-xs">
              같은 책 묶기는 매일 오전 9시에 돕니다.
            </span>
          </Empty>
        ) : (
          <ol className="divide-y divide-slate-100">
            {best.rows.map((r, i) => (
              <li key={r.bookId} className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
                <RankBadge rank={i + 1} size="sm" />
                <Cover url={r.coverUrl} alt={r.title} className="h-12 w-8" />
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/book/${r.bookId}`}
                    className="block truncate text-sm font-semibold hover:underline"
                  >
                    {r.title}
                  </Link>
                  <p className="truncate text-xs text-slate-500">
                    {r.author ?? "저자 정보 없음"}
                    {r.publisher && ` · ${r.publisher}`}
                  </p>
                </div>
                <div className="hidden shrink-0 gap-1 sm:flex">
                  {STORE_ORDER.map((sid) => (
                    <span
                      key={sid}
                      className={`rounded px-1.5 py-0.5 text-[10px] tabular-nums ${
                        r.ranks[sid] !== undefined
                          ? STORE_COLOR[sid]
                          : "bg-slate-50 text-slate-300"
                      }`}
                      title={
                        r.ranks[sid] !== undefined
                          ? `${STORE_NAME[sid]} ${r.ranks[sid]}위`
                          : `${STORE_NAME[sid]} 순위 밖`
                      }
                    >
                      {r.ranks[sid] !== undefined ? r.ranks[sid] : "–"}
                    </span>
                  ))}
                </div>
                <span className="w-12 shrink-0 text-right text-xs text-slate-400 tabular-nums">
                  평균 {r.avgRank.toFixed(1)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </Card>

      {/* ================= 출판사 · 저자 ================= */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHead
            title="출판사 TOP 8"
            desc="상위권을 많이 차지한 순서"
            right={
              <Link
                href={`/publishers?${q}`}
                className="shrink-0 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:border-slate-400"
              >
                전체 →
              </Link>
            }
          />
          {pubs.rows.length === 0 ? (
            <Empty>아직 자료가 없습니다.</Empty>
          ) : (
            <BarList
              items={pubs.rows.map((r) => ({
                key: r.name,
                label: r.name,
                value: r.books,
                note: "종",
              }))}
              hrefFor={(k) => `/publisher/${encodeURIComponent(k)}?${q}`}
            />
          )}
        </Card>

        <Card>
          <CardHead
            title="저자 TOP 8"
            desc="상위권을 많이 차지한 순서"
            right={
              <Link
                href={`/authors?${q}`}
                className="shrink-0 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:border-slate-400"
              >
                전체 →
              </Link>
            }
          />
          {authors.rows.length === 0 ? (
            <Empty>아직 자료가 없습니다.</Empty>
          ) : (
            <BarList
              items={authors.rows.map((r) => ({
                key: r.name,
                label: r.name,
                value: r.books,
                note: "종",
              }))}
              hrefFor={(k) => `/author/${encodeURIComponent(k)}?${q}`}
            />
          )}
        </Card>
      </div>

      {/* ================= 분야 분석 ================= */}
      <Card>
        <CardHead
          title="어떤 분야가 상위권을 채우고 있나"
          desc="종합 상위 100권이 각 분야 목록에 몇 권 걸쳐 있는지 (비율 아님)"
          right={
            <Link
              href={`/insights?${q}`}
              className="shrink-0 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:border-slate-400"
            >
              자세히 →
            </Link>
          }
        />
        {share.rows.length === 0 ? (
          <Empty>아직 자료가 없습니다.</Empty>
        ) : (
          <BarList
            items={share.rows.slice(0, 8).map((r) => ({
              key: r.code,
              label: r.label,
              value: r.books,
              note: "권",
            }))}
          />
        )}
      </Card>
    </div>
  );
}
