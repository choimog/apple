import Link from "next/link";
import Cover from "@/components/Cover";
import DataError from "@/components/DataError";
import ReportPopup from "@/components/ReportPopup";
import SetupNotice from "@/components/SetupNotice";
import {
  BarList,
  Card,
  CardHead,
  Empty,
  PeriodBadge,
  PeriodSwitch,
  RankBadge,
  StatTile,
} from "@/components/ui";
import { configError } from "@/lib/supabase";
import { StoreRankStrip } from "@/components/ui";
import { getReport } from "@/lib/report";
import {
  getCategoryShare,
  getCombinedBest,
  getNameRanking,
  getSnapshotDates,
  PERIOD_HELP,
  PERIOD_LABEL,
  type Period,
} from "@/lib/queries";


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
        </Empty>
      </Card>
    );
  }

  const period: Period = params.period === "weekly" ? "weekly" : "daily";
  const date = params.date && dates.includes(params.date) ? params.date : dates[0];

  // 대시보드는 한 화면에 여러 조각을 보여주므로 한꺼번에 불러옵니다
  const [best, pubs, authors, share] = await Promise.all([
    getCombinedBest(date, period, "all", { minStores: 3, limit: 10 }),
    getNameRanking("publisher", date, period, "all", { limit: 8 }),
    getNameRanking("author", date, period, "all", { limit: 8 }),
    getCategoryShare(date, period, 100),
  ]);

  // 하루 한 번 뜨는 리포트 창에 넣을 글.
  //
  // ⚠️ 리포트를 못 읽는다고 홈 화면 전체가 깨지면 안 됩니다.
  //    리포트는 '있으면 좋은 것' 이지 홈의 본체가 아닙니다.
  let report = null;
  try {
    report = await getReport();
  } catch {
    report = null;
  }

  const needSetup = !best.fast || !pubs.ok || !authors.ok || !share.ok;
  const href = (p: Period) => `/?period=${p}&date=${date}`;
  const q = `period=${period}&date=${date}`;

  return (
    <div className="space-y-5">
      {/*
        하루 한 번 뜨는 리포트 창.
        아직 리포트가 없는 날에는 아무것도 뜨지 않습니다.
      */}
      {report && (
        <ReportPopup date={report.date} body={report.body} model={report.model} />
      )}

      {/* ================= 머리말 ================= */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">오늘의 베스트셀러</h1>
          <p className="mt-1 text-sm text-ink-soft">
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
          label="3사 공통"
          value={best.rows.length ? `${best.rows.length}+` : "0"}
          unit="종"
          hint="세 서점 순위에 동시에 오른 책"
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
              <PeriodBadge period={period} withHelp />
            </span>
          }
          desc="세 서점 모두에 오른 책을 3사 순위 평균으로 줄 세웠습니다"
          right={
            <Link
              href={`/best?${q}`}
              className="shrink-0 rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink-soft hover:border-ink-faint"
            >
              전체 보기 →
            </Link>
          }
        />
        {best.rows.length === 0 ? (
          <Empty title="세 서점 모두에 오른 책이 아직 없습니다">
            <Link href={`/best?${q}&min=2`} className="text-accent hover:underline">
              2개 이상 서점 기준으로 보기
            </Link>
          </Empty>
        ) : (
          <ol className="divide-y divide-line-soft">
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
                  <p className="truncate text-xs text-ink-soft">
                    {r.author ?? "저자 정보 없음"}
                    {r.publisher && ` · ${r.publisher}`}
                  </p>
                </div>
                <div className="hidden shrink-0 sm:block">
                  <StoreRankStrip ranks={r.ranks} />
                </div>
                <span className="w-12 shrink-0 text-right text-xs text-ink-faint tnum">
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
                className="shrink-0 rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink-soft hover:border-ink-faint"
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
              }))}
              unit="종"
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
                className="shrink-0 rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink-soft hover:border-ink-faint"
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
              }))}
              unit="종"
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
              className="shrink-0 rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink-soft hover:border-ink-faint"
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
            }))}
            unit="권"
          />
        )}
      </Card>
    </div>
  );
}
