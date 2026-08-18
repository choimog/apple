import Link from "next/link";
import { Card, Empty } from "@/components/ui";
import { configError, currentRole } from "@/lib/supabase";
import { num } from "@/lib/format";
import {
  ALIAS_SCAN_CAP,
  listAliasGroups,
  MAX_ALIAS,
  searchPublisherNames,
  type PubName,
} from "@/lib/pubalias";

export const metadata = { title: "출판사 묶기" };

/**
 * 출판사 묶기 — "이 둘은 같은 출판사" 를 사람이 정해 두는 화면.
 *
 * 【2026-08-12 대표님 요청】
 *   "청림Life 랑 청림라이프처럼, 서점마다 출판사를 표기하는 명칭이
 *    조금씩 다른데 이것도 다 규칙화하기 어려울 것 같아서.
 *    지금 규칙으로 나오는 결과가 마음에 들어서 괜히 건드렸다가 꼬이게
 *    하고 싶지 않아서 저런 방식을 따로 만들고 싶은데 어때?"
 *
 * 규칙(config/matching.yaml)은 한 글자도 건드리지 않습니다.
 * 여기서 정한 것만 예외로 얹힙니다.
 */
export default async function PublisherAliasPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string; msg?: string; n?: string; name?: string;
    ok?: string; want?: string; max?: string;
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
  const q = (params.q ?? "").slice(0, 40);
  const role = await currentRole();

  if (role !== "admin") {
    return (
      <Card className="p-6">
        <p className="text-sm text-ink-soft">이 화면은 관리자만 쓸 수 있습니다.</p>
      </Card>
    );
  }

  const [{ groups, ok, needsSql }, found] = await Promise.all([
    listAliasGroups(),
    q ? searchPublisherNames(q) : Promise.resolve({ rows: [], capped: false, ok: true }),
  ]);
  const back = `/review/publishers${q ? `?q=${encodeURIComponent(q)}` : ""}`;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">출판사 묶기</h1>
        <p className="mt-1 text-sm text-ink-soft">
          서점마다 다르게 적는 같은 출판사를 하나로 봅니다.
        </p>
      </div>

      {params.msg && <Message params={params} />}

      {needsSql && (
        <p
          role="status"
          className="rounded-xl border border-red-300 bg-red-50 px-3 py-2.5 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
        >
          🚨 아직 준비가 안 됐습니다. <strong>db/publisher-alias.sql</strong> 을
          Supabase 의 [SQL Editor] 에서 한 번 실행해 주세요.
        </p>
      )}

      {/* 🚨 도움말은 접어 둡니다 (2026-08-18 대표님 지적 — 설명이 장황함).
          지우지는 않습니다. 처음 쓰실 때는 필요한 내용입니다. */}
      <details className="overflow-hidden rounded-2xl border border-line bg-surface">
        <summary className="cursor-pointer list-none px-4 py-2.5 text-xs font-semibold text-ink-soft hover:bg-surface-2 sm:px-5">
          이 화면은 언제 쓰나요 ▾
        </summary>
        <div className="border-t border-line-soft p-4 text-xs leading-relaxed text-ink-soft sm:p-5">
        <p>
          글자만 보면 남남인데 실제로는 같은 출판사인 경우입니다.
        </p>
        <pre className="scroll-x mt-2 rounded-lg bg-surface-2 p-3 text-2xs leading-relaxed">
{`청림Life   vs  청림라이프      닮은 정도 0.24   ← 기준 0.80 에 한참 못 미침
윌북(willbook) vs 윌북          이건 프로그램이 이미 잡습니다 (괄호)`}
        </pre>
        <p className="mt-2">
          괄호로 밝혀 준 것은 이미 자동으로 잡습니다. 여기는{" "}
          <strong>어느 서점도 괄호로 안 적어 줘서 방법이 없는 경우</strong>에
          씁니다.
        </p>

        <p className="mt-3 font-semibold text-ink">무엇이 바뀌고, 무엇이 안 바뀌나</p>
        <ul className="mt-1 list-disc space-y-1 pl-4">
          <li>
            <strong>바뀌는 것</strong> — 두 이름을 같은 출판사로 봅니다. 그래서
            ① 같은 책 판정에서 출판사 때문에 갈라지지 않고, ② 출판사 순위에서
            한 줄로 합쳐집니다.
          </li>
          <li>
            <strong>안 바뀌는 것</strong> — 규칙(점수·기준값)은 한 글자도
            건드리지 않습니다. <strong>순위·판매지수 같은 숫자는 그대로</strong>
            입니다.
          </li>
          <li>
            <strong>되돌리기</strong> — [풀기] 를 누르면 다음 [도서 매칭]
            에서 원래대로 돌아갑니다.
          </li>
          <li>
            <strong>반영 시점</strong> — 다음 [도서 매칭] 부터입니다(보통 내일
            아침).
          </li>
        </ul>
        <p className="mt-3 text-amber-700 dark:text-amber-400">
          ⚠️ <strong>진짜로 다른 출판사를 묶으면 그 책들이 섞입니다.</strong>{" "}
          창비 / 창비교육, 김영사 / 김영사on 처럼 이름이 닮았지만 다른 곳은
          묶지 마세요. 실수하셨으면 [풀기] 로 되돌리면 됩니다.
        </p>
        </div>
      </details>

      {/* ---------- 지금 정해 둔 무리 ---------- */}
      <Card>
        <div className="border-b border-line-soft px-4 py-3 sm:px-5">
          <p className="text-sm font-semibold">
            지금 정해 둔 무리{" "}
            <span className="tnum text-ink-faint">{num(groups.length)}개</span>
          </p>
        </div>
        {!ok || groups.length === 0 ? (
          <Empty>아직 없습니다. 아래에서 찾아 묶으세요.</Empty>
        ) : (
          <ul className="divide-y divide-line-soft">
            {groups.map((g) => (
              <li
                key={g.canonical}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{g.canonical}</p>
                  <p className="mt-0.5 text-xs text-ink-soft">
                    {g.names.map((n) => n.sample || n.key).join("  ·  ")}
                  </p>
                </div>
                <form action="/review/publishers/decide" method="post">
                  <input type="hidden" name="back" value={back} />
                  <input type="hidden" name="action" value="unjoin" />
                  <input type="hidden" name="canonical" value={g.canonical} />
                  <button
                    type="submit"
                    className="shrink-0 rounded-lg border border-line px-3 py-1.5 text-xs hover:border-ink-faint"
                  >
                    풀기
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* ---------- 찾기 ---------- */}
      <form action="/review/publishers" role="search" className="flex flex-wrap gap-2">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="출판사 이름으로 찾기 (예: 청림)"
          maxLength={40}
          aria-label="출판사 찾기"
          className="min-w-0 flex-1 rounded-xl border border-line bg-surface px-3 py-2.5 text-sm"
        />
        <button
          type="submit"
          className="rounded-xl border border-line px-4 py-2.5 text-sm font-medium hover:border-ink-faint"
        >
          찾기
        </button>
        <Link
          href="/review"
          className="rounded-xl px-3 py-2.5 text-sm text-ink-soft hover:text-ink"
        >
          매칭 검토로 →
        </Link>
      </form>

      {!q ? (
        <Empty>묶고 싶은 출판사 이름의 일부를 넣고 [찾기] 를 누르세요.</Empty>
      ) : !found.ok ? (
        <Card className="p-5 text-sm text-red-700 dark:text-red-300">
          찾는 중에 문제가 생겼습니다. 잠시 뒤 다시 시도해 주세요.
        </Card>
      ) : found.rows.length === 0 ? (
        <Empty>
          <strong>{q}</strong> 로 찾은 출판사가 없습니다.
        </Empty>
      ) : (
        <form action="/review/publishers/decide" method="post" className="space-y-3">
          <input type="hidden" name="back" value={back} />
          <input type="hidden" name="action" value="join" />

          <p className="text-xs leading-relaxed text-ink-soft">
            <strong>{q}</strong> 로 찾은 출판사{" "}
            <strong>{found.rows.length}</strong>곳. 같은 곳인 것을{" "}
            <strong>2개 이상</strong> 고르세요 (최대 {MAX_ALIAS}개).
            {/* 🚨 잘렸으면 반드시 적습니다 */}
            {found.capped && (
              <span className="text-amber-700 dark:text-amber-400">
                {" "}
                상품 {ALIAS_SCAN_CAP}개까지만 훑었습니다. 빠진 표기가 있을 수
                있으니 더 좁은 말로 다시 찾아 주세요.
              </span>
            )}
          </p>

          <ul className="space-y-2">
            {found.rows.map((p) => (
              <li key={p.key}>
                <NamePick name={p} />
              </li>
            ))}
          </ul>

          <div className="sticky bottom-3 space-y-2 rounded-xl border border-line bg-surface/95 px-4 py-3 backdrop-blur">
            <label className="block text-xs font-medium text-ink-soft">
              화면에 쓸 대표 이름
              <input
                type="text"
                name="canonical"
                required
                maxLength={80}
                placeholder="예: 청림라이프"
                className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm"
              />
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="submit"
                className="rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-accent-ink hover:opacity-90"
              >
                고른 출판사를 하나로 묶기
              </button>
              <span className="text-xs text-ink-faint">
                순위 화면에는 다음 [도서 매칭] 부터 반영됩니다.
              </span>
            </div>
          </div>
        </form>
      )}
    </div>
  );
}

/** 고를 수 있는 출판사 한 줄 */
function NamePick({ name }: { name: PubName }) {
  return (
    <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-line-soft p-3 hover:bg-surface-2">
      <input
        type="checkbox"
        name="key"
        value={name.key}
        className="h-4 w-4 shrink-0 accent-[var(--accent)]"
      />
      {/* 서점이 적은 표기를 함께 보내 목록에서 알아보게 합니다 */}
      <input type="hidden" name="sample" value={`${name.key} ${name.sample}`} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink">{name.sample}</p>
        <p className="tnum mt-0.5 text-2xs text-ink-faint">
          상품 {num(name.count)}개
          {name.canonical && (
            <span className="text-amber-700 dark:text-amber-400">
              {" · "}이미 「{name.canonical}」 무리에 있음
            </span>
          )}
        </p>
      </div>
    </label>
  );
}

function Message({ params }: { params: Record<string, string | undefined> }) {
  const code = params.msg ?? "";
  const n = (k: string) => Number(params[k] ?? 0);

  const map: Record<string, { text: string; bad?: boolean }> = {
    joined: {
      text:
        `✅ ${n("n")}개 이름을 「${params.name ?? ""}」 하나로 묶었습니다. ` +
        `다음 [도서 매칭] 부터 반영됩니다.`,
    },
    unjoined: {
      text: `✅ 풀었습니다 (${n("n")}개 이름). 다음 [도서 매칭] 에서 원래대로 돌아갑니다.`,
    },
    needtwo: { text: "고른 것이 없거나 하나뿐입니다. 2개 이상 골라 주세요.", bad: true },
    toomany: {
      text: `한 번에 ${params.max ?? MAX_ALIAS}개까지만 묶을 수 있습니다.`,
      bad: true,
    },
    badname: { text: "화면에 쓸 대표 이름을 적어 주세요.", bad: true },
    badinput: { text: "무엇을 풀지 알 수 없습니다.", bad: true },
    notadmin: { text: "관리자만 쓸 수 있습니다.", bad: true },
    nochange: { text: "바뀐 것이 없습니다. 이미 풀렸을 수 있습니다.", bad: true },
    needsql: {
      text:
        "🚨 아직 준비가 안 됐습니다. db/publisher-alias.sql 을 Supabase 의 " +
        "[SQL Editor] 에서 한 번 실행해 주세요. (한 줄도 저장되지 않았습니다)",
      bad: true,
    },
    partial: {
      text: `🚨 ${n("want")}개 중 ${n("ok")}개만 저장됐습니다. 저에게 알려 주세요.`,
      bad: true,
    },
    dberror: { text: "저장 중에 문제가 생겼습니다. 잠시 뒤 다시 시도해 주세요.", bad: true },
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
