"use client";

/**
 * 밝은 화면 / 어두운 화면 전환 버튼.
 *
 * 기본값은 밝은 화면입니다. 운영체제 설정을 따라가지 않습니다.
 * 한 번 고르면 브라우저에 기억해 두고, 다음에 올 때도 그대로 씁니다.
 */

import { useEffect, useState } from "react";

export const THEME_KEY = "theme";

/**
 * 화면이 그려지기 전에 저장된 설정을 먼저 적용하는 코드.
 * 이게 없으면 어두운 화면을 쓰는 사람에게 흰 화면이 한 번 번쩍입니다.
 */
export const THEME_BOOT = `(function(){try{
  if(localStorage.getItem("${THEME_KEY}")==="dark")
    document.documentElement.setAttribute("data-theme","dark");
}catch(e){}})();`;

export default function ThemeToggle() {
  // 서버에서 그릴 때는 아직 알 수 없으므로 밝은 화면으로 그립니다.
  const [dark, setDark] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.getAttribute("data-theme") === "dark");
    setReady(true);
  }, []);

  const toggle = () => {
    const next = !dark;
    setDark(next);
    const el = document.documentElement;
    if (next) el.setAttribute("data-theme", "dark");
    else el.removeAttribute("data-theme");
    try {
      localStorage.setItem(THEME_KEY, next ? "dark" : "light");
    } catch {
      /* 저장이 막혀 있어도 이번 방문에는 적용됩니다 */
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? "밝은 화면으로 바꾸기" : "어두운 화면으로 바꾸기"}
      title={dark ? "밝은 화면으로" : "어두운 화면으로"}
      className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-line text-ink-soft transition-colors hover:border-ink-faint hover:text-ink"
    >
      {/* 아직 확인 전에는 아이콘을 비워 둡니다 (잘못된 아이콘이 번쩍이지 않게) */}
      <span aria-hidden className={ready ? "" : "opacity-0"}>
        {dark ? "☀" : "☾"}
      </span>
    </button>
  );
}
