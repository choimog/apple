import DataError from "@/components/DataError";
import BookRow from "@/components/BookRow";
import SetupNotice from "@/components/SetupNotice";
import {
  Card,
  CardHead,
  Empty,
  FieldLabel,
  PeriodSwitch,
  Pill,
} from "@/components/ui";
import { configError, STORE_NAME } from "@/lib/supabase";
import {
  getCategories,
  getCombinedBest,
  getSnapshotDates,
  unifiedOptions,
  PERIOD_HELP,
  PERIOD_LABEL,
  type Period,
} from "@/lib/queries";

export const revalidate = 600;

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
    [categories, dates] = await Promise.all([getCategories(), getSnapshotDates(30)]);
  } catch (e) {
    return <DataError detail={String(e)} />;
  }
  if (!categories.length || !dates.length) {
    return (
      <Card>
        <Empty>
          아직 수집된 데이터가 없습니다. (분야 {categories.length}개 · 날짜{" "}
          {dates.length}일)
        </Empty>
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
  const minStores = params.min === "3" ? 3 : params.min === "1" ? 1 : 2;

  let result;
  try {
    result = await getCombinedBest(date, period, unified, { minStores, limit: 100 });
  } catch (e) {
    return <DataError detail={String(e)} />;
  }
  const { rows, depth, usedCategories, fast } = result;
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
      {/* ============ 이 화면이 무엇인지 ============ */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-blue-700">
            순위 · 종합
          </p>
          <h1 className="mt-0.5 text-2xl font-bold tracking-tight">종합 베스트셀러</h1>
          <p className="mt-1 text-sm text-slate-600">
            교보문고·예스24·알라딘 <strong>3사의 순위를 평균</strong>낸 순위입니다.
            한 서점의 이벤트나 매대 밀어주기에 흔들리지 않습니다.
          </p>
        </div>
        <PeriodSwitch period={period} hrefFor={(p) => href({ period: p, cat: "" })} />
      </div>

      {!fast && (
        <SetupNotice what="지금은 느린 방식으로 계산하고 있습니다. 자료가 쌓일수록 더 느려집니다." />
      )}

      {/* ============ 고르기 ============ */}
      <Card className="p-4 sm:p-5">
        <FieldLabel>분야</FieldLabel>
        <div className="flex flex-wrap gap-1.5">
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

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <FieldLabel>날짜</FieldLabel>
            <div className="flex flex-wrap gap-1.5">
              {dates.slice(0, 10).map((d) => (
                <Pill key={d} href={href({ date: d })} active={d === date}>
                  {d.slice(5)}
                </Pill>
              ))}
            </div>
          </div>
          <div>
            <FieldLabel>몇 개 서점에 올라야 넣을지</FieldLabel>
            <div className="flex flex-wrap gap-1.5">
              {[
                { v: 3, t: "3사 모두", h: "세 서점 전부에 오른 책만. 가장 확실합니다." },
                { v: 2, t: "2개 이상", h: "두 서점 이상. 보통 이걸 씁니다." },
                { v: 1, t: "1개도 포함", h: "한 서점에만 있어도 넣습니다." },
              ].map((m) => (
                <Pill
                  key={m.v}
                  href={href({ min: String(m.v) })}
                  active={m.v === minStores}
                  title={m.h}
                >
                  {m.t}
                </Pill>
              ))}
            </div>
          </div>
        </div>
      </Card>

      {/* ============ 순위표 ============ */}
      <Card>
        <CardHead
          title={
            <span className="flex flex-wrap items-center gap-2">
              {label}
              <span
                className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${
                  period === "weekly"
                    ? "bg-violet-100 text-violet-800"
                    : "bg-sky-100 text-sky-800"
                }`}
              >
                {PERIOD_LABEL[period]} · {PERIOD_HELP[period]}
              </span>
            </span>
          }
          desc={`${date} 기준 · ${rows.length}종 · 각 서점 ${depth}위까지 봄`}
        />

        {rows.length === 0 ? (
          <Empty>
            <p>조건에 맞는 책이 없습니다.</p>
            <p className="mt-2 text-xs">
              이 날짜에 이 분야가 아직 수집되지 않았거나, 같은 책 묶기가 아직 안
              돌았을 수 있습니다. (매일 오전 9시)
            </p>
          </Empty>
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((r, i) => (
              <BookRow key={r.bookId} row={r} position={i + 1} depth={depth} />
            ))}
          </ul>
        )}
      </Card>

      {/* ============ 계산 방법 ============ */}
      <details className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm sm:px-5">
        <summary className="cursor-pointer font-semibold text-slate-700">
          이 순위는 어떻게 계산했나요?
        </summary>
        <ul className="mt-2 space-y-1 text-slate-600">
          <li>
            · 각 서점의 <strong>{depth}위까지</strong>를 가져와, 같은 책으로 묶인
            것끼리 모읍니다.
          </li>
          <li>
            · 한 서점 안에서 여러 분야에 올라 있으면 <strong>가장 높은 순위</strong>
            를 그 서점의 값으로 씁니다.
          </li>
          <li>
            · 올라 있는 서점들의 순위를 <strong>평균</strong>냅니다. 목록에 없는
            서점은 계산에서 <strong>뺍니다</strong>. 가짜 순위를 넣어 평균을 흐리지
            않습니다.
          </li>
          <li>
            · 아직 <strong>같은 책 묶기가 안 된 책은 제외</strong>합니다. 안 그러면
            같은 책이 세 번 따로 등장합니다.
          </li>
          <li>
            · 판매지수는 <strong>서점끼리 평균 내지 않습니다.</strong> 예스24
            &lsquo;판매지수&rsquo;와 알라딘 &lsquo;세일즈포인트&rsquo;는 계산식이
            다른 별개의 값이라 섞으면 뜻이 없어집니다.
          </li>
          <li className="text-slate-500">
            · 이 분야로 쓴 목록:{" "}
            {usedCategories
              .map((c) => `${STORE_NAME[c.store_id]} ${c.name}`)
              .join(" · ") || "없음"}
          </li>
        </ul>
      </details>
    </div>
  );
}
