"use client";

/**
 * [전체 한 번에 내려받기] — 브라우저가 나눠서 가져와 파일로 만듭니다.
 *
 * 【왜 이렇게 하나요? — 2026-08-10】
 * 서버가 한 번에 다 만들어 보내는 방식은 두 번 잘렸습니다
 * (29,502줄 · 36,002줄). 서버에는 요청 하나에 60초 제한이 있어서,
 * 자료가 늘면 언젠가 또 걸립니다.
 *
 * 그래서 500줄씩 여러 번 나눠 가져옵니다. 한 번은 1초도 안 걸립니다.
 * 그리고 **몇 줄까지 왔는지 보여 드립니다.** 멈춘 것처럼 보이는 시간이
 * 없어야 하니까요.
 *
 * 🚨 한 조각이라도 실패하면 **파일을 만들지 않고 멈춥니다.**
 *    잘린 파일이 완성본인 척 저장되는 것이 가장 위험합니다.
 */

import { useState } from "react";
import { CSV_BOM, csvLine } from "@/lib/csv";
import { SHEET_HEADER, noteRow } from "@/lib/review-sheet";

const TABS: { key: string; label: string }[] = [
  { key: "pending", label: "검토 대기" },
  { key: "merged", label: "자동으로 묶은 것" },
  { key: "mine", label: "내가 내린 결정" },
];

/** 끝없이 도는 것을 막는 안전장치 */
const MAX_ROUNDS = 4000;

export default function ExportAll() {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);
  const [where, setWhere] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setDone(0);
    setError(null);

    const lines: string[] = [csvLine([...SHEET_HEADER])];
    let total = 0;

    try {
      for (const t of TABS) {
        setWhere(t.label);
        lines.push(csvLine(noteRow(`──── ${t.label} ────`)));

        let after = 0;
        let got = 0;
        for (let round = 0; round < MAX_ROUNDS; round++) {
          const res = await fetch(
            `/review/sheet/chunk?tab=${t.key}&after=${after}`,
            { cache: "no-store" }
          );
          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(
              `${t.label} 를 가져오다 멈췄습니다: ${body.error ?? res.status}`
            );
          }
          const data = (await res.json()) as {
            rows: unknown[][];
            next: number | null;
          };
          for (const r of data.rows) lines.push(csvLine(r));
          got += data.rows.length;
          total += data.rows.length;
          setDone(total);
          if (data.next === null) break;
          after = data.next;
        }

        if (got === 0) lines.push(csvLine(noteRow("(이 칸에는 없습니다)")));
      }

      // 🚨 이 줄이 있어야 다 받은 것입니다.
      lines.push(csvLine(noteRow(`✅ 여기까지가 전부입니다 (총 ${total}건)`)));

      const blob = new Blob([CSV_BOM + lines.join("\r\n")], {
        type: "text/csv;charset=utf-8;",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `매칭검토_전체_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      setWhere("");
    } catch (e) {
      // 파일을 만들지 않습니다. 반쪽짜리 파일보다 아무것도 없는 편이 낫습니다.
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={run}
        disabled={busy}
        className="inline-block rounded-xl border border-ink-faint bg-surface-2 px-3.5 py-2 text-sm font-medium hover:border-ink disabled:opacity-60"
      >
        {busy ? "받는 중…" : "전체 한 번에 내려받기"}
      </button>

      {busy && (
        <p className="mt-1.5 text-xs text-ink-soft">
          {where} 가져오는 중 · 지금까지 <strong>{done.toLocaleString()}</strong>줄
          <br />
          <span className="text-ink-faint">
            이 화면을 닫지 말아 주세요. 다 받으면 저절로 저장됩니다.
          </span>
        </p>
      )}

      {error && (
        <p className="mt-1.5 text-xs leading-relaxed text-red-700 dark:text-red-400">
          ⚠️ {error}
          <br />
          <span className="text-ink-faint">
            반쪽짜리 파일을 드리지 않으려고 저장하지 않았습니다. 다시 눌러
            주세요. 계속 안 되면 이 문구를 알려 주세요.
          </span>
        </p>
      )}
    </div>
  );
}
