import Link from "next/link";
import BookExportButton from "@/components/BookExportButton";
import Cover from "@/components/Cover";
import DataError from "@/components/DataError";
import SalesPoint from "@/components/SalesPoint";
import TrendChart from "@/components/TrendChart";
import {
  Card,
  CardHead,
  Empty,
  NoValue,
  PageHead,
  PeriodBadge,
  RankBadge,
} from "@/components/ui";
import { configError } from "@/lib/supabase";
import { store, STORE_ORDER, type StoreId } from "@/lib/stores";

/** 판매지수를 공개하는 서점 (예스24 · 알라딘). 교보는 목록에 안 냅니다 */
const SALES_STORES: StoreId[] = STORE_ORDER.filter((s) => store(s).hasSalesPoint);
import { dayLabel, num } from "@/lib/format";
import {
  getBookDetail,
  PERIOD_HELP,
  PERIOD_LABEL,
  type CurrentPlacement,
  type Period,
} from "@/lib/queries";


/** 순위를 어느 기준으로 볼지 */
type Basis = "overall" | "category";

export default async function BookPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ basis?: string }>;
}) {
  if (configError) {
    return (
      <div className="rounded-2xl border border-amber-300 bg-amber-50 p-6 text-sm text-amber-900">
        {configError}
      </div>
    );
  }

  const { id } = await params;
  const sp = await searchParams;
  let detail;
  try {
    detail = await getBookDetail(Number(id));
  } catch (e) {
    return <DataError detail={String(e)} />;
  }
  const { stores, history: allHistory, placements, latestDate } = detail;

  /*
    【2026-08-10 대표님 지적】
    "분야에서 순위권에 있다가 종합 순위에 오르기 시작하면 어떡하려고
     그래? 이걸 선택할 수 있도록 해주면 좋지 않을까?"

    맞는 지적이었습니다. 예전에는 하루에 한 점만 남기면서 '종합이 있으면
    종합, 없으면 분야' 를 골랐습니다. 그러면 어제까지 '소설 3위' 로
    그리다가 오늘 종합에 처음 들면 '종합 150위' 가 됩니다. 그래프는
    **폭락처럼** 보이는데, 실제로는 더 잘 팔려서 종합에 든 것입니다.

    이제 두 기준을 따로 그립니다. 기본은 종합이고, 종합에 한 번도
    오른 적이 없으면 분야로 시작합니다. 한쪽밖에 없으면 고르는 버튼을
    아예 보여주지 않습니다 (누를 것이 없는 버튼은 방해만 됩니다).
  */
  const hasOverall = allHistory.some((h) => h.isOverall);
  const hasCategory = allHistory.some((h) => !h.isOverall);
  const basis: Basis =
    sp.basis === "category" && hasCategory
      ? "category"
      : sp.basis === "overall" && hasOverall
        ? "overall"
        : hasOverall
          ? "overall"
          : "category";

  const history = allHistory.filter((h) =>
    basis === "overall" ? h.isOverall : !h.isOverall
  );

  /*
    판매지수는 **기준과 상관없습니다.** 서점이 책 한 권에 하나씩 매기는
    값이라, 종합에 올랐든 분야에만 올랐든 같은 숫자입니다.
    그래서 기준으로 거르면 안 됩니다 — 거르면 그날 값이 통째로 사라져
    그래프에 없는 구멍이 생깁니다.
  */
  const salesSeen = new Set<string>();
  const salesHistory = allHistory.filter((h) => {
    const k = `${h.date}|${h.storeId}|${h.period}`;
    if (salesSeen.has(k)) return false;
    salesSeen.add(k);
    return true;
  });

  if (!stores.length) {
    return (
      <Card>
        <Empty title="해당 도서를 찾을 수 없습니다">
          주소가 잘못되었거나, 아직 같은 책 묶기가 되지 않은 책일 수 있습니다.
          <div className="mt-3">
            <Link href="/search" className="text-accent hover:underline">
              → 도서 검색으로 찾아보기
            </Link>
          </div>
        </Empty>
      </Card>
    );
  }

  // 표지 우선순위: 알라딘(3) → 예스24(2) → 교보(1)
  const main =
    [3, 2, 1].map((s) => stores.find((b) => b.store_id === s && b.cover_url)).find(Boolean) ??
    stores[0];

  // 최신 날짜의 대표 순위 (서점 × 기간)
  //
  // 【2026-08-09 대표님 지적】
  // "위에 보이는 3사의 순위가 무슨 순위를 기준으로 나타내는지 표시해줄 필요"
  //
  // 한 책이 하루에 '종합'·'소설'·'한국소설' 여러 곳에 오릅니다. 여기서는
  // 그중 **가장 높은 순위 하나**만 보여주는데, 어느 목록에서 나온
  // 숫자인지 안 적으면 "3위" 가 종합 3위인지 세부분야 3위인지 알 수 없습니다.
  // 같은 3위라도 뜻이 완전히 다릅니다. 그래서 분야 이름을 함께 담습니다.
  //
  // 【2026-08-09 대표님 지시】
  // "종합 순위에 올라있을 시 종합 순위를 우선적으로 표기해줘."
  // 그 고르기는 lib/queries.ts 에서 이미 끝났습니다 (종합이 있으면 종합).
  // 여기서는 최신 날짜 것만 꺼내 옵니다.
  const latest = new Map<
    string,
    { rank: number; sales: number | null; categoryName: string; isOverall: boolean }
  >();
  for (const h of history) {
    if (h.date !== latestDate) continue;
    latest.set(`${h.storeId}|${h.period}`, {
      rank: h.rank,
      sales: h.sales,
      categoryName: h.categoryName,
      isOverall: h.isOverall,
    });
  }

  /*
    【2026-08-09 대표님 요청】
    "종합 순위가 나온 건 좋아. 거기에 함께 작게 분야 중 가장 상위에
     속하는 순위도 함께 나열됐으면 좋겠어."

    위의 latest 는 '대표 순위' 하나입니다 (종합이 있으면 종합).
    여기서는 그것과 **별도로**, 세부분야 중 가장 높은 것을 따로 찾습니다.
    placements 에 그날 올라 있는 목록이 전부 들어 있으므로 새 조회는
    필요 없습니다.

    ⚠️ 매장별(offline)은 뺍니다. 온라인 순위와 성격이 달라 나란히 두면
       "교보 3위" 가 매장 3위인지 온라인 3위인지 헷갈립니다.
  */
  const topCategory = new Map<string, { rank: number; name: string }>();
  for (const pl of placements) {
    if (pl.isOverall || pl.branchName) continue; // 종합·매장별 제외
    const k = `${pl.storeId}|${pl.period}`;
    const cur = topCategory.get(k);
    if (!cur || pl.rank < cur.rank) {
      topCategory.set(k, { rank: pl.rank, name: pl.categoryName });
    }
  }

  const online = placements.filter((p) => !p.branchName);
  const branches = placements.filter((p) => p.branchName);
  const hasSales = salesHistory.some((h) => h.sales !== null);

  return (
    <div className="space-y-5">
      {/* ═══════════ 도서 정보 ═══════════ */}
      <Card className="p-4 sm:p-5">
        <div className="flex items-start gap-4 sm:gap-5">
          <Cover
            url={main.cover_url}
            alt={main.raw_title}
            className="h-[132px] w-[92px] sm:h-40 sm:w-28"
          />
          <div className="min-w-0 flex-1">
            <PageHead
              eyebrow="도서"
              title={main.raw_title}
              lead={
                <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  {main.raw_author ? (
                    <Link
                      href={`/author/${encodeURIComponent(main.raw_author)}`}
                      className="font-medium text-ink hover:underline"
                    >
                      {main.raw_author}
                    </Link>
                  ) : (
                    <span className="text-ink-faint">저자 정보 없음</span>
                  )}
                  {main.raw_publisher && (
                    <>
                      <span className="text-ink-faint">·</span>
                      <Link
                        href={`/publisher/${encodeURIComponent(main.raw_publisher)}`}
                        className="font-medium text-ink hover:underline"
                      >
                        {main.raw_publisher}
                      </Link>
                    </>
                  )}
                  {main.pub_ym && (
                    <>
                      <span className="text-ink-faint">·</span>
                      <span>{main.pub_ym}</span>
                    </>
                  )}
                </span>
              }
            />
            <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-faint">
              <span>{stores.length}개 서점에서 발견</span>
              {latestDate && <span>최근 기록 {dayLabel(latestDate)}</span>}
              <span>
                {main.isbn13 ? (
                  `ISBN ${main.isbn13}`
                ) : (
                  <NoValue
                    label="ISBN 없음"
                    why="목록 페이지에 ISBN 을 노출하는 서점은 교보문고뿐입니다. 상세 페이지에는 들어가지 않으므로 추정하지 않습니다."
                  />
                )}
              </span>
            </p>
          </div>
        </div>
      </Card>

      {/* ═══════════ 지금 순위 ═══════════ */}
      <Card>
        <CardHead
          title="지금 순위"
          desc={
            latestDate
              ? `${dayLabel(latestDate)} · 종합(전체) 목록에 있으면 그 순위, 없으면 가장 높이 오른 분야의 순위입니다`
              : "순위 기록이 없습니다"
          }
        />
        <div className="grid gap-3 p-4 sm:grid-cols-3 sm:p-5">
          {STORE_ORDER.map((sid: StoreId) => {
            const s = store(sid);
            const d = latest.get(`${sid}|daily`);
            const w = latest.get(`${sid}|weekly`);
            const none = !d && !w;
            return (
              <div
                key={sid}
                className={`rounded-xl border p-3 ${
                  none ? "border-dashed border-line bg-surface-2/50" : "border-line"
                }`}
              >
                <span className={`rounded-md px-2 py-0.5 text-2xs font-medium ${s.chip}`}>
                  {s.name}
                </span>
                <dl className="mt-2.5 space-y-1.5">
                  {(["daily", "weekly"] as Period[]).map((p) => {
                    const cell = p === "daily" ? d : w;
                    const top = topCategory.get(`${sid}|${p}`);
                    // 대표 순위가 이미 그 분야면 같은 줄을 두 번 보여주지 않습니다
                    const showTop =
                      top && (cell?.isOverall || top.name !== cell?.categoryName);
                    return (
                      <div key={p} className="flex items-baseline justify-between gap-2">
                        <dt>
                          <PeriodBadge period={p} />
                        </dt>
                        <dd className="min-w-0 text-right">
                          {cell ? (
                            <>
                              <span className="tnum text-lg font-bold">
                                {cell.rank}위
                              </span>
                              {/*
                                어느 목록에서 나온 순위인지 반드시 적습니다.
                                '종합 3위' 와 '한국소설 3위' 는 완전히 다릅니다.
                              */}
                              {/*
                                종합이면 눈에 띄게, 세부분야면 옅게.
                                '종합 3위' 와 '한국소설 3위' 는 완전히 다릅니다.
                              */}
                              <span
                                className={`block truncate text-2xs ${
                                  cell.isOverall
                                    ? "font-semibold text-ink-soft"
                                    : "text-ink-faint"
                                }`}
                              >
                                {cell.isOverall ? "종합 기준" : `${cell.categoryName} 기준`}
                              </span>
                              {/* 분야 중 가장 높은 순위 — 작게 함께 (대표님 요청) */}
                              {showTop && top && (
                                <span className="block truncate text-2xs text-ink-faint">
                                  {top.name} <span className="tnum">{top.rank}위</span>
                                </span>
                              )}
                            </>
                          ) : (
                            <NoValue
                              label="순위 밖"
                              why="이 날짜에 그 서점의 순위 목록에 없었습니다"
                            />
                          )}
                        </dd>
                      </div>
                    );
                  })}
                </dl>
                <div className="mt-2.5 border-t border-line-soft pt-2">
                  <div className="text-2xs text-ink-faint">{s.salesLabel}</div>
                  <SalesPoint
                    value={d?.sales ?? w?.sales ?? null}
                    storeProvides={s.hasSalesPoint}
                    size="sm"
                  />
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* ═══════════ 순위 추이 ═══════════
          【2026-08-09 대표님 지적】
          "일간 판매지수와 주간 판매지수가 똑같은데 두개를 굳이 보여주기보단,
           순위를 양옆으로 배치하고, 빈 자리에 차라리 알라딘과 예스의 지수를
           나누어서 양옆으로 배치해서 보여줘."

          맞습니다. 판매지수는 서점이 **책 한 권에 하나**만 매기는 값이라,
          일간 목록에서 보든 주간 목록에서 보든 같은 숫자입니다.
          같은 그림을 두 번 그리고 있었습니다.

          그래서 이렇게 바꿉니다.
            순위 추이    → 일간 | 주간      (기간을 비교)
            판매지수 추이 → 예스24 | 알라딘  (서점을 비교) */}
      <Card>
        <CardHead
          title="순위 추이"
          desc={
            basis === "overall"
              ? "종합(전체) 순위 기준 · 위로 갈수록 높은 순위 · 최근 30일"
              : "분야 순위 기준 · 위로 갈수록 높은 순위 · 최근 30일"
          }
          right={
            <BookExportButton
              history={history}
              title={main.raw_title}
              author={main.raw_author}
              publisher={main.raw_publisher}
            />
          }
        />

        {/* 어느 기준으로 볼지 — 둘 다 있을 때만 보여줍니다 */}
        {hasOverall && hasCategory && (
          <div className="border-b border-line-soft px-4 py-2.5 sm:px-5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-ink-soft">
                무슨 순위로 볼까요
              </span>
              <div className="flex gap-1.5">
                <BasisChip id={id} basis="overall" on={basis === "overall"}>
                  종합(전체)
                </BasisChip>
                <BasisChip id={id} basis="category" on={basis === "category"}>
                  분야
                </BasisChip>
              </div>
            </div>
            <p className="mt-1.5 text-2xs leading-relaxed text-ink-faint">
              두 기준을 한 줄에 섞으면 그 줄은 아무 뜻도 없습니다. 분야에서
              3위이던 책이 종합에 처음 들면 150위가 되는데, 그래프만 보면
              폭락처럼 보이지만 실제로는 <strong>더 잘 팔려서</strong> 종합에
              든 것입니다. 그래서 따로 그립니다.
            </p>
          </div>
        )}
        <div className="grid divide-y divide-line-soft lg:grid-cols-2 lg:divide-x lg:divide-y-0">
          {(["daily", "weekly"] as Period[]).map((p) => (
            <div key={p}>
              <div className="flex items-center gap-2 px-4 pt-3 text-sm font-semibold sm:px-5">
                <PeriodBadge period={p} withHelp />
              </div>
              <TrendChart history={history} period={p} metric="rank" />
            </div>
          ))}
        </div>
      </Card>

      {/* ═══════════ 판매지수 추이 ═══════════ */}
      <Card>
        <CardHead
          title="판매지수 추이"
          desc="서점마다 기준이 다릅니다. 한 화면에 합치지 않고 나란히 둡니다"
        />
        {!hasSales ? (
          <Empty title="판매지수를 공개하는 서점이 없습니다">
            교보문고는 판매지수를 목록에 공개하지 않습니다. 예스24·알라딘에서
            이 책이 순위에 들면 여기에 그래프가 생깁니다.
          </Empty>
        ) : (
          <div className="grid divide-y divide-line-soft lg:grid-cols-2 lg:divide-x lg:divide-y-0">
            {SALES_STORES.map((sid) => {
              const s = store(sid);
              const mine = salesHistory.filter((h) => h.storeId === sid);
              // 판매지수는 일간·주간이 같은 값이므로 한쪽만 그립니다.
              // 일간 기록이 없는 책도 있어 그때는 주간을 씁니다.
              const hasDaily = mine.some(
                (h) => h.period === "daily" && h.sales !== null
              );
              return (
                <div key={sid}>
                  <div className="flex items-center gap-2 px-4 pt-3 text-sm font-semibold sm:px-5">
                    <span className={`rounded-md px-2 py-0.5 text-2xs font-medium ${s.chip}`}>
                      {s.name}
                    </span>
                    <span className="font-normal text-ink-faint">{s.salesLabel}</span>
                  </div>
                  <TrendChart
                    history={mine}
                    period={hasDaily ? "daily" : "weekly"}
                    metric="sales"
                  />
                </div>
              );
            })}
          </div>
        )}
        <p className="border-t border-line-soft px-4 py-2.5 text-2xs leading-relaxed text-ink-faint sm:px-5">
          판매지수는 서점이 책 한 권에 하나씩 매기는 값이라 일간·주간이 같습니다.
          그래서 기간별로 나누지 않고 <strong>서점별</strong>로 나눠 보여줍니다.
          두 서점의 숫자는 계산 방식이 달라 <strong>서로 비교하면 안 됩니다.</strong>
        </p>
      </Card>

      {/* ═══════════ 올라 있는 목록 ═══════════ */}
      <PlacementCard rows={online} />

      {branches.length > 0 && (
        <Card>
          <CardHead
            title="올라 있는 교보문고 매장"
            desc={`${branches.length}개 매장`}
          />
          <div className="flex flex-wrap gap-1.5 p-4 sm:p-5">
            {branches.map((b, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface-2 px-2.5 py-1 text-xs"
              >
                {b.branchName}
                <strong className="tnum">{b.rank}위</strong>
              </span>
            ))}
          </div>
        </Card>
      )}

      {/* ═══════════ 서점별 표기 ═══════════ */}
      <Card>
        <CardHead
          title="서점별 표기"
          desc="서점이 적어 놓은 원본 표기입니다."
        />
        <ul className="divide-y divide-line-soft">
          {stores.map((s) => {
            const meta = store(s.store_id);
            return (
              <li key={s.id} className="flex items-start gap-2.5 px-4 py-2.5 sm:px-5">
                <span
                  className={`mt-0.5 shrink-0 rounded-md px-2 py-0.5 text-2xs font-medium ${meta.chip}`}
                >
                  {meta.name}
                </span>
                <span className="min-w-0 text-xs leading-relaxed text-ink-soft">
                  {s.raw_title}
                  {s.raw_author && ` / ${s.raw_author}`}
                  {s.raw_publisher && ` / ${s.raw_publisher}`}
                </span>
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------------ */

/**
 * 올라 있는 목록.
 *
 * 【왜 새로 짰나요? — 2026-08-08 대표님 지적】
 * "올라있는 분야에서도 저렇게 막 다 섞여서 나열되어 있는 게 맞는거야?"
 * 아니었습니다. 예전에는 서점·순위로만 줄을 세워서
 *   교보 전체 12위 / 교보 소설 3위 / 예스24 전체 9위 / 예스24 주간 소설 2위…
 * 가 한 표에 뒤섞여 나왔습니다. '전체 순위' 와 '분야 순위' 는 뜻이 완전히
 * 다른데도 구분이 없었고, 일간과 주간도 섞여 있었습니다.
 *
 * 이제 서점별로 묶고, 그 안에서
 *   ① 전체(종합) 순위를 맨 위에 크게
 *   ② 분야 순위를 아래에 따로
 * 로 나눠 보여줍니다.
 */
function PlacementCard({ rows }: { rows: CurrentPlacement[] }) {
  const byStore = new Map<number, CurrentPlacement[]>();
  for (const r of rows) {
    if (!byStore.has(r.storeId)) byStore.set(r.storeId, []);
    byStore.get(r.storeId)!.push(r);
  }

  return (
    <Card>
      <CardHead
        title="올라 있는 목록"
        desc="‘전체’ 는 그 서점의 종합 순위, ‘분야’ 는 그 분야 안에서의 순위입니다."
      />
      {rows.length === 0 ? (
        <Empty title="이 날짜에 온라인 순위에 올라 있지 않습니다">
          매장 순위에만 있거나, 순위권 밖으로 나갔을 수 있습니다.
        </Empty>
      ) : (
        <div className="divide-y divide-line-soft">
          {STORE_ORDER.filter((sid) => byStore.has(sid)).map((sid) => {
            const s = store(sid);
            const mine = byStore.get(sid)!;
            const overall = mine.filter((p) => p.isOverall);
            const genres = mine.filter((p) => !p.isOverall);
            return (
              <div key={sid} className="px-4 py-3.5 sm:px-5">
                <div className="flex items-center gap-2">
                  <span className={`rounded-md px-2 py-0.5 text-2xs font-medium ${s.chip}`}>
                    {s.name}
                  </span>
                  <span className="text-2xs text-ink-faint">
                    전체 {overall.length}건 · 분야 {genres.length}건
                  </span>
                </div>

                {/* ① 전체(종합) 순위 */}
                {overall.length > 0 && (
                  <div className="mt-2.5 flex flex-wrap gap-2">
                    {overall.map((p, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-2 rounded-xl border border-line bg-surface-2 px-3 py-2"
                      >
                        <RankBadge rank={p.rank} size="sm" />
                        <div className="leading-tight">
                          <div className="text-xs font-semibold">전체 순위</div>
                          <div className="mt-0.5">
                            <PeriodBadge period={p.period} withHelp />
                          </div>
                        </div>
                        {p.sales !== null && (
                          <div className="ml-1 border-l border-line pl-2 text-right">
                            <div className="text-2xs text-ink-faint">{s.salesLabel}</div>
                            <div className="tnum text-xs font-semibold">
                              {num(p.sales)}
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* ② 분야 순위 */}
                {genres.length > 0 && (
                  <div className="mt-2.5">
                    <p className="mb-1.5 text-2xs font-semibold uppercase tracking-wide text-ink-faint">
                      분야 안에서의 순위
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {genres.map((p, i) => (
                        <span
                          key={i}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-xs"
                          title={`${s.name} ${p.categoryName} · ${PERIOD_LABEL[p.period]}(${PERIOD_HELP[p.period]}) ${p.rank}위`}
                        >
                          <PeriodBadge period={p.period} />
                          <span className="text-ink-soft">{p.categoryName}</span>
                          <strong className="tnum">{p.rank}위</strong>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

/** 순위 기준 고르기 버튼 (종합 / 분야) */
function BasisChip({
  id,
  basis,
  on,
  children,
}: {
  id: string;
  basis: Basis;
  on: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={`/book/${id}?basis=${basis}`}
      aria-current={on ? "true" : undefined}
      className={`rounded-lg px-2.5 py-1 text-xs transition-colors ${
        on
          ? "bg-accent font-semibold text-accent-ink"
          : "border border-line text-ink-soft hover:bg-surface-2 hover:text-ink"
      }`}
    >
      {children}
    </Link>
  );
}
