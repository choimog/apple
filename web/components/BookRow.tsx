import Link from "next/link";
import Cover from "@/components/Cover";
import RankChange from "@/components/RankChange";
import SalesPoint from "@/components/SalesPoint";
import { NoRank, Price, RankBadge } from "@/components/ui";
import { store, STORE_ORDER, type StoreId } from "@/lib/stores";
import type { CombinedRow } from "@/lib/queries";

/**
 * 종합 순위 한 줄.
 *
 * 종합 순위·출판사 상세·저자 상세·즐겨찾기가 모두 이 모양을 씁니다.
 * (페이지마다 따로 만들면 조금씩 달라져서 어수선해집니다)
 *
 * 🚨 【2026-08-18 대표님 지적 — 휴대폰에서 깨짐】
 *   "모바일로 봤을 때, 즐겨찾기 영역에서 판매지수나 순위 부분이 넘치면서
 *    깨져. 사실 이런 부분은 꼭 완전히 엇나가는게 아니더라도 종합이라든지
 *    서점별에서도 특히 모바일 버전에서 가독성이 확 떨어지는 문제가 되긴 해."
 *
 * 실제로 재 보니(360px 기준) 서점 칸 하나의 속 너비가 **19px** 이었습니다.
 * 판매지수 `1,284,530` 은 62px 이라 43px 이 삐져나가고 있었습니다.
 * 숫자에는 띄어쓸 자리가 없어서 줄바꿈도 안 됩니다.
 *
 *     가로 296px
 *       순위 44 + 표지 48 + 여백 36 + [빼기] 40  →  남는 폭 128px
 *       3칸으로 나누면 칸당 42px, 안쪽 여백을 빼면 19px
 *
 * 그래서 **3사 칸을 제목 옆이 아니라 아래 한 줄 전체**로 내렸습니다.
 * 휴대폰에서 칸당 94px 가 되어 서점 이름·순위·판매지수가 다 들어갑니다.
 * 넓은 화면에서는 예전처럼 오른쪽에 둡니다(폭을 고정해서).
 *
 * ⚠️ 글자 크기를 줄여서 맞추지 않았습니다. 읽기 어려워지는 쪽으로 고치면
 *    "안 깨지는데 못 읽는" 화면이 됩니다. 자리를 다시 나눴습니다.
 */
export default function BookRow({
  row,
  position,
  depth,
  action,
  changeUnknown,
}: {
  row: CombinedRow;
  /** 이 목록에서의 자리(1부터) */
  position: number;
  /** 각 서점에서 몇 위까지 봤는지 — '없음' 의 뜻을 정확히 적기 위함 */
  depth: number;
  /** 줄 오른쪽에 붙일 것 (즐겨찾기 화면의 [빼기] 버튼) */
  action?: import("react").ReactNode;
  /** 등락이 '–' 일 때 마우스를 올리면 나올 설명 */
  changeUnknown?: string;
}) {
  return (
    <li className="flex flex-wrap items-start gap-x-3 gap-y-2.5 px-4 py-3.5 sm:px-5">
      <div className="w-11 shrink-0 pt-0.5 text-center">
        <RankBadge rank={position} />
        {/*
          등락 — 2026-08-19 대표님 요청.

          【왜 여기인가요】
          등락은 **순위에 대한 값**이라 순위 바로 아래가 제자리입니다.
          그리고 이 칸은 이미 폭이 정해져 있어서(w-11) 여기에 한 줄을
          더해도 **다른 칸이 좁아지지 않습니다.** 옆에 끼워 넣었다면
          휴대폰에서 제목이 그만큼 줄었을 것입니다.
          줄 높이도 그대로입니다 — 왼쪽 칸(약 73px)이 표지(72px)보다
          아직 낮아서, 줄 키를 정하는 것은 여전히 표지입니다.

          ⚠️ change 가 **undefined 면 아무것도 안 그립니다.**
             출판사·저자·즐겨찾기 화면은 등락을 계산하지 않는데,
             거기에 '–' 를 100줄 그려 놓으면 '고장난 화면' 으로 보입니다.
             (계산했는데 비교를 못 한 null 과는 뜻이 다릅니다)
        */}
        {row.change !== undefined && (
          /* ⚠️ leading-none 이 없으면 이 한 줄이 24px 를 먹습니다 (실측).
             속의 글자가 10px 라도, 줄 상자는 바깥 글자 크기를 따라갑니다.
             그만큼 왼쪽 칸이 표지보다 높아져서 목록 전체가 두꺼워집니다. */
          <div className="mt-0.5 leading-none">
            <RankChange
              change={row.change}
              isNew={!!row.isNew}
              size="sm"
              unknownTitle={changeUnknown}
            />
          </div>
        )}
        {/*
          🚨 어느 서점 목록에도 없으면 평균이 **없습니다.**
          0 으로 채우면 '0.0위' 라고 적히는데, 1위보다 높은 순위입니다.
          (즐겨찾기 화면은 순위가 없는 책도 목록에 남겨 둡니다)
        */}
        <div className="mt-0.5 text-[10px] leading-tight text-ink-faint">
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

      {/* 제목·저자 — 남는 자리를 전부 씁니다 */}
      <div className="min-w-0 flex-1 basis-40">
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
          {/*
            출간월 — 2026-08-19 대표님 요청.
            검색·도서 상세와 **같은 자리**(출판사 다음)에 둡니다.
            모르면 아무것도 안 적습니다. 없는 달을 지어내지 않습니다.
          */}
          {row.pubYm && (
            <>
              <span className="text-ink-faint">·</span>
              <span className="tnum">{row.pubYm}</span>
            </>
          )}
          <Price value={row.listPrice} split={row.priceSplit} />
          <span className="text-ink-faint">·</span>
          <span>{row.storeCount}개 서점</span>
        </p>
      </div>

      {action && <div className="shrink-0 pt-0.5">{action}</div>}

      {/*
        3사 순위 + 판매지수 — **언제나 한 줄을 통째로** 씁니다.

        🚨 휴대폰: 제목 옆에 끼워 넣으면 칸이 19px 밖에 안 남아 숫자가
           삐져나갑니다 (2026-08-18).

        🚨 PC: 폭을 19rem 으로 고정해 오른쪽 끝에 붙여 봤더니 대표님
           지적이 나왔습니다 — "웰컴 화면과 종합 부분에서 도서와 실적표가
           너무 떨어져있어서 한눈에 보기에 가독성이 떨어져보여."
           맞습니다. 제목이 남는 자리를 다 먹어서 실적표가 저 멀리
           오른쪽 끝으로 밀려나 있었습니다. 그래서 아래로 내리고,
           넓은 화면에서는 제목 시작점에 맞춰 들여씁니다.
           (순위 2.75rem + 여백 0.75 + 표지 3rem + 여백 0.75 = 7.25rem)
      */}
      <div className="grid w-full grid-cols-3 gap-1.5 sm:pl-[7.25rem]">
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
              className={`min-w-0 rounded-lg border px-1.5 py-1.5 sm:px-2 ${
                has
                  ? "border-line bg-surface"
                  : linked === false
                    // 안 묶인 칸은 한 단계 더 옅게 — 눈으로도 구분되게
                    ? "border-dotted border-line-soft bg-surface-2 opacity-70"
                    : "border-dashed border-line bg-surface-2"
              }`}
            >
              {/*
                ⚠️ flex-wrap 이 중요합니다. 좁으면 서점 이름과 순위가
                   두 줄로 나뉘고, 넓으면 한 줄에 나란히 놓입니다.
                   폭을 짐작해서 화면 크기별로 나누지 않아도 됩니다.
              */}
              <div className="flex flex-wrap items-baseline justify-between gap-x-1 gap-y-0.5">
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
                    compact
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </li>
  );
}
