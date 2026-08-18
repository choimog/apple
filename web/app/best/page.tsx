import DataError from "@/components/DataError";
import BookRow from "@/components/BookRow";
import DatePicker from "@/components/DatePicker";
import SetupNotice from "@/components/SetupNotice";
import CategoryPicker, { PickerBar, PickerSide } from "@/components/CategoryPicker";
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
            3사 순위를 평균낸 순위입니다.
          </p>
        </div>
        <PeriodSwitch period={period} hrefFor={(p) => href({ period: p, cat: "" })} />
      </div>

      {!fast && (
        <SetupNotice what="지금은 느린 방식으로 계산하고 있습니다. 자료가 쌓일수록 더 느려집니다." />
      )}

      {/* ============ 고르기 ============ */}
      <Card className="p-4 sm:p-5">
        {/*
          분야·날짜 고르기는 [서점별]·[출판사]·[저자]와 **같은 부품**을
          씁니다 (2026-08-18 대표님 요청으로 하나로 모았습니다).
          components/CategoryPicker.tsx
        */}
        <PickerBar>
          <CategoryPicker
            items={options.map((o) => ({
              key: o.code,
              label: o.label,
              href: href({ cat: o.code }),
              title: `${o.storeCount}개 서점에 있는 분야`,
            }))}
            activeKey={unified}
          />
          <PickerSide label="날짜">
            <DatePicker
              dates={dates}
              value={date}
              basePath="/best"
              query={{ period, cat: unified, min: String(minStores) }}
            />
          </PickerSide>
        </PickerBar>

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
          <>
            {/*
              🚨 【2026-08-12 대표님 지적】
              "묶이지 않은 서점이 있는 경우에도 '순위 밖' 으로 표시하고,
               묶인 경우인데 순위에서 빠진 경우도 '순위 밖' 이라고 표시하거든?
               그래서 가끔 좀 헷갈리는데"

              둘을 갈라 놓았으니, 무슨 뜻인지도 화면에 적어 둡니다.
              말만 바꾸고 설명이 없으면 '안 묶임' 이 또 새로운 수수께끼가
              됩니다.
            */}
            <p className="border-b border-line-soft px-4 py-2 text-2xs leading-relaxed text-ink-faint sm:px-5">
              <strong className="text-ink-soft">순위 밖</strong> — 그 서점에
              이 책이 있는데 {depth}위 안에 못 들었습니다 (그 서점에서는 덜
              팔렸다는 뜻)
              <br />
              <strong className="text-ink-soft">안 묶임</strong> — 그 서점
              상품을 이 책에서 못 찾았습니다. 그 서점에 없거나, 있는데 아직
              같은 책으로 묶이지 않았습니다
            </p>
            <ul className="divide-y divide-line-soft">
              {rows.map((r, i) => (
                <BookRow key={r.bookId} row={r} position={i + 1} depth={depth} />
              ))}
            </ul>
          </>
        )}
      </Card>
    </div>
  );
}
