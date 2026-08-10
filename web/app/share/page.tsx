import Link from "next/link";
import DataError from "@/components/DataError";
import { Card, CardHead, Empty } from "@/components/ui";
import { configError, currentRole } from "@/lib/supabase";
import { buildStoreTree, getCategories, isWeekly } from "@/lib/queries";
import { listShareLinks } from "@/lib/share";
import { store } from "@/lib/stores";
import { kstDateTime } from "@/lib/format";

export const metadata = { title: "공유 링크" };

/**
 * 공유 링크 관리 — 관리자 전용.
 *
 * 계정을 안 만들어 드릴 분에게 **순위표 하나만** 보여주는 주소를 만듭니다.
 */
export default async function SharePage({
  searchParams,
}: {
  searchParams: Promise<{ msg?: string; new?: string }>;
}) {
  if (configError) {
    return (
      <div className="rounded-2xl border border-amber-300 bg-amber-50 p-6 text-sm text-amber-900">
        {configError}
      </div>
    );
  }

  const params = await searchParams;
  /*
    【2026-08-09 대표님 요청】
    "공유링크를 생성할 수 있는 기능을 다른 사람들한테도 오픈해달란 말이었어."

    그래서 이 화면은 **로그인한 회원 누구나** 볼 수 있습니다.
    다만 보이는 목록은 다릅니다.
      · 회원   → 자기가 만든 링크만
      · 관리자 → 전부 + 누가 만들었는지

    ⚠️ 그 구분은 화면이 아니라 **데이터베이스**가 합니다
       (db/share-open.sql 의 my_share_links / set_share_link).
       화면에서만 막으면 조건 하나 빠지는 순간 남의 링크가 보입니다.
  */
  const role = await currentRole();
  const isAdmin = role === "admin";

  let cats, links;
  try {
    [cats, links] = await Promise.all([getCategories(), listShareLinks()]);
  } catch (e) {
    return <DataError detail={String(e)} />;
  }

  const byId = new Map(cats.map((c) => [c.id, c]));
  const tree = buildStoreTree(cats);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">공유 링크</h1>
        <p className="mt-1 text-sm text-ink-soft">
          계정을 안 만들어 드릴 분에게 <strong>순위표 하나만</strong> 보여주는
          주소를 만듭니다. 그 주소로는 다른 화면을 볼 수 없고, 언제든 끌 수
          있습니다.
        </p>
      </div>

      {params.msg && <Message code={params.msg} />}

      {/* 방금 만든 주소 — 이때 한 번만 크게 보여줍니다 */}
      {params.new && (
        <Card className="border-emerald-400 bg-emerald-500/5 px-4 py-3.5 sm:px-5">
          <p className="text-sm font-semibold">✅ 주소를 만들었습니다</p>
          <p className="mt-1 text-xs text-ink-soft">
            아래 주소를 복사해서 보내주세요.
          </p>
          <code className="scroll-x mt-2 block rounded-lg border border-line bg-surface px-3 py-2 text-xs">
            /s/{params.new}
          </code>
          <p className="mt-1.5 text-xs text-ink-faint">
            사이트 주소 뒤에 붙이시면 됩니다. 예: <code>https://…/s/{params.new.slice(0, 12)}…</code>
          </p>
        </Card>
      )}

      {!links.ok ? (
        <Card className="p-6">
          <p className="text-sm font-semibold text-red-700 dark:text-red-400">
            아직 준비가 안 됐습니다
          </p>
          <p className="mt-2 text-sm leading-relaxed text-ink-soft">
            Supabase → SQL Editor 에서 <code>db/share.sql</code> 을 한 번
            실행해 주세요.
          </p>
        </Card>
      ) : (
        <>
          {/* ---------- 만들기 ---------- */}
          <Card>
            <CardHead
              title="새 주소 만들기"
              desc="분야를 고르면 그 분야의 최신 순위표를 보여주는 주소가 만들어집니다."
            />
            <form
              action="/share/action"
              method="post"
              className="space-y-3 px-4 py-3.5 sm:px-5"
            >
              <input type="hidden" name="do" value="create" />

              <div>
                <label htmlFor="cat" className="mb-1 block text-sm text-ink-soft">
                  어느 분야
                </label>
                <select
                  id="cat"
                  name="category"
                  required
                  defaultValue=""
                  className="w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-sm"
                >
                  <option value="" disabled>
                    고르세요
                  </option>
                  {tree.map((t) => {
                    const s = store(t.storeId);
                    return [
                      ...(t.daily.length
                        ? [
                            <optgroup key={`${t.storeId}-d`} label={`${s.name} · 일간`}>
                              {t.daily.map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.name}
                                </option>
                              ))}
                            </optgroup>,
                          ]
                        : []),
                      ...(t.weekly.length
                        ? [
                            <optgroup key={`${t.storeId}-w`} label={`${s.name} · 주간`}>
                              {t.weekly.map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.name}
                                </option>
                              ))}
                            </optgroup>,
                          ]
                        : []),
                      ...(t.branches.length
                        ? [
                            <optgroup key={`${t.storeId}-b`} label={`${s.name} · 매장별`}>
                              {t.branches.map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.branch_name} {c.name}
                                </option>
                              ))}
                            </optgroup>,
                          ]
                        : []),
                    ];
                  })}
                </select>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="label" className="mb-1 block text-sm text-ink-soft">
                    이름 <span className="text-ink-faint">(안 적어도 됩니다)</span>
                  </label>
                  <input
                    id="label"
                    name="label"
                    maxLength={60}
                    placeholder="예: 김대리에게 보낸 소설 순위"
                    className="w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-sm"
                  />
                </div>
                <div>
                  {/*
                    【2026-08-09 대표님 지시】
                    "한 사람이 2개까지 만들 수 있고, 최대 3시간까지 가능하도록."

                    회원은 **시간** 단위, 대표님은 예전처럼 **일** 단위입니다.
                    ⚠️ 실제 한도는 데이터베이스가 지킵니다(db/share-open.sql).
                       여기 목록은 '고르기 쉽게' 하는 것일 뿐, 화면을 고쳐서
                       더 긴 값을 보내도 3시간으로 잘립니다.
                  */}
                  <label htmlFor="days" className="mb-1 block text-sm text-ink-soft">
                    {isAdmin ? "며칠 뒤에 자동으로 꺼질지" : "몇 시간 뒤에 자동으로 꺼질지"}
                  </label>
                  <select
                    id="days"
                    name="days"
                    defaultValue={isAdmin ? "30" : "3"}
                    className="w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-sm"
                  >
                    {isAdmin ? (
                      <>
                        <option value="7">7일</option>
                        <option value="30">30일</option>
                        <option value="90">90일</option>
                        <option value="">기한 없음</option>
                      </>
                    ) : (
                      <>
                        <option value="1">1시간</option>
                        <option value="2">2시간</option>
                        <option value="3">3시간 (최대)</option>
                      </>
                    )}
                  </select>
                </div>
              </div>

              <button
                type="submit"
                className="rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-accent-ink"
              >
                주소 만들기
              </button>
            </form>
          </Card>

          {!isAdmin && (
        <p className="rounded-xl border border-line bg-surface-2 px-3 py-2.5 text-xs leading-relaxed text-ink-soft">
          만드신 주소는 <strong>로그인 없이 누구나</strong> 열 수 있습니다.
          받은 분에게는 그 순위표 하나만 보이고, 다른 화면은 안 보입니다.
          <br />
          한 사람이 동시에 <strong>2개</strong>까지, <strong>최대 3시간</strong>{" "}
          기한으로 만들 수 있습니다. 시간이 지나면 저절로 꺼집니다.
        </p>
      )}

      {/* ---------- 목록 ---------- */}
          <Card>
            <CardHead
              title={isAdmin ? "만든 주소 (회원 것 포함)" : "내가 만든 주소"}
              desc={
                isAdmin
                  ? "회원이 만든 것도 여기 다 보입니다. 누구 것이든 끄실 수 있습니다."
                  : "끄면 그 주소는 즉시 열리지 않습니다. 기록은 남습니다."
              }
            />
            {links.rows.length === 0 ? (
              <Empty title="아직 만든 주소가 없습니다" />
            ) : (
              <ul className="divide-y divide-line-soft">
                {links.rows.map((l) => {
                  const c = byId.get(Number(l.targetId.split("@")[0]));
                  const expired =
                    !!l.expiresAt && new Date(l.expiresAt).getTime() < Date.now();
                  const live = l.enabled && !expired;
                  return (
                    <li
                      key={l.token}
                      className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5"
                    >
                      <span
                        className={`shrink-0 rounded-md px-2 py-0.5 text-xs font-semibold ${
                          live
                            ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                            : "bg-surface-2 text-ink-faint"
                        }`}
                      >
                        {live ? "열림" : expired ? "기한 지남" : "꺼짐"}
                      </span>

                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {l.label ||
                            (c
                              ? `${store(c.store_id).name} ${c.branch_name || c.name}${
                                  isWeekly(c) ? " 주간" : ""
                                }`
                              : `분야 ${l.targetId}`)}
                        </p>
                        <p className="scroll-x text-xs text-ink-faint">
                          /s/{l.token}
                        </p>
                        <p className="text-2xs text-ink-faint">
                          {l.expiresAt
                            ? /* 3시간짜리는 날짜만 적으면 언제 꺼지는지 알 수 없습니다 */
                              `${kstDateTime(l.expiresAt) ?? l.expiresAt.slice(0, 10)} 까지`
                            : "기한 없음"}
                          {/*
                            누가 만들었는지는 관리자에게만 보입니다.
                            회원끼리 서로 이메일을 보게 하면 안 됩니다.
                            (그 판단은 데이터베이스가 합니다)
                          */}
                          {isAdmin && l.ownerEmail && !l.isMine && (
                            <>
                              {" · "}
                              <span className="font-medium text-ink-soft">
                                {l.ownerEmail}
                              </span>{" "}
                              님이 만듦
                            </>
                          )}
                        </p>
                      </div>

                      {live && (
                        <Link
                          href={`/s/${l.token}`}
                          target="_blank"
                          className="shrink-0 rounded-lg border border-line px-3 py-1.5 text-xs hover:border-ink-faint"
                        >
                          열어보기
                        </Link>
                      )}

                      <form action="/share/action" method="post" className="shrink-0">
                        <input type="hidden" name="do" value="toggle" />
                        <input type="hidden" name="token" value={l.token} />
                        <input
                          type="hidden"
                          name="enabled"
                          value={l.enabled ? "false" : "true"}
                        />
                        <button
                          type="submit"
                          className="rounded-lg border border-line px-3 py-1.5 text-xs hover:border-ink-faint"
                        >
                          {l.enabled ? "끄기" : "다시 켜기"}
                        </button>
                      </form>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

function Message({ code }: { code: string }) {
  const map: Record<string, { text: string; bad?: boolean }> = {
    off: { text: "✅ 껐습니다. 그 주소는 이제 열리지 않습니다." },
    on: { text: "✅ 다시 켰습니다." },
    notadmin: { text: "관리자만 할 수 있습니다.", bad: true },
    needsql: {
      text: "아직 준비가 안 됐습니다. Supabase 에서 db/share.sql 을 실행해 주세요.",
      bad: true,
    },
    badinput: { text: "분야를 골라 주세요.", bad: true },
    failed: { text: "실패했습니다. 잠시 뒤 다시 시도해 주세요.", bad: true },
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
