import Link from "next/link";
import Cover from "@/components/Cover";
import SalesPoint from "@/components/SalesPoint";
import { RankBadge } from "@/components/ui";
import { STORE_COLOR, STORE_NAME } from "@/lib/supabase";
import type { CombinedRow } from "@/lib/queries";

const STORE_ORDER = [1, 2, 3]; // 교보 · 예스24 · 알라딘
const SALES_STORES = new Set([2, 3]); // 판매지수를 제공하는 서점

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
        <div className="mt-1 text-[10px] leading-tight text-slate-400">
          평균
          <br />
          <span className="font-medium text-slate-500 tabular-nums">
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

        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500">
          {row.author ? (
            <Link
              href={`/author/${encodeURIComponent(row.author)}`}
              className="hover:text-slate-900 hover:underline"
            >
              {row.author}
            </Link>
          ) : (
            <span className="text-slate-400">저자 정보 없음</span>
          )}
          {row.publisher && (
            <>
              <span className="text-slate-300">·</span>
              <Link
                href={`/publisher/${encodeURIComponent(row.publisher)}`}
                className="hover:text-slate-900 hover:underline"
              >
                {row.publisher}
              </Link>
            </>
          )}
          <span className="text-slate-300">·</span>
          <span>{row.storeCount}개 서점</span>
        </p>

        {/* 3사 순위 + 판매지수 */}
        <div className="mt-2 grid grid-cols-3 gap-1.5">
          {STORE_ORDER.map((sid) => {
            const rank = row.ranks[sid];
            const has = rank !== undefined;
            return (
              <div
                key={sid}
                className={`rounded-lg border px-2 py-1.5 ${
                  has ? "border-slate-200 bg-white" : "border-dashed border-slate-200 bg-slate-50/60"
                }`}
              >
                <div className="flex items-baseline justify-between gap-1">
                  <span
                    className={`rounded px-1 py-px text-[10px] font-medium ${STORE_COLOR[sid]}`}
                  >
                    {STORE_NAME[sid]}
                  </span>
                  <span className="text-[13px] font-bold tabular-nums">
                    {has ? (
                      `${rank}위`
                    ) : (
                      <span
                        className="text-[11px] font-normal text-slate-400"
                        title={`${depth}위 안에 없습니다`}
                      >
                        순위 밖
                      </span>
                    )}
                  </span>
                </div>
                {has && (
                  <div className="mt-0.5">
                    <SalesPoint
                      value={row.sales[sid] ?? null}
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
  );
}
