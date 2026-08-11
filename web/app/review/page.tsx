import Link from "next/link";
import Cover from "@/components/Cover";
import ExportAll from "@/components/ExportAll";
import ImportSheet from "@/components/ImportSheet";
import DataError from "@/components/DataError";
import { Card, CardHead, Empty } from "@/components/ui";
import { configError, currentRole } from "@/lib/supabase";
import { store } from "@/lib/stores";
import { num } from "@/lib/format";
import {
  bandLabel,
  getReviewCounts,
  getReviewPairs,
  getScoreBands,
  isReviewTab,
  parseBand,
  parseSize,
  reasonText,
  REVIEW_PAGE_SIZE,
  SIZE_HELP,
  SIZE_LABEL,
  sizeGroupOf,
  TAB_HELP,
  TAB_LABEL,
  type Reason,
  type ReviewBook,
  type ReviewPair,
  type ReviewTab,
  type SizeGroup,
} from "@/lib/review";

export const metadata = { title: "매칭 검토" };

/**
 * 매칭 검토 화면 — 관리자 전용.
 *
 * 【왜 만들었나요?】
 * 같은 책 묶기는 애매한 경우를 '검토 필요' 로 표시만 하고 넘어갑니다.
 * 코드에는 "사람이 내린 결정이 최우선" 이라고 되어 있는데, 정작 사람이
 * 결정할 화면이 없었습니다. **잘못 묶인 책을 발견해도 고칠 방법이
 * 없는 상태였습니다.**
 */
export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<{
    tab?: string; page?: string; msg?: string; band?: string; size?: string;
  }>;
}) {
  if (configError) {
    return (
      <div className="rounded-2xl border border-amber-300 bg-amber-50 p-6 text-sm text-amber-900">
        {configError}
      </div>
    );
  }

  const params = await searchParams;
  const tab: ReviewTab = isReviewTab(params.tab) ? params.tab : "pending";
  const page = Math.max(0, Number(params.page ?? 0) || 0);
  // 모르는 값이 주소에 들어오면 '전체' 로 봅니다 (엉뚱한 빈 화면 방지)
  const band = parseBand(params.band);
  const size = parseSize(params.size);

  const role = await currentRole();
  if (role !== "admin") {
    return (
      <Card className="p-6">
        <h1 className="text-lg font-bold">매칭 검토</h1>
        <p className="mt-2 text-sm text-ink-soft">
          이 화면은 관리자만 볼 수 있습니다. 순위를 보시는 데에는 지장이
          없습니다.
        </p>
        <p className="mt-3 text-xs text-ink-faint">
          관리자 권한이 필요하시면 운영자에게 말씀해 주세요.
        </p>
      </Card>
    );
  }

  let counts, result, scoreBands;
  try {
    [counts, result, scoreBands] = await Promise.all([
      getReviewCounts(),
      getReviewPairs(tab, page, band, size),
      getScoreBands(tab),
    ]);
  } catch (e) {
    return <DataError detail={String(e)} />;
  }

  const lastPage = Math.max(0, Math.ceil(result.total / REVIEW_PAGE_SIZE) - 1);
  const bandQ = band === null ? "" : `&band=${band}`;
  const sizeQ = size === null ? "" : `&size=${size}`;
  const here = `/review?tab=${tab}&page=${page}${bandQ}${sizeQ}`;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">매칭 검토</h1>
        <p className="mt-1 text-sm text-ink-soft">
          서점마다 제목·저자 표기가 조금씩 달라서, 같은 책인지 기계가
          확신하지 못하는 경우가 있습니다. 여기서 대표님이 정해 주시면
          그 결정이 항상 우선합니다.
        </p>
      </div>

      {params.msg && <Message code={params.msg} params={params} />}

      {/* ---------- 엑셀로 한꺼번에 ---------- */}
      <Card>
        <CardHead
          title="엑셀로 한꺼번에 결정하기"
          desc="하나씩 누르는 대신, 파일로 받아 채워서 올리시면 한 번에 반영됩니다"
        />
        <div className="grid gap-4 px-4 py-4 sm:grid-cols-2 sm:px-5">
          <div>
            <p className="text-sm font-semibold">① 내려받기</p>
            <p className="mt-1 text-xs leading-relaxed text-ink-soft">
              지금 화면에 걸어 둔 조건(탭·점수·묶인 권수) 그대로 받습니다.
              <br />
              <strong>결정</strong> 칸에 <code>같은책</code> 또는{" "}
              <code>다른책</code> 만 적으시면 됩니다.
              빈칸은 그냥 넘어갑니다 — 전부 채우지 않으셔도 됩니다.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <a
                href={`/review/sheet?tab=${tab}${bandQ}${sizeQ}`}
                className="inline-block rounded-xl border border-line px-3.5 py-2 text-sm font-medium hover:border-ink-faint"
              >
                이 조건만 내려받기
              </a>
              {/* 2026-08-10 요청 — "갯수 제한 없이 한번에 다 다운로드"
                  서버가 한 번에 만들다 두 번 잘려서(29,502 · 36,002줄),
                  브라우저가 나눠 가져오는 방식으로 바꿨습니다. */}
              <ExportAll />
            </div>
            <p className="mt-1.5 text-2xs leading-relaxed text-ink-faint">
              <strong>전체</strong>는 세 가지(검토 대기·자동으로 묶은
              것·내가 내린 결정)를 조건 없이 전부 담습니다. 건수가 많으면
              시간이 좀 걸립니다.
              <br />
              받으신 뒤 <strong>맨 아래 줄에 「여기까지가 전부입니다」</strong>
              가 있는지 봐 주세요. 없으면 중간에 끊긴 것이니 다시 받아
              주세요.
            </p>
          </div>

          <div>
            <p className="text-sm font-semibold">② 채워서 올리기</p>
            <p className="mt-1 text-xs leading-relaxed text-ink-soft">
              엑셀에서 <strong>CSV(쉼표로 분리)</strong> 로 저장한 뒤 올려 주세요.
              <br />
              <span className="text-ink-faint">
                되돌리려면 <code>되돌리기</code> 라고 적으시면 됩니다.
              </span>
            </p>
            {/* 2026-08-10 — 파일을 통째로 올리면 4.5MB 에서 거절당합니다
                (413 PAYLOAD_TOO_LARGE). 브라우저가 읽어서 '짝번호와 결정'
                만 나눠 보냅니다. 파일을 고르시면 바로 시작합니다. */}
            <ImportSheet />
          </div>
        </div>
        <p className="border-t border-line-soft px-4 py-2.5 text-2xs leading-relaxed text-ink-faint sm:px-5">
          ⚠️ 다른 파일을 올리시면 <strong>한 줄도 반영하지 않고</strong> 왜 안
          되는지 알려 드립니다. 반영 뒤에는 몇 건이 들어갔는지 숫자로 보여
          드립니다.
          <br />
          결정은 곧바로 저장되지만, <strong>순위 화면</strong>에 보이려면
          같은 책 묶기를 한 번 다시 돌려야 합니다. 그냥 두시면 내일 아침에
          저절로 되고, 지금 보고 싶으시면{" "}
          <a
            href="https://github.com/choimog/apple/actions/workflows/match.yml"
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2"
          >
            [도서 매칭]
          </a>{" "}
          에서 <strong>Run workflow</strong> 를 누르세요 (약 5분 · 무료).
        </p>
      </Card>

      {/* ---------- 탭 ---------- */}
      <div className="scroll-x flex gap-1.5">
        {(Object.keys(TAB_LABEL) as ReviewTab[]).map((t) => (
          <Link
            key={t}
            href={`/review?tab=${t}`}
            aria-current={t === tab ? "page" : undefined}
            className={`whitespace-nowrap rounded-xl px-3 py-2 text-sm transition-colors ${
              t === tab
                ? "bg-accent font-semibold text-accent-ink"
                : "border border-line text-ink-soft hover:bg-surface-2 hover:text-ink"
            }`}
          >
            {TAB_LABEL[t]}
            <span className="tnum ml-1.5 text-xs opacity-70">
              {num(counts[t])}
            </span>
          </Link>
        ))}
      </div>

      <p className="text-xs leading-relaxed text-ink-faint">{TAB_HELP[tab]}</p>

      {/* ---------- 점수 구간 고르기 ---------- */}
      {scoreBands.bands.length > 0 && (
        <div className="rounded-xl border border-line bg-surface-2 px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="shrink-0 text-xs font-semibold text-ink-soft">
              점수로 좁혀 보기
            </span>
            <div className="scroll-x flex items-center gap-1.5">
              <BandChip
                tab={tab}
                band={null}
                on={band === null}
                keep={sizeQ}
                count={result.ok && size === null ? counts[tab] : null}
              >
                전체
              </BandChip>
              {scoreBands.bands.map((b) => (
                <BandChip
                  key={b.start}
                  tab={tab}
                  band={b.start}
                  on={band === b.start}
                  keep={sizeQ}
                  count={size === null ? b.count : null}
                >
                  {b.label}
                </BandChip>
              ))}
            </div>
          </div>
          {/* ---------- 묶음 크기로 좁혀 보기 ---------- */}
          <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line-soft pt-2.5">
            <span className="shrink-0 text-xs font-semibold text-ink-soft">
              묶인 권수
            </span>
            <div className="scroll-x flex items-center gap-1.5">
              <SizeChip tab={tab} size={null} on={size === null} keep={bandQ}>
                전체
              </SizeChip>
              {(["small", "exact", "large"] as SizeGroup[]).map((g) => (
                <SizeChip
                  key={g}
                  tab={tab}
                  size={g}
                  on={size === g}
                  keep={bandQ}
                  title={SIZE_HELP[g]}
                >
                  {SIZE_LABEL[g]}
                </SizeChip>
              ))}
            </div>
          </div>
          {size !== null && (
            <p className="mt-1.5 text-2xs leading-relaxed text-ink-soft">
              {SIZE_HELP[size]}
            </p>
          )}
          {result.capped && (
            <p className="mt-1.5 text-2xs leading-relaxed text-amber-700 dark:text-amber-400">
              ⚠️ 짝이 너무 많아 앞쪽 일부만 훑었습니다. 여기 보이는 것이
              전부는 아닙니다. 점수 구간을 같이 좁히면 정확해집니다.
            </p>
          )}

          <p className="mt-2 text-2xs leading-relaxed text-ink-faint">
            점수가 낮을수록 기계가 덜 확신한 짝입니다.
            {tab === "pending"
              ? " 낮은 점수부터 보시면 잘못 묶인 것을 빨리 찾을 수 있습니다."
              : tab === "merged"
                ? " 자동으로 묶은 것 중에서는 85~89점이 가장 위험합니다."
                : ""}
          </p>
        </div>
      )}

      {/* ---------- 목록 ---------- */}
      {!result.ok ? (
        <Card className="p-6">
          <p className="text-sm font-semibold text-red-700 dark:text-red-400">
            아직 준비가 안 됐습니다
          </p>
          <p className="mt-2 text-sm leading-relaxed text-ink-soft">
            Supabase → SQL Editor 에서 <code>db/auth.sql</code> 을 한 번
            실행해 주세요. 검토 결정을 저장할 칸이 아직 없습니다.
          </p>
        </Card>
      ) : result.rows.length === 0 ? (
        <Empty
          title={
            size !== null && band !== null
              ? `${SIZE_LABEL[size]} · ${bandLabel(band)} 짝이 없습니다`
              : size !== null
                ? `${SIZE_LABEL[size]} 인 짝이 없습니다`
                : band !== null
              ? `${bandLabel(band)} 짝이 없습니다`
              : tab === "pending"
                ? "검토할 것이 없습니다"
                : tab === "mine"
                  ? "아직 직접 내리신 결정이 없습니다"
                  : "자동으로 묶인 짝이 없습니다"
          }
          action={
            band !== null || size !== null ? (
              <Link
                href={`/review?tab=${tab}`}
                className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink-soft hover:border-ink-faint hover:text-ink"
              >
                전체 보기
              </Link>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-3">
          {result.rows.map((p) => (
            <PairCard key={p.id} pair={p} tab={tab} back={here} />
          ))}
        </div>
      )}

      {/* ---------- 쪽 넘기기 ---------- */}
      {lastPage > 0 && (
        <div className="flex items-center justify-between text-sm">
          <PageLink tab={tab} band={band} size={size} page={page - 1} disabled={page === 0}>
            ← 이전
          </PageLink>
          <span className="tnum text-xs text-ink-faint">
            {page + 1} / {lastPage + 1}쪽 ·{" "}
            {band === null ? "전체" : bandLabel(band)} {num(result.total)}쌍
          </span>
          <PageLink tab={tab} band={band} size={size} page={page + 1} disabled={page >= lastPage}>
            다음 →
          </PageLink>
        </div>
      )}

      {/* ---------- 언제 반영되는지 ---------- */}
      <Card>
        <CardHead
          title="누른 결정은 언제 반영되나요?"
          desc="바로 순위 화면이 바뀌지는 않습니다. 이유를 적어 둡니다."
        />
        <div className="px-4 py-3.5 text-sm leading-relaxed text-ink-soft sm:px-5">
          <p>
            결정은 <strong>지금 바로 저장</strong>됩니다. 다만 책을 실제로
            묶고 푸는 계산은 <strong>매일 새벽 수집이 끝난 뒤</strong> 한꺼번에
            돌아갑니다. 그래서 그냥 두시면 순위 화면에는 다음 날 아침에
            반영됩니다.
          </p>
          {/*
            【2026-08-10 대표님 질문】
            "순위 화면 반영은 다음날이라는데, 오늘 바로 할 수는 없나?"

            할 수 있었는데 화면에 안 적혀 있었습니다. 기능이 없던 게
            아니라 **안내가 빠진** 것이었습니다.
          */}
          <p className="mt-2">
            <strong>오늘 바로 보고 싶으시면</strong> 직접 한 번 돌리시면
            됩니다.{" "}
            <a
              href="https://github.com/choimog/apple/actions/workflows/match.yml"
              target="_blank"
              rel="noreferrer"
              className="text-accent underline underline-offset-2"
            >
              [도서 매칭] 페이지 열기
            </a>
          </p>
          <ol className="mt-1.5 list-decimal space-y-0.5 pl-5 text-xs text-ink-faint">
            <li>위 링크를 엽니다 (GitHub 로그인이 되어 있어야 합니다)</li>
            <li>
              오른쪽 <strong>Run workflow</strong> 버튼 → 다시{" "}
              <strong>Run workflow</strong>
            </li>
            <li>약 5분 뒤 순위 화면에 반영됩니다. 돈은 들지 않습니다</li>
          </ol>
          {/*
            2026-08-11 — 실제로 확인한 것.
            매칭이 끝나면 리포트 작업이 자동으로 이어서 돌긴 하지만,
            그날 리포트가 이미 있으면 **건너뜁니다** (돈이 두 번 나가지
            않게 해 둔 규칙입니다). 그래서 묶음을 바꾼 뒤 리포트를 새로
            받으려면 따로 돌려야 합니다. 이걸 안 적어 두면 "저절로
            바뀌었겠지" 하고 옛 리포트를 보시게 됩니다.
          */}
          <p className="mt-2 text-xs leading-relaxed text-ink-faint">
            ⚠️ <strong>AI 리포트는 따로입니다.</strong> 매칭을 다시 돌려도
            그날 리포트가 이미 있으면 다시 쓰지 않습니다 (돈이 두 번 나가지
            않게). 새 묶음 기준으로 리포트를 다시 받으시려면{" "}
            <a
              href="https://github.com/choimog/apple/actions/workflows/report.yml"
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2"
            >
              [AI 일일 리포트]
            </a>
            에서 <strong>force</strong> 를 <code>true</code> 로 두고 돌리세요
            (1회 약 85원).
          </p>
          <p className="mt-2 text-xs text-ink-faint">
            한 짝을 고치면 그 책이 속한 무리 전체를 다시 계산해야 해서,
            누를 때마다 돌리면 몇 분씩 걸립니다. 그래서 평소에는 모아서
            합니다.
          </p>
        </div>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------------ */

function PageLink({
  tab,
  band,
  size,
  page,
  disabled,
  children,
}: {
  tab: ReviewTab;
  band: number | null;
  size: SizeGroup | null;
  page: number;
  disabled: boolean;
  children: React.ReactNode;
}) {
  if (disabled) {
    return <span className="text-ink-faint opacity-40">{children}</span>;
  }
  // 쪽을 넘겨도 고른 점수 구간은 그대로 유지합니다
  const q =
    (band === null ? "" : `&band=${band}`) + (size === null ? "" : `&size=${size}`);
  return (
    <Link
      href={`/review?tab=${tab}&page=${page}${q}`}
      className="rounded-lg border border-line px-3 py-1.5 hover:border-ink-faint"
    >
      {children}
    </Link>
  );
}

/**
 * 점수 구간 버튼.
 *
 * ⚠️ 구간을 바꾸면 **1쪽으로 돌아갑니다** (page 를 안 붙입니다).
 *    3쪽을 보다가 구간을 좁히면 그 구간에는 3쪽이 없어서 빈 화면이 뜹니다.
 */
function BandChip({
  tab,
  band,
  on,
  count,
  keep = "",
  children,
}: {
  tab: ReviewTab;
  band: number | null;
  on: boolean;
  count: number | null;
  /** 같이 유지할 다른 조건 (예: &size=large) */
  keep?: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={
        band === null
          ? `/review?tab=${tab}${keep}`
          : `/review?tab=${tab}&band=${band}${keep}`
      }
      aria-current={on ? "true" : undefined}
      className={`whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs transition-colors ${
        on
          ? "bg-accent font-semibold text-accent-ink"
          : "border border-line bg-surface text-ink-soft hover:border-ink-faint hover:text-ink"
      }`}
    >
      {children}
      {count !== null && (
        <span className="tnum ml-1.5 opacity-70">{num(count)}</span>
      )}
    </Link>
  );
}

/**
 * 묶음 크기 버튼.
 * 점수 구간과 마찬가지로, 고르면 1쪽으로 돌아갑니다.
 */
function SizeChip({
  tab,
  size,
  on,
  keep = "",
  title,
  children,
}: {
  tab: ReviewTab;
  size: SizeGroup | null;
  on: boolean;
  keep?: string;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={
        size === null
          ? `/review?tab=${tab}${keep}`
          : `/review?tab=${tab}&size=${size}${keep}`
      }
      title={title}
      aria-current={on ? "true" : undefined}
      className={`whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs transition-colors ${
        on
          ? "bg-accent font-semibold text-accent-ink"
          : "border border-line bg-surface text-ink-soft hover:border-ink-faint hover:text-ink"
      }`}
    >
      {children}
    </Link>
  );
}

function PairCard({
  pair,
  tab,
  back,
}: {
  pair: ReviewPair;
  tab: ReviewTab;
  back: string;
}) {
  const reasons = reasonText(pair.reasons);
  const isMine = tab === "mine";
  const same = pair.decision === "manual_merge";

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line-soft px-4 py-2.5 sm:px-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="tnum rounded-md bg-surface-2 px-2 py-0.5 text-xs font-semibold">
            {pair.score}점
          </span>
          {/*
            이 짝이 속한 책에 몇 권이 묶여 있는지.
            서점이 셋이라 3권이 정상입니다. 4권 이상은 한 서점에서 두 권이
            묶였다는 뜻이라 눈에 띄게 표시합니다.
          */}
          {pair.groupSize !== null && (
            <span
              title={SIZE_HELP[sizeGroupOf(pair.groupSize)]}
              className={`tnum rounded-md px-2 py-0.5 text-xs font-medium ${
                pair.groupSize >= 4
                  ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                  : "bg-surface-2 text-ink-soft"
              }`}
            >
              {pair.groupSize}권 묶임
              {pair.groupSize >= 4 && " ⚠️"}
            </span>
          )}
          {reasons.map((r, i) => (
            <ReasonChip key={i} reason={r} />
          ))}
        </div>
        {isMine && (
          <span
            className={`rounded-md px-2 py-0.5 text-xs font-semibold ${
              same
                ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                : "bg-red-500/10 text-red-700 dark:text-red-400"
            }`}
          >
            {same ? "같은 책이라고 하심" : "다른 책이라고 하심"}
          </span>
        )}
      </div>

      <div className="grid gap-3 px-4 py-3.5 sm:grid-cols-2 sm:px-5">
        <BookSide book={pair.a} other={pair.b} />
        <BookSide book={pair.b} other={pair.a} />
      </div>

      <div className="flex flex-wrap gap-2 border-t border-line-soft px-4 py-3 sm:px-5">
        {isMine ? (
          <DecideButton id={pair.id} action="undo" back={back} tone="plain">
            되돌리기
          </DecideButton>
        ) : (
          <>
            <DecideButton id={pair.id} action="merge" back={back} tone="good">
              같은 책입니다
            </DecideButton>
            <DecideButton id={pair.id} action="split" back={back} tone="bad">
              다른 책입니다
            </DecideButton>
          </>
        )}
      </div>
    </Card>
  );
}

function ReasonChip({ reason }: { reason: Reason }) {
  const tone =
    reason.tone === "good"
      ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
      : reason.tone === "bad"
        ? "bg-red-500/10 text-red-700 dark:text-red-400"
        : "bg-surface-2 text-ink-soft";
  return (
    <span className={`rounded-md px-2 py-0.5 text-xs ${tone}`}>
      {reason.label}
    </span>
  );
}

/**
 * 한쪽 책.
 *
 * 다른 쪽과 값이 다른 칸은 굵게 표시합니다.
 * 눈으로 두 줄을 비교하는 것보다, 다른 곳만 눈에 띄는 편이 훨씬 빠릅니다.
 */
function BookSide({ book, other }: { book: ReviewBook; other: ReviewBook }) {
  const s = store(book.storeId);
  const diff = (a: string | null, b: string | null) =>
    (a ?? "") !== (b ?? "") ? "font-semibold text-ink" : "text-ink-soft";

  return (
    <div className="flex gap-3 rounded-xl border border-line-soft p-3">
      <Cover url={book.coverUrl} alt={book.title} className="h-24 w-16" />
      <div className="min-w-0 space-y-1 text-xs">
        <span className={`inline-block rounded-md px-2 py-0.5 text-2xs ${s.chip}`}>
          {s.name}
        </span>
        <p className={`text-sm leading-snug ${diff(book.title, other.title)}`}>
          {book.title}
        </p>
        <p className={diff(book.author, other.author)}>
          저자 {book.author || <NoValue />}
        </p>
        <p className={diff(book.publisher, other.publisher)}>
          출판사 {book.publisher || <NoValue />}
        </p>
        <p className={diff(book.pubYm, other.pubYm)}>
          출간 {book.pubYm || <NoValue />}
        </p>
        <p className={`tnum ${diff(book.isbn13, other.isbn13)}`}>
          ISBN {book.isbn13 || <NoValue />}
        </p>
      </div>
    </div>
  );
}

/** 값이 없는 것과 0 은 다릅니다. 지어내지 않고 '없음' 이라고 적습니다. */
function NoValue() {
  return <span className="text-ink-faint">없음</span>;
}

function DecideButton({
  id,
  action,
  back,
  tone,
  children,
}: {
  id: number;
  action: "merge" | "split" | "undo";
  back: string;
  tone: "good" | "bad" | "plain";
  children: React.ReactNode;
}) {
  const cls =
    tone === "good"
      ? "border-emerald-400 text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-400"
      : tone === "bad"
        ? "border-red-400 text-red-700 hover:bg-red-500/10 dark:text-red-400"
        : "border-line text-ink-soft hover:bg-surface-2";

  return (
    // 자료를 바꾸는 일이라 링크가 아니라 버튼(POST)입니다.
    // 링크로 두면 남이 보낸 주소를 눌렀을 때 나도 모르게 눌리게 됩니다.
    <form action="/review/decide" method="post">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="action" value={action} />
      <input type="hidden" name="back" value={back} />
      <button
        type="submit"
        className={`rounded-xl border px-3.5 py-2 text-sm font-medium ${cls}`}
      >
        {children}
      </button>
    </form>
  );
}

/** 버튼을 누르고 돌아왔을 때 뜨는 한 줄 */
function Message({
  code,
  params,
}: {
  code: string;
  params: Record<string, string | undefined>;
}) {
  // 엑셀 반영 결과는 숫자를 그대로 보여줍니다.
  // "완료" 만 뜨고 실제로는 0건인 상황을 만들지 않기 위해서입니다.
  if (code === "imported") {
    const n = (k: string) => Number(params[k] ?? 0);
    const bits = [
      `✅ ${n("ok")}건 반영했습니다`,
      n("skip") ? `${n("skip")}건은 결정 칸이 비어 건너뜀` : "",
      n("bad") ? `${n("bad")}건은 적힌 말을 못 알아봄` : "",
      n("noauto") ? `${n("noauto")}건은 원래 판단을 몰라 못 되돌림` : "",
      n("fail") ? `🚨 ${n("fail")}건은 반영되지 않음` : "",
    ].filter(Boolean);
    return (
      <p
        role="status"
        className={`rounded-xl border px-3 py-2.5 text-sm ${
          n("fail")
            ? "border-red-300 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
            : "border-line bg-surface-2 text-ink-soft"
        }`}
      >
        {bits.join(" · ")}
        {n("ok") > 0 && " — 순위 화면에는 내일 아침 반영됩니다."}
      </p>
    );
  }
  if (code === "badfile") {
    return (
      <p
        role="status"
        className="rounded-xl border border-red-300 bg-red-50 px-3 py-2.5 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
      >
        ❌ {params.why || "파일을 읽지 못했습니다."}{" "}
        <strong>한 줄도 반영하지 않았습니다.</strong>
      </p>
    );
  }

  const map: Record<string, { text: string; bad?: boolean }> = {
    merged: { text: "✅ 같은 책으로 저장했습니다. 내일 아침 순위에 반영됩니다." },
    split: { text: "✅ 다른 책으로 저장했습니다. 내일 아침 순위에 반영됩니다." },
    undone: { text: "✅ 되돌렸습니다. 기계의 판단으로 돌아갑니다." },
    notadmin: { text: "권한이 없습니다. 관리자만 고칠 수 있습니다.", bad: true },
    needsql: {
      text: "아직 준비가 안 됐습니다. Supabase 에서 db/auth.sql 을 실행해 주세요.",
      bad: true,
    },
    noauto: {
      text: "원래 판단이 기록돼 있지 않아 되돌릴 수 없습니다. (db/auth.sql 실행 전에 내린 결정)",
      bad: true,
    },
    nochange: {
      text: "아무것도 바뀌지 않았습니다. 권한이 없거나 이미 지워진 짝입니다.",
      bad: true,
    },
    dberror: { text: "저장하지 못했습니다. 잠시 뒤 다시 시도해 주세요.", bad: true },
    badid: { text: "잘못된 요청입니다.", bad: true },
    badaction: { text: "잘못된 요청입니다.", bad: true },
    nofile: { text: "파일을 고르지 않으셨습니다.", bad: true },
    toobig: { text: "파일이 너무 큽니다 (5MB 넘음).", bad: true },
    toomany: {
      text: "한 번에 2,000건까지만 반영합니다. 나눠서 올려 주세요.",
      bad: true,
    },
    nothing: {
      text: "결정 칸이 모두 비어 있어 반영할 것이 없었습니다. (오류가 아닙니다)",
    },
  };
  const m = map[code];
  if (!m) return null;

  return (
    <p
      role="status"
      className={`rounded-xl border px-3 py-2.5 text-sm ${
        m.bad
          ? "border-red-300 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
          : "border-line bg-surface-2 text-ink-soft"
      }`}
    >
      {m.text}
    </p>
  );
}
