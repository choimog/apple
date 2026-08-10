import DataError from "@/components/DataError";
import BookRow from "@/components/BookRow";
import DatePicker from "@/components/DatePicker";
import SetupNotice from "@/components/SetupNotice";
import {
  Card,
  CardHead,
  Empty,
  FieldLabel,
  PeriodBadge,
  PeriodSwitch,
  Pill,
} from "@/components/ui";
import { configError } from "@/lib/supabase";
import {
  getCategories,
  getCombinedBest,
  getSnapshotDates,
  unifiedOptions,
  type Period,
} from "@/lib/queries";
import { dayLabel } from "@/lib/format";

export const metadata = { title: "종합 순위" };


export default async function BestPage({
  searchParams,
}: {
  searchParams: Promise<{
    period?: string;
    cat?: string;
    date?: string;
    min?: string;
  }>;
}) {
  if (configError) {
    return (
      <div className="rounded-xl border border-amber-300 bg-amber-50 p-6 text-sm text-amber-800">
        {configError}
      </div>
    );
  }
  const params = await searchParams;

  let categories, dates;
  try {
    [categories, dates] = await Promise.all([getCategories(), getSnapshotDates(400)]);
  } catch (e) {
    return <DataError detail={String(e)} />;
  }
  if (!categories.length || !dates.length) {
    return (
      <Card>
        <Empty>아직 수집된 데이터가 없습니다.</Empty>
      </Card>
    );
  }

  const period: Period = params.period === "weekly" ? "weekly" : "daily";
  const date = params.date && dates.includes(params.date) ? params.date : dates[0];
  const options = unifiedOptions(categories, period);
  const unified =
    params.cat && options.some((o) => o.code === params.cat)
      ? params.cat
      : (options[0]?.code ?? "all");
  // 기본값은 '3사 모두'. 세 서점 전부에 오른 책이 가장 확실합니다.
  const minStores = params.min === "1" ? 1 : params.min === "2" ? 2 : 3;

  let result;
  try {
    result = await getCombinedBest(date, period, unified, { minStores, limit: 100 });
  } catch (e) {
    return <DataError detail={String(e)} />;
  }
  const { rows, depth, fast } = result;
  const label = options.find((o) => o.code === unified)?.label ?? unified;

  const href = (over: Record<string, string>) => {
    const p = new URLSearchParams({
      period,
      cat: unified,
      date,
      min: String(minStores),
      ...over,
    });
    return `/best?${p.toString()}`;
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">종합 베스트셀러</h1>
          <p className="mt-1 text-sm text-ink-soft">
            교보문고·예스24·알라딘 3사의 순위를 평균낸 순위입니다.
          </p>
        </div>
        <PeriodSwitch period={period} hrefFor={(p) => href({ period: p, cat: "" })} />
      </div>

      {!fast && (
        <SetupNotice what="지금은 느린 방식으로 계산하고 있습니다. 자료가 쌓일수록 더 느려집니다." />
      )}

      {/* ============ 고르기 ============ */}
      <Card className="p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <FieldLabel>분야</FieldLabel>
            {/*
              【2026-08-09 대표님 요청】
              "분야별 버튼도 모바일 서점별에서 보이는 것처럼 스크롤 형식으로"

              예전에는 그냥 줄바꿈이라, 휴대폰에서 분야가 20개쯤 되면
              화면 절반이 버튼으로 덮여서 정작 순위표가 안 보였습니다.
              [서점별] 화면과 **똑같은** 방식으로 바꿉니다 —
              높이를 정해 두고 그 안에서만 스크롤합니다.
            */}
            <div className="scroll-x flex max-h-48 flex-wrap gap-1.5 overflow-y-auto rounded-lg border border-line-soft bg-surface-2 p-2">
              {options.map((o) => (
                <Pill
                  key={o.code}
                  href={href({ cat: o.code })}
                  active={o.code === unified}
                  title={`${o.storeCount}개 서점에 있는 분야`}
                >
                  {o.label}
                </Pill>
              ))}
            </div>
          </div>
          <div className="shrink-0">
            <FieldLabel>날짜</FieldLabel>
            <DatePicker
              dates={dates}
              value={date}
              basePath="/best"
              query={{ period, cat: unified, min: String(minStores) }}
            />
          </div>
        </div>

        <div className="mt-4">
          <FieldLabel>몇 개 서점에 올라야 넣을지</FieldLabel>
          <div className="flex flex-wrap gap-1.5">
            {[
              { v: 3, t: "3사 모두" },
              { v: 2, t: "2개 이상" },
              { v: 1, t: "1개도 포함" },
            ].map((m) => (
              <Pill
                key={m.v}
                href={href({ min: String(m.v) })}
                active={m.v === minStores}
              >
                {m.t}
              </Pill>
            ))}
          </div>
        </div>
      </Card>

      {/* ============ 순위표 ============ */}
      <Card>
        <CardHead
          title={
            <span className="flex flex-wrap items-center gap-2">
              {label}
              <PeriodBadge period={period} withHelp />
            </span>
          }
          desc={`${dayLabel(date)} · ${rows.length}종`}
        />

        {rows.length === 0 ? (
          <Empty title="조건에 맞는 책이 없습니다">
            서점 조건을 <strong>2개 이상</strong>으로 낮추면 더 많이 나옵니다.
          </Empty>
        ) : (
          <ul className="divide-y divide-line-soft">
            {rows.map((r, i) => (
              <BookRow key={r.bookId} row={r} position={i + 1} depth={depth} />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
