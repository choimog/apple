import Link from "next/link";
import Cover from "@/components/Cover";
import DataError from "@/components/DataError";
import SalesPoint from "@/components/SalesPoint";
import { configError, STORE_COLOR, STORE_NAME } from "@/lib/supabase";
import {
  getCategories,
  getCombinedBest,
  getSnapshotDates,
  unifiedOptions,
  PERIOD_HELP,
  PERIOD_LABEL,
  type Period,
} from "@/lib/queries";

// 하루 한 번 새 데이터가 들어오므로 10분마다 다시 읽습니다.
export const revalidate = 600;

const STORE_ORDER = [1, 2, 3]; // 교보 · 예스24 · 알라딘
const SALES_STORES = new Set([2, 3]); // 판매지수를 제공하는 서점

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{
    period?: string;
    cat?: string;
    date?: string;
    min?: string;
  }>;
}) {
  if (configError) return <SetupNotice message={configError} />;
  const params = await searchParams;

  let categories, dates;
  try {
    [categories, dates] = await Promise.all([getCategories(), getSnapshotDates(30)]);
  } catch (e) {
    return <DataError detail={String(e)} />;
  }

  if (!categories.length || !dates.length) {
    return <EmptyNotice categoryCount={categories.length} dateCount={dates.length} />;
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
  const { rows, depth, usedCategories } = result;

  const href = (over: Record<string, string>) => {
    const p = new URLSearchParams({
      period,
      cat: unified,
      date,
      min: String(minStores),
      ...over,
    });
    return `/?${p.toString()}`;
  };

  return (
    <div className="space-y-4">
      {/* ================= 고르기 ================= */}
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h1 className="text-lg font-bold">종합 베스트셀러</h1>
        <p className="mt-1 text-sm text-slate-600">
          교보문고·예스24·알라딘 <strong>3사의 순위를 평균</strong>해서 매긴
          순위입니다. 한 서점의 이벤트나 매대 밀어주기에 흔들리지 않습니다.
        </p>

        <Picker label="집계 기간">
          {(["daily", "weekly"] as Period[]).map((p) => (
            <Chip
              key={p}
              href={href({ period: p, cat: "" })}
              active={p === period}
              title={PERIOD_HELP[p]}
            >
              {PERIOD_LABEL[p]}
            </Chip>
          ))}
        </Picker>

        <Picker label="분야">
          {options.map((o) => (
            <Chip
              key={o.code}
              href={href({ cat: o.code })}
              active={o.code === unified}
              title={`${o.storeCount}개 서점에 있는 분야`}
            >
              {o.label}
            </Chip>
          ))}
        </Picker>

        <Picker label="날짜">
          {dates.slice(0, 14).map((d) => (
            <Chip key={d} href={href({ date: d })} active={d === date}>
              {d.slice(5)}
            </Chip>
          ))}
        </Picker>

        <Picker label="몇 개 서점에 올라야 넣을지">
          {[
            { v: 3, t: "3사 모두", h: "세 서점 전부에 오른 책만. 가장 확실합니다." },
            { v: 2, t: "2개 이상", h: "두 서점 이상. 보통 이걸 씁니다." },
            { v: 1, t: "1개도 포함", h: "한 서점에만 있어도 넣습니다. 평균의 뜻이 약해집니다." },
          ].map((m) => (
            <Chip
              key={m.v}
              href={href({ min: String(m.v) })}
              active={m.v === minStores}
              title={m.h}
            >
              {m.t}
            </Chip>
          ))}
        </Picker>
      </section>

      {/* ================= 계산 방법 (숨기지 않고 밝힙니다) ================= */}
      <details className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm">
        <summary className="cursor-pointer font-semibold text-slate-700">
          이 순위는 어떻게 계산했나요?
        </summary>
        <ul className="mt-2 space-y-1 text-slate-600">
          <li>
            · 각 서점의 <strong>{depth}위까지</strong>를 가져와서, 같은 책으로 묶인
            것끼리 모읍니다.
          </li>
          <li>
            · 한 서점 안에서 여러 분야에 올라 있으면 <strong>가장 높은 순위</strong>를
            그 서점의 값으로 씁니다.
          </li>
          <li>
            · 올라 있는 서점들의 순위를 <strong>평균</strong>냅니다. 목록에 없는 서점은
            계산에서 <strong>뺍니다</strong>. (가짜 숫자를 넣어 평균을 흐리지 않습니다)
          </li>
          <li>
            · 아직 <strong>같은 책 묶기가 안 된 책은 제외</strong>합니다. 안 그러면 같은
            책이 세 번 따로 등장합니다. 묶기는 매일 오전 9시에 돕니다.
          </li>
          <li>
            · 판매지수는 <strong>서점끼리 평균 내지 않습니다.</strong> 예스24
            &lsquo;판매지수&rsquo;와 알라딘 &lsquo;세일즈포인트&rsquo;는 계산식이 다른
            별개의 값이라 섞으면 뜻이 없어집니다. 그래서 따로 보여줍니다.
          </li>
          <li className="text-slate-500">
            · 이 분야로 쓴 목록:{" "}
            {usedCategories
              .map((c) => `${STORE_NAME[c.store_id]} ${c.name}`)
              .join(" · ") || "없음"}
          </li>
        </ul>
      </details>

      {/* ================= 순위표 ================= */}
      <section className="rounded-lg border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
          <h2 className="text-sm font-bold">
            {options.find((o) => o.code === unified)?.label ?? unified} ·{" "}
            {PERIOD_LABEL[period]} · {date}
          </h2>
          <span className="text-xs text-slate-500">{rows.length}종</span>
        </div>

        {rows.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-slate-500">
            <p>조건에 맞는 책이 없습니다.</p>
            <p className="mt-2 text-xs">
              이 날짜에 이 분야가 아직 수집되지 않았거나,
              <br />
              같은 책 묶기가 아직 안 돌았을 수 있습니다. (매일 오전 9시)
            </p>
            <Link href={href({ min: "1" })} className="mt-3 inline-block underline">
              1개 서점만 올라도 보기
            </Link>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((r, i) => (
              <li key={r.bookId} className="flex items-start gap-3 px-4 py-3">
                <div className="w-9 shrink-0 pt-1 text-center">
                  <div className="text-lg font-bold tabular-nums">{i + 1}</div>
                  <div
                    className="text-[10px] text-slate-500"
                    title="올라 있는 서점들의 순위 평균"
                  >
                    평균 {r.avgRank.toFixed(1)}
                  </div>
                </div>

                <Cover url={r.coverUrl} alt={r.title} />

                <div className="min-w-0 flex-1">
                  <Link
                    href={`/book/${r.bookId}`}
                    className="font-medium hover:underline"
                  >
                    {r.title}
                  </Link>
                  <p className="mt-0.5 text-sm text-slate-600">
                    {r.author || "저자 정보 없음"}
                    {r.publisher && ` · ${r.publisher}`}
                  </p>

                  {/* 3사 순위 + 판매지수를 한눈에 */}
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    {STORE_ORDER.map((sid) => {
                      const rank = r.ranks[sid];
                      const sales = r.sales[sid];
                      return (
                        <div
                          key={sid}
                          className={`rounded border px-2 py-1.5 ${
                            rank === undefined
                              ? "border-slate-100 bg-slate-50"
                              : "border-slate-200 bg-white"
                          }`}
                        >
                          <div className="flex items-baseline justify-between gap-1">
                            <span
                              className={`rounded px-1 py-0.5 text-[10px] ${STORE_COLOR[sid]}`}
                            >
                              {STORE_NAME[sid]}
                            </span>
                            <span className="text-sm font-bold tabular-nums">
                              {rank === undefined ? (
                                <span
                                  className="text-xs font-normal text-slate-400"
                                  title={`${depth}위 안에 없습니다`}
                                >
                                  없음
                                </span>
                              ) : (
                                `${rank}위`
                              )}
                            </span>
                          </div>
                          {rank !== undefined && (
                            <div className="mt-1">
                              <SalesPoint
                                value={sales ?? null}
                                storeProvides={SALES_STORES.has(sid)}
                                size="sm"
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Picker({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <h2 className="mb-1.5 mt-4 text-xs font-semibold text-slate-500">{label}</h2>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </>
  );
}

function Chip({
  href,
  active,
  title,
  children,
}: {
  href: string;
  active: boolean;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      title={title}
      className={`rounded-full border px-3 py-1 text-xs ${
        active
          ? "border-slate-900 bg-slate-900 text-white"
          : "border-slate-300 bg-white text-slate-700 hover:border-slate-500"
      }`}
    >
      {children}
    </Link>
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

function EmptyNotice({
  categoryCount,
  dateCount,
}: {
  categoryCount: number;
  dateCount: number;
}) {
  return (
    <div className="rounded-lg border border-slate-300 bg-white p-6">
      <h1 className="text-base font-bold">아직 수집된 데이터가 없습니다</h1>
      <p className="mt-2 text-sm text-slate-600">
        분야 {categoryCount}개 · 수집된 날짜 {dateCount}일
      </p>
      <p className="mt-2 text-sm text-slate-600">
        GitHub → Actions → <strong>매일 수집 (daily crawl)</strong> 에서 실행 결과를
        확인하세요. 데이터가 없으면 없다고 표시합니다. 가짜로 채우지 않습니다.
      </p>
    </div>
  );
}
