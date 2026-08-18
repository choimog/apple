import Link from "next/link";
import Cover from "@/components/Cover";
import SalesPoint from "@/components/SalesPoint";
import { NoRank, Price, RankBadge } from "@/components/ui";
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
  action,
}: {
  row: CombinedRow;
  /** 이 목록에서의 자리(1부터) */
  position: number;
  /** 각 서점에서 몇 위까지 봤는지 — '없음' 의 뜻을 정확히 적기 위함 */
  depth: number;
  /** 줄 오른쪽에 붙일 것 (즐겨찾기 화면의 [빼기] 버튼) */
  action?: import("react").ReactNode;
}) {
  return (
    <li className="flex items-start gap-3 px-4 py-3.5 sm:px-5">
      <div className="w-11 shrink-0 pt-0.5 text-center">
        <RankBadge rank={position} />
        {/*
          🚨 어느 서점 목록에도 없으면 평균이 **없습니다.**
          0 으로 채우면 '0.0위' 라고 적히는데, 1위보다 높은 순위입니다.
          (즐겨찾기 화면은 순위가 없는 책도 목록에 남겨 둡니다)
        */}
        <div className="mt-1 text-[10px] leading-tight text-ink-faint">
          {row.avgRank === null ? (
            <span title="이 날짜에는 세 서점 어디에서도 순위에 없었습니다">
              순위
              <br />
              없음
            </span>
          ) : (
            <>
              평균
              <br />
              <span className="font-medium text-ink-soft tnum">
                {row.avgRank.toFixed(1)}위
              </span>
            </>
          )}
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
          <Price value={row.listPrice} split={row.priceSplit} />
          <span className="text-ink-faint">·</span>
          <span>{row.storeCount}개 서점</span>
        </p>

        {/* 3사 순위 + 판매지수 */}
        <div className="mt-2 grid grid-cols-3 gap-1.5">
          {STORE_ORDER.map((sid: StoreId) => {
            const rank = row.ranks[sid];
            const has = rank !== undefined;
            const s = store(sid);
            /*
              🚨 【2026-08-12 대표님 지적】
              "묶이지 않은 서점이 있는 경우에도 '순위 밖' 으로 표시하고,
               묶인 경우인데 순위에서 빠진 경우도 '순위 밖' 이라고 표시"

              둘은 뜻이 완전히 다릅니다.
                · 묶여 있는데 순위 없음 → 그 서점에서 덜 팔림 (시장 신호)
                · 아예 안 묶임         → 상품을 못 찾음 (자료 한계)

              linked 를 아직 못 읽었으면(빈 배열이 아니라 값이 없으면)
              예전처럼 '순위 밖' 으로 둡니다. 모르면서 단정하지 않습니다.
            */
            const linked = row.linked?.length
              ? row.linked.includes(sid)
              : null;
            return (
              <div
                key={sid}
                className={`rounded-lg border px-2 py-1.5 ${
                  has
                    ? "border-line bg-surface"
                    : linked === false
                      // 안 묶인 칸은 한 단계 더 옅게 — 눈으로도 구분되게
                      ? "border-dotted border-line-soft bg-surface-2 opacity-70"
                      : "border-dashed border-line bg-surface-2"
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
                      <NoRank storeName={s.name} depth={depth} linked={linked} />
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

      {action && <div className="shrink-0 pt-0.5">{action}</div>}
    </li>
  );
}
