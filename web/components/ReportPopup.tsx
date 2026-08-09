"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import Markdown from "@/components/Markdown";
import { POPUP_KEY, shouldShow } from "@/lib/popup";

/**
 * 홈에 들어올 때 하루 한 번 뜨는 리포트 창.
 *
 * 【2026-08-09 대표님 요청】
 * "매일 홈에 들어갈 때 한번 정도는, 팝업으로도 노출됐으면 좋겠어."
 *
 * 【하루 한 번을 어떻게 세나요?】
 * 브라우저 안에 "어느 날짜 리포트까지 봤는지" 만 적어 둡니다.
 * 판단 규칙은 lib/popup.ts 에 있습니다 (시험할 수 있게 떼어 놨습니다).
 *
 * ⚠️ 서버가 아니라 이 브라우저에만 적힙니다. 그래서 회사 PC 와 휴대폰에서
 *    각각 한 번씩 뜹니다. 회원마다 서버에 기록을 남기면 정확해지지만,
 *    그러려면 표를 하나 더 만들고 접속마다 읽어야 합니다. 이 정도 일에는
 *    과합니다.
 */

export default function ReportPopup({
  date,
  body,
  model,
}: {
  date: string;
  body: string;
  model: string;
}) {
  // 처음에는 무조건 닫힌 상태로 그립니다.
  //
  // ⚠️ 서버에서 그린 화면과 브라우저가 그린 화면이 다르면 React 가
  //    화면을 통째로 다시 그립니다(hydration 오류). 서버는 브라우저
  //    기록을 볼 수 없으므로, 양쪽 다 '닫힘' 으로 시작해야 합니다.
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let seen: string | null = null;
    try {
      seen = window.localStorage.getItem(POPUP_KEY);
    } catch {
      // 사생활 보호 모드 등으로 기록을 못 읽을 수 있습니다.
      // 그때는 그냥 띄웁니다 (못 보는 것보다 낫습니다).
    }
    if (shouldShow(seen, date)) setOpen(true);
  }, [date]);

  const close = () => {
    setOpen(false);
    try {
      window.localStorage.setItem(POPUP_KEY, date);
    } catch {
      // 못 적어도 화면은 닫힙니다. 다음에 또 뜰 뿐입니다.
    }
  };

  // Esc 로도 닫히게 합니다 (키보드만 쓰는 분을 위해)
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    // 창이 떠 있는 동안 뒤쪽이 같이 스크롤되지 않게 합니다
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="report-popup-title"
      className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-6"
    >
      {/* 뒤쪽 어둡게 — 눌러도 닫힙니다 */}
      <button
        type="button"
        aria-label="닫기"
        onClick={close}
        className="absolute inset-0 bg-black/50 backdrop-blur-[2px]"
      />

      <div className="relative flex max-h-[88vh] w-full max-w-2xl flex-col rounded-t-2xl border border-line bg-surface shadow-2xl sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-line-soft px-5 py-4">
          <div className="min-w-0">
            <p className="text-2xs font-semibold uppercase tracking-[0.14em] text-accent">
              오늘의 리포트
            </p>
            <h2
              id="report-popup-title"
              className="mt-0.5 text-[17px] font-bold tracking-[-0.01em]"
            >
              {date} 순위 요약
            </h2>
          </div>
          <button
            type="button"
            onClick={close}
            className="-mr-1 shrink-0 rounded-lg px-2.5 py-1.5 text-sm text-ink-soft hover:bg-surface-2 hover:text-ink"
          >
            닫기 ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <Markdown text={body} />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line-soft px-5 py-3">
          {/*
            AI 가 쓴 글이라는 것을 창에서도 숨기지 않습니다.
            읽는 사람이 '사람이 확인한 분석' 으로 오해하면 안 됩니다.
          */}
          <p className="text-xs text-ink-faint">
            {model} 이(가) 그날 순위 자료만 보고 쓴 글입니다
          </p>
          <div className="flex items-center gap-2">
            <Link
              href="/report"
              onClick={close}
              className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink-soft hover:border-ink-faint hover:text-ink"
            >
              지난 리포트 보기 →
            </Link>
            <button
              type="button"
              onClick={close}
              className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-ink"
            >
              오늘은 그만 보기
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
