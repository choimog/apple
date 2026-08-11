"use client";

/**
 * 채워 온 엑셀을 올려서 결정을 반영합니다 — 브라우저가 읽고 나눠 보냅니다.
 *
 * 【왜 이렇게 하나요? — 2026-08-10 대표님 신고】
 *   413: PAYLOAD_TOO_LARGE
 *
 * 파일을 통째로 올리는 방식은 4.5MB 까지만 받습니다. 검토 목록이 3만
 * 줄을 넘으면서 파일이 그 선을 넘었습니다.
 *
 * 그래서 **파일을 올리지 않습니다.** 브라우저가 파일을 읽어서
 * '짝번호와 결정' 만 추려 500건씩 나눠 보냅니다. 3만 건이라도 한 번에
 * 가는 양은 10KB 안팎입니다.
 *
 * 덤으로, 파일이 잘못됐는지를 **올리기 전에** 바로 알려 드릴 수 있습니다.
 */

import { useState } from "react";
import { parseSheet, type SheetRow } from "@/lib/review-sheet";

const PER_CALL = 500;

type Result = {
  applied: number;
  failed: number;
  noAuto: number;
  blank: number;
  unknown: { line: number; text: string }[];
  badId: number[];
};

export default function ImportSheet() {
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(0);
  const [total, setTotal] = useState(0);
  const [fatal, setFatal] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // 같은 파일을 다시 고를 수 있게
    if (!file) return;

    setBusy(true);
    setFatal(null);
    setResult(null);
    setSent(0);

    try {
      const parsed = parseSheet(await file.text());

      // 🚨 엉뚱한 파일이면 **한 건도 보내지 않습니다.**
      if (parsed.fatal) {
        setFatal(parsed.fatal);
        return;
      }
      if (parsed.rows.length === 0) {
        setResult({
          applied: 0, failed: 0, noAuto: 0,
          blank: parsed.blank, unknown: parsed.unknown, badId: parsed.badId,
        });
        return;
      }

      setTotal(parsed.rows.length);
      let applied = 0;
      let failed = 0;
      let noAuto = 0;

      for (let i = 0; i < parsed.rows.length; i += PER_CALL) {
        const part: SheetRow[] = parsed.rows.slice(i, i + PER_CALL);
        const res = await fetch("/review/import/chunk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rows: part }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(
            `${i + 1}번째 줄부터 반영하다 멈췄습니다: ${body.error ?? res.status}\n` +
              `여기까지 ${applied}건은 이미 반영됐습니다.`
          );
        }
        const r = (await res.json()) as {
          applied: number; failed: number; noAuto: number;
        };
        applied += r.applied;
        failed += r.failed;
        noAuto += r.noAuto;
        setSent(Math.min(i + PER_CALL, parsed.rows.length));
      }

      setResult({
        applied, failed, noAuto,
        blank: parsed.blank, unknown: parsed.unknown, badId: parsed.badId,
      });
    } catch (err) {
      setFatal(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <label className="mt-2 inline-block">
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={onFile}
          disabled={busy}
          className="max-w-full text-xs file:mr-2 file:rounded-lg file:border file:border-line file:bg-surface-2 file:px-3 file:py-1.5 file:text-xs"
        />
      </label>

      {busy && (
        <p className="mt-1.5 text-xs text-ink-soft">
          반영하는 중 · {sent.toLocaleString()} / {total.toLocaleString()}건
          <br />
          <span className="text-ink-faint">이 화면을 닫지 말아 주세요.</span>
        </p>
      )}

      {fatal && (
        <p className="mt-1.5 whitespace-pre-line text-xs leading-relaxed text-red-700 dark:text-red-400">
          ⚠️ {fatal}
        </p>
      )}

      {result && (
        <div className="mt-2 rounded-lg border border-line bg-surface-2 px-3 py-2 text-xs leading-relaxed">
          <p className="font-semibold">
            {result.applied > 0
              ? `✅ ${result.applied.toLocaleString()}건 반영했습니다`
              : "반영된 것이 없습니다"}
          </p>
          <ul className="mt-1 space-y-0.5 text-ink-soft">
            {result.blank > 0 && (
              <li>· 빈칸이라 넘어감 {result.blank.toLocaleString()}건 (정상입니다)</li>
            )}
            {result.unknown.length > 0 && (
              <li className="text-amber-700 dark:text-amber-400">
                · 모르는 말이 적혀 있어 넘어감 {result.unknown.length}건 (
                {result.unknown.slice(0, 3).map((u) => `${u.line}줄 "${u.text}"`).join(", ")}
                {result.unknown.length > 3 ? " …" : ""})
              </li>
            )}
            {result.badId.length > 0 && (
              <li className="text-amber-700 dark:text-amber-400">
                · 짝번호가 이상해서 넘어감 {result.badId.length}건
              </li>
            )}
            {result.noAuto > 0 && (
              <li>· 원래 판단을 몰라 되돌리지 못함 {result.noAuto}건</li>
            )}
            {result.failed > 0 && (
              <li className="text-red-700 dark:text-red-400">
                · 🚨 반영 안 됨 {result.failed.toLocaleString()}건 — 권한 문제일 수
                있습니다. 이 숫자를 알려 주세요.
              </li>
            )}
          </ul>
          {result.applied > 0 && (
            <div className="mt-1.5 space-y-1 text-ink-faint">
              <p>
                <button
                  type="button"
                  onClick={() => location.reload()}
                  className="underline underline-offset-2"
                >
                  목록 새로고침
                </button>
              </p>
              {/*
                【2026-08-10 대표님 질문】
                "순위 화면 반영은 다음날이라는데, 오늘 바로 할 수는 없나?"

                할 수 있습니다. 그런데 화면에는 '다음 날 아침' 이라고만
                적혀 있어서, 방법이 있는 줄 모르셨습니다. 안내가 빠진
                것이지 기능이 없던 게 아니었습니다.
              */}
              <p className="leading-relaxed">
                결정은 <strong>바로 저장됐습니다.</strong> 다만 순위 화면에
                반영되려면 <strong>같은 책 묶기</strong>를 한 번 다시
                돌려야 합니다. 그냥 두시면 내일 아침에 저절로 됩니다.
              </p>
              <p className="leading-relaxed">
                <strong>지금 바로 보고 싶으시면</strong>{" "}
                <a
                  href="https://github.com/choimog/apple/actions/workflows/match.yml"
                  target="_blank"
                  rel="noreferrer"
                  className="underline underline-offset-2"
                >
                  [도서 매칭] 페이지
                </a>
                에서 오른쪽 <strong>Run workflow</strong> 를 누르시면 됩니다.
                약 5분 걸리고 돈은 안 듭니다.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
