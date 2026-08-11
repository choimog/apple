import Link from "next/link";
import Cover from "@/components/Cover";
import SalesPoint from "@/components/SalesPoint";
import { NoValue, Price, RankBadge } from "@/components/ui";
import { store, STORE_ORDER, type StoreId } from "@/lib/stores";
import type { CombinedRow } from "@/lib/queries";

/**
 * 종합 순위 한 줄.
 *
 * 종합 순위·출판사 상세·저자 상세가 모두 이 모양을 씁니다.
 * (페이지마다 따로 만들면 조금씩 달라져서 어수선해집니다)
 */
export default function BookRow({
  row,
  position,
  depth,
}: {
  row: CombinedRow;
  /** 이 목록에서의 자리(1부터) */
  position: number;
  /** 각 서점에서 몇 위까지 봤는지 — '없음' 의 뜻을 정확히 적기 위함 */
  depth: number;
}) {
  return (
    <li className="flex items-start gap-3 px-4 py-3.5 sm:px-5">
      <div className="w-11 shrink-0 pt-0.5 text-center">
        <RankBadge rank={position} />
        <div className="mt-1 text-[10px] leading-tight text-ink-faint">
          평균
          <br />
          <span className="font-medium text-ink-soft tnum">
            {row.avgRank.toFixed(1)}위
          </span>
        </div>
      </div>

      <Cover url={row.coverUrl} alt={row.title} className="h-[72px] w-12" />

      <div className="min-w-0 flex-1">
        <Link
          href={`/book/${row.bookId}`}
          className="text-[15px] font-semibold leading-snug hover:underline"
        >
          {row.title}
        </Link>

        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-ink-soft">
          {row.author ? (
            <Link
              href={`/author/${encodeURIComponent(row.author)}`}
              className="hover:text-ink hover:underline"
            >
              {row.author}
            </Link>
          ) : (
            <span className="text-ink-faint">저자 정보 없음</span>
          )}
          {row.publisher && (
            <>
              <span className="text-ink-faint">·</span>
              <Link
                href={`/publisher/${encodeURIComponent(row.publisher)}`}
                className="hover:text-ink hover:underline"
              >
                {row.publisher}
              </Link>
            </>
          )}
          <Price value={row.listPrice} />
          <span className="text-ink-faint">·</span>
          <span>{row.storeCount}개 서점</span>
        </p>

        {/* 3사 순위 + 판매지수 */}
        <div className="mt-2 grid grid-cols-3 gap-1.5">
          {STORE_ORDER.map((sid: StoreId) => {
            const rank = row.ranks[sid];
            const has = rank !== undefined;
            const s = store(sid);
            return (
              <div
                key={sid}
                className={`rounded-lg border px-2 py-1.5 ${
                  has ? "border-line bg-surface" : "border-dashed border-line bg-surface-2"
                }`}
              >
                <div className="flex items-baseline justify-between gap-1">
                  <span
                    className={`rounded px-1.5 py-px text-2xs font-medium ${s.chip}`}
                  >
                    {s.short}
                  </span>
                  <span className="text-[13px] font-bold tnum">
                    {has ? (
                      `${rank}위`
                    ) : (
                      <NoValue
                        label="순위 밖"
                        why={`${s.name} ${depth}위 안에 없습니다`}
                      />
                    )}
                  </span>
                </div>
                {has && (
                  <div className="mt-0.5">
                    <SalesPoint
                      value={row.sales[sid] ?? null}
                      storeProvides={s.hasSalesPoint}
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
  );
}
