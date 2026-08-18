import Link from "next/link";
import Cover from "@/components/Cover";
import { Card, Empty } from "@/components/ui";
import { configError, currentRole } from "@/lib/supabase";
import { store } from "@/lib/stores";
import { searchBooksToJoin, type JoinBook } from "@/lib/join";
import { JOIN_SEARCH_CAP, MAX_JOIN } from "@/lib/join-pairs";

export const metadata = { title: "강제로 묶기" };

/**
 * 강제로 묶기 — 규칙이 갈라 놓은 책을 사람이 직접 이어 붙이는 화면.
 *
 * 【2026-08-12 대표님 요청】
 *   "다르다고 매칭된 것 중에 내가 수동으로 이어주고 싶은 게 있거든?
 *    모든 걸 규정화할 수는 없으니까."
 *
 * 검토 화면([매칭 검토])은 **이미 이어진 짝**을 다룹니다. 규칙이
 * "다른 책" 이라고 한 짝은 저장조차 안 되어 있어서 거기서는 손댈 수가
 * 없습니다. 그래서 여기서는 짝이 아니라 **상품을 직접 찾아서** 고릅니다.
 */
export default async function JoinPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; msg?: string; n?: string; pairs?: string;
    ok?: string; want?: string; max?: string }>;
}) {
  if (configError) {
    return (
      <div className="rounded-2xl border border-amber-300 bg-amber-50 p-6 text-sm text-amber-900">
        {configError}
      </div>
    );
  }

  const params = await searchParams;
  const q = (params.q ?? "").slice(0, 60);
  const role = await currentRole();

  if (role !== "admin") {
    return (
      <Card className="p-6">
        <p className="text-sm text-ink-soft">
          이 화면은 관리자만 쓸 수 있습니다.
        </p>
      </Card>
    );
  }

  const found = q ? await searchBooksToJoin(q) : { rows: [], capped: false, ok: true };
  const back = `/review/join${q ? `?q=${encodeURIComponent(q)}` : ""}`;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">강제로 묶기</h1>
        <p className="mt-1 text-sm text-ink-soft">
          규칙이 &lsquo;다른 책&rsquo; 이라고 갈라 놓은 것을 직접 이어 붙입니다.
        </p>
      </div>

      {params.msg && <Message params={params} />}

      {/* 🚨 도움말은 접어 둡니다 (2026-08-18 대표님 지적) */}
      <details className="overflow-hidden rounded-2xl border border-line bg-surface">
        <summary className="cursor-pointer list-none px-4 py-2.5 text-xs font-semibold text-ink-soft hover:bg-surface-2 sm:px-5">
          이 화면은 언제 쓰나요 ▾
        </summary>
        <div className="border-t border-line-soft p-4 text-xs leading-relaxed text-ink-soft sm:p-5">
        <p className="mt-1">
          예를 들어 아래 둘은 저자·출판사·출간월·정가가 전부 같은데
          <strong> 「리커버」 </strong>
          한 단어 때문에 규칙상 반드시 갈라집니다.
        </p>
        <pre className="scroll-x mt-2 rounded-lg bg-surface-2 p-3 text-2xs leading-relaxed">
{`안녕이라 그랬어 (집 에디션)        김애란 · 문학동네 · 2025-06 · 16,800원
안녕이라 그랬어(집에디션 리커버)    김애란 · 문학동네 · 2025-06 · 16,800원`}
        </pre>
        <p className="mt-2">
          규칙이 고장 난 게 아니라 &lsquo;개정판·리커버·양장본은 별도 도서&rsquo;
          규칙이 그대로 작동한 것입니다. 그래서 규칙을 푸는 대신
          <strong> 여기서 예외를 만듭니다.</strong>
        </p>
        <ul className="mt-2 list-disc space-y-1 pl-4">
          <li>
            여기서 누른 결정은 <strong>자동 규칙이 절대 못 뒤집습니다.</strong>
          </li>
          <li>
            <strong>순위 화면에는 내일 아침</strong>(다음 [도서 매칭]) 반영됩니다.
            지금 당장 바뀌지 않아도 정상입니다.
          </li>
          <li>
            잘못 누르셨으면 [매칭 검토] → <strong>내가 내린 결정</strong> 에서
            되돌릴 수 있습니다.
          </li>
          <li>
            이미 다른 책들과 묶여 있는 상품을 고르면,{" "}
            <strong>그 묶음들이 통째로 하나가 됩니다.</strong> 아래
            &lsquo;도서번호&rsquo; 를 보고 판단하세요.
          </li>
        </ul>
        </div>
      </details>

      {/* ---------- 찾기 ---------- */}
      <form action="/review/join" role="search" className="flex flex-wrap gap-2">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="제목·저자·출판사로 찾기"
          maxLength={60}
          aria-label="묶을 책 찾기"
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
        <Empty>
          묶고 싶은 책의 제목을 위에 넣고 [찾기] 를 누르세요.
        </Empty>
      ) : !found.ok ? (
        <Card className="p-5 text-sm text-red-700 dark:text-red-300">
          찾는 중에 문제가 생겼습니다. 잠시 뒤 다시 시도해 주세요.
        </Card>
      ) : found.rows.length === 0 ? (
        <Empty>
          <strong>{q}</strong> 로 찾은 상품이 없습니다.
        </Empty>
      ) : (
        <form action="/review/join/decide" method="post" className="space-y-3">
          <input type="hidden" name="back" value={back} />

          <p className="text-xs leading-relaxed text-ink-soft">
            <strong>{q}</strong> 로 찾은 상품 <strong>{found.rows.length}</strong>개.
            같은 책인 것을 <strong>2개 이상</strong> 고르세요 (최대 {MAX_JOIN}개).
            {/* 🚨 잘렸으면 반드시 적습니다. 조용히 자르면 '이게 전부' 로 오해합니다 */}
            {found.capped && (
              <span className="text-amber-700 dark:text-amber-400">
                {" "}
                결과가 {JOIN_SEARCH_CAP}개를 넘어 앞쪽만 보여 드립니다. 더 자세한
                말로 다시 찾아 주세요.
              </span>
            )}
          </p>

          <ul className="space-y-2">
            {found.rows.map((b) => (
              <li key={b.id}>
                <BookPick book={b} />
              </li>
            ))}
          </ul>

          <div className="sticky bottom-3 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface/95 px-4 py-3 backdrop-blur">
            <button
              type="submit"
              className="rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-accent-ink hover:opacity-90"
            >
              고른 책을 하나로 묶기
            </button>
            <span className="text-xs text-ink-faint">
              누르면 바로 저장됩니다. 되돌리기는 [매칭 검토] → 내가 내린 결정.
            </span>
          </div>
        </form>
      )}
    </div>
  );
}

/** 고를 수 있는 상품 한 줄 */
function BookPick({ book }: { book: JoinBook }) {
  const s = store(book.storeId);
  return (
    <label className="flex cursor-pointer gap-3 rounded-xl border border-line-soft p-3 hover:bg-surface-2">
      <input
        type="checkbox"
        name="id"
        value={book.id}
        className="mt-1 h-4 w-4 shrink-0 accent-[var(--accent)]"
      />
      <Cover url={book.coverUrl} alt={book.title} className="h-20 w-14 shrink-0" />
      <div className="min-w-0 space-y-1 text-xs">
        <span className={`inline-block rounded-md px-2 py-0.5 text-2xs ${s.chip}`}>
          {s.name}
        </span>
        <p className="text-sm font-medium leading-snug text-ink">{book.title}</p>
        <p className="text-ink-soft">
          {book.author || <NoValue />} · {book.publisher || <NoValue />} ·{" "}
          {book.pubYm || <NoValue />} ·{" "}
          <span className="tnum">
            {book.listPrice ? `${book.listPrice.toLocaleString()}원` : <NoValue />}
          </span>
        </p>
        <p className="tnum text-2xs text-ink-faint">
          {/*
            같은 도서번호끼리는 **이미 한 책** 입니다. 그걸 모르고 고르면
            "묶었는데 아무 변화가 없다" 고 느끼십니다. 그래서 적어 둡니다.
          */}
          {book.bookId ? `도서번호 ${book.bookId}` : "아직 어느 책에도 안 묶임"}
          {" · "}상품번호 {book.id}
        </p>
      </div>
    </label>
  );
}

function NoValue() {
  return <span className="text-ink-faint">없음</span>;
}

function Message({
  params,
}: {
  params: Record<string, string | undefined>;
}) {
  const code = params.msg ?? "";
  const n = (k: string) => Number(params[k] ?? 0);

  const map: Record<string, { text: string; bad?: boolean }> = {
    joined: {
      text:
        `✅ ${n("n")}권을 하나로 묶었습니다 (짝 ${n("pairs")}개 저장). ` +
        `순위 화면에는 내일 아침 [도서 매칭] 이 돌고 나면 반영됩니다.`,
    },
    needtwo: { text: "고른 것이 없거나 하나뿐입니다. 2개 이상 골라 주세요.", bad: true },
    toomany: {
      text: `한 번에 ${params.max ?? MAX_JOIN}개까지만 묶을 수 있습니다.`,
      bad: true,
    },
    gone: {
      text: "고르신 상품 중에 사라진 것이 있습니다. 다시 찾아서 골라 주세요.",
      bad: true,
    },
    notadmin: { text: "관리자만 쓸 수 있습니다.", bad: true },
    needsql: {
      text:
        "🚨 데이터베이스에 아직 권한이 안 열려 있습니다. db/force-join.sql 을 " +
        "Supabase 의 SQL Editor 에서 한 번 실행해 주세요. (한 줄도 저장되지 않았습니다)",
      bad: true,
    },
    partial: {
      text:
        `🚨 ${n("want")}개 중 ${n("ok")}개만 저장됐습니다. ` +
        `저에게 알려 주세요.`,
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
