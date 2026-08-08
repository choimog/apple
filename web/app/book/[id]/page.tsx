import Link from "next/link";
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
import { dayLabel, num } from "@/lib/format";
import {
  getBookDetail,
  PERIOD_HELP,
  PERIOD_LABEL,
  type CurrentPlacement,
  type Period,
} from "@/lib/queries";

export const revalidate = 600;

export default async function BookPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (configError) {
    return (
      <div className="rounded-2xl border border-amber-300 bg-amber-50 p-6 text-sm text-amber-900">
        {configError}
      </div>
    );
  }

  const { id } = await params;
  let detail;
  try {
    detail = await getBookDetail(Number(id));
  } catch (e) {
    return <DataError detail={String(e)} />;
  }
  const { stores, history, placements, latestDate } = detail;

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
  const latest = new Map<string, { rank: number; sales: number | null }>();
  for (const h of history) {
    if (h.date !== latestDate) continue;
    const k = `${h.storeId}|${h.period}`;
    const cur = latest.get(k);
    if (!cur || h.rank < cur.rank) latest.set(k, { rank: h.rank, sales: h.sales });
  }

  const online = placements.filter((p) => !p.branchName);
  const branches = placements.filter((p) => p.branchName);
  const hasSales = history.some((h) => h.sales !== null);

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
            <p className="mt-2 text-xs leading-relaxed text-ink-faint">
              저자·출판사 이름을 누르면 그들이 순위에 올린 다른 책을 볼 수 있습니다.
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
              ? `${dayLabel(latestDate)} 기준 · 각 서점이 발표한 순위 그대로입니다`
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
                    return (
                      <div key={p} className="flex items-baseline justify-between gap-2">
                        <dt>
                          <PeriodBadge period={p} />
                        </dt>
                        <dd className="tnum text-lg font-bold">
                          {cell ? (
                            `${cell.rank}위`
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

      {/* ═══════════ 추이 ═══════════ */}
      {(["daily", "weekly"] as Period[]).map((p) => (
        <Card key={p}>
          <CardHead
            title={
              <span className="flex items-center gap-2">
                <PeriodBadge period={p} /> 순위 추이
              </span>
            }
            desc={`${PERIOD_HELP[p]} · 위로 갈수록 높은 순위입니다`}
          />
          <TrendChart history={history} period={p} metric="rank" />

          {hasSales && (
            <>
              <div className="border-y border-line-soft px-4 py-3 text-[15px] font-bold sm:px-5">
                {PERIOD_LABEL[p]} 판매지수 추이
              </div>
              <TrendChart history={history} period={p} metric="sales" />
              <p className="px-4 py-3 text-xs leading-relaxed text-ink-faint sm:px-5">
                판매지수는 예스24·알라딘만 공개합니다. 두 값은 계산식이 다른 별개의
                수치라 서로 더하거나 평균 내지 않고 그대로 그립니다. 교보문고는
                공개하지 않습니다.
              </p>
            </>
          )}
        </Card>
      ))}

      {/* ═══════════ 올라 있는 목록 ═══════════ */}
      <PlacementCard rows={online} />

      {branches.length > 0 && (
        <Card>
          <CardHead
            title="올라 있는 교보문고 매장"
            desc={`${branches.length}개 매장 · 매장 순위는 그 매장에서 어제 하루 팔린 순서입니다`}
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
          desc="같은 책이라도 서점마다 제목·저자 표기가 조금씩 다릅니다. 원본 그대로 보여드립니다."
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
        <p className="border-t border-line-soft px-4 py-3 text-xs text-ink-faint sm:px-5">
          서로 다른 책이 잘못 묶여 보이면 알려주세요. 사람이 내린 판단은 자동 묶기가
          절대 뒤집지 못하도록 되어 있습니다.
        </p>
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
        desc="‘전체’ 는 그 서점의 종합 순위이고, ‘분야’ 는 그 분야 안에서의 순위입니다. 뜻이 다르므로 나눠서 보여줍니다."
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
