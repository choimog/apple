/**
 * 휴대폰 폭에서 **실제로 넘치는 칸이 있는지 재 봅니다.**
 *
 * 【2026-08-18 대표님 지적으로 만들었습니다】
 *   "모바일로 봤을 때, 즐겨찾기 영역에서 판매지수나 순위 부분이 넘치면서
 *    깨져. … 종합이라든지 서점별에서도 특히 모바일 버전에서 가독성이 확
 *    떨어지는 문제가 되긴 해."
 *
 * 🚨 이런 고장은 **넓은 화면에서는 아무 표시가 안 납니다.** 노트북으로
 *    보면 멀쩡하고, 휴대폰에서만 글자가 상자 밖으로 삐져나갑니다.
 *    눈으로 잡으려면 매번 휴대폰을 꺼내야 하니 자로 잽니다.
 *
 * 재는 방법: 빌드된 진짜 CSS 를 씌운 다음, 목록 한 줄을 여러 폭에서 그려
 * `scrollWidth > clientWidth` 인 칸(= 속에 든 것이 상자보다 넓은 칸)을
 * 전부 찾아냅니다.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  실행 (필요할 때만 손으로)
 *
 *      cd web
 *      npm i --no-save playwright
 *      npx next build            # 진짜 CSS 를 만들기 위해
 *      node scripts/measure-mobile.mjs
 *
 *  ⚠️ playwright 를 package.json 에 넣지 않았습니다. 자동 확인마다
 *     브라우저를 내려받으면 시간과 돈이 듭니다. 대신 **평소에는**
 *     scripts/test-mobile.mjs 가 규칙이 지켜지는지만 글자로 확인합니다.
 * ─────────────────────────────────────────────────────────────────────
 *
 * 2026-08-18 고치기 전 측정값 (360px):
 *     서점 칸 속 너비 19px  ·  판매지수 `1,284,530` 이 43px 삐져나감
 * 고친 뒤: 320~1280px 어디에서도 넘치는 칸 없음.
 *
 * 2026-08-19 등락(▲▼)을 넣으면서 넣기 전/후를 나란히 재 봤습니다.
 * "그거 만든다고 가독성이랑 구성 다 엉망으로 만들지는 말고" 라고 하셔서
 * **제목 자리를 안 뺏는 것**을 첫째 조건으로 두었습니다.
 *
 *              줄 높이            제목 폭        넘침
 *   종합 320px  278 → 285 (+7)    254 → 254      없음
 *   종합 360px  218 → 218 ( 0)    178 → 178      없음
 *   종합 768px  162 → 169 (+7)    578 → 578      없음
 *   웰컴 360px   68 →  68 ( 0)    126 → 122 (-4) 없음
 *
 * 🚨 여기서 배운 것: 등락을 감싼 칸에 `leading-none` 을 안 붙이면
 *    그 한 줄이 **24px** 를 먹습니다. 속의 글자가 10px 라도 줄 상자는
 *    바깥 글자 크기를 따라가기 때문입니다. 붙이니 16px 가 됐고,
 *    줄 높이 증가가 +15px → +7px 로 줄었습니다.
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  console.log(
    "\nℹ️ playwright 가 없어 건너뜁니다.\n" +
      "   재 보시려면:  npm i --no-save playwright  후 다시 실행"
  );
  process.exit(0);
}

const CHUNKS = ".next/static/chunks";
if (!existsSync(CHUNKS)) {
  console.log("\nℹ️ 빌드 결과가 없어 건너뜁니다. 먼저 `npx next build` 를 실행하세요.");
  process.exit(0);
}
const cssFile = readdirSync(CHUNKS).find((f) => f.endsWith(".css"));
if (!cssFile) {
  console.log("\nℹ️ 빌드된 CSS 를 찾지 못해 건너뜁니다.");
  process.exit(0);
}
const css = readFileSync(`${CHUNKS}/${cssFile}`, "utf8");

/** 실제 화면에서 가장 빡빡한 두 줄을, 최악의 값으로 채워서 그립니다 */
const LONG_TITLE = "세이노의 가르침 - 피 땀 눈물이 담긴 인생 조언 (양장 특별판)";
const BIG_SALES = "123,845,300"; // 실제보다 훨씬 큰 값으로 여유를 봅니다

const CASES = {
  "종합·즐겨찾기 한 줄 (BookRow)": `
<div class="rounded-2xl border border-line bg-surface shadow-card"><ul class="divide-y divide-line-soft">
 <li class="flex flex-wrap items-start gap-x-3 gap-y-2.5 px-4 py-3.5 sm:px-5">
  <div class="w-11 shrink-0 pt-0.5 text-center">
    <span class="tnum inline-flex items-center justify-center rounded-lg font-bold ring-1 bg-surface-2 text-ink-soft ring-line h-8 min-w-[2.25rem] px-1.5 text-sm">100</span>
    <!-- 등락 (2026-08-19). 가장 넓게 나오는 값으로 잽니다: NEW -->
    <div class="mt-0.5 leading-none"><span class="inline-block rounded bg-purple-100 font-medium text-purple-700 px-1 py-px text-[10px] leading-none">NEW</span></div>
    <div class="mt-0.5 text-[10px] leading-tight text-ink-faint">평균<br><span class="font-medium text-ink-soft tnum">123.4위</span></div>
  </div>
  <div class="cover-fallback shrink-0 rounded border border-line h-[72px] w-12"></div>
  <div class="min-w-0 flex-1 basis-40">
    <a href="#" class="text-[15px] font-semibold leading-snug">${LONG_TITLE}</a>
    <p class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-ink-soft">
      <a href="#">세이노</a><span class="text-ink-faint">·</span><a href="#">한국교육방송공사(EBSi)</a>
      <span class="text-ink-faint">·</span><span class="tnum">2026-08</span>
      <span class="tnum">16,800원</span><span class="text-ink-faint">·</span><span>3개 서점</span></p>
  </div>
  <div class="shrink-0 pt-0.5"><button class="rounded-lg border border-line px-2 py-1 text-xs text-ink-faint">빼기</button></div>
  <div class="grid w-full grid-cols-3 gap-1.5 sm:pl-[7.25rem]">
    <div class="min-w-0 rounded-lg border px-1.5 py-1.5 sm:px-2 border-line bg-surface">
      <div class="flex flex-wrap items-baseline justify-between gap-x-1 gap-y-0.5">
        <span class="rounded px-1.5 py-px text-2xs font-medium bg-kyobo/10 text-kyobo ring-1 ring-kyobo/25">교보</span>
        <span class="text-[13px] font-bold tnum">137위</span></div>
      <div class="mt-0.5"><span class="text-xs text-ink-faint">미제공</span></div></div>
    <div class="min-w-0 rounded-lg border px-1.5 py-1.5 sm:px-2 border-line bg-surface">
      <div class="flex flex-wrap items-baseline justify-between gap-x-1 gap-y-0.5">
        <span class="rounded px-1.5 py-px text-2xs font-medium bg-yes24/10 text-yes24 ring-1 ring-yes24/25">예스</span>
        <span class="text-[13px] font-bold tnum">8위</span></div>
      <div class="mt-0.5"><div class="w-full"><div class="text-xs font-semibold tnum text-ink">${BIG_SALES}</div>
      <div class="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-surface-2"><div class="h-full rounded-full bg-slate-400" style="width:100%"></div></div></div></div></div>
    <div class="min-w-0 rounded-lg border px-1.5 py-1.5 sm:px-2 border-dotted border-line-soft bg-surface-2 opacity-70">
      <div class="flex flex-wrap items-baseline justify-between gap-x-1 gap-y-0.5">
        <span class="rounded px-1.5 py-px text-2xs font-medium bg-aladin/10 text-aladin ring-1 ring-aladin/25">알라딘</span>
        <span class="text-[13px] font-bold tnum"><span class="text-xs text-amber-700/90">안 묶임</span></span></div></div>
  </div>
 </li></ul></div>`,

  "분야 고르기 (종합·서점별·출판사·저자 공통)": `
<div class="rounded-2xl border border-line bg-surface shadow-card p-4 sm:p-5">
 <div class="flex flex-wrap items-start gap-4">
  <div class="min-w-0 basis-full sm:basis-0 sm:flex-1">
   <p class="mb-1.5 text-xs font-medium text-ink-faint">분야</p>
   <div class="scroll-x flex max-h-48 flex-wrap gap-1.5 overflow-y-auto rounded-lg border border-line-soft bg-surface-2 p-2">
    ${[
      "종합", "소설", "한국소설", "경제경영", "자기계발", "인문",
      "청소년 교양·학습", "유아(0~7세) 그림책", "중고등 참고서·문제집",
      "외국어", "과학", "역사", "에세이", "만화", "여행",
    ]
      .map(
        (t, i) =>
          `<a class="rounded-full border px-3 py-1 text-xs ${
            i === 0
              ? "border-transparent bg-accent font-semibold text-accent-ink"
              : "border-line bg-surface text-ink-soft"
          }">${t}</a>`
      )
      .join("")}
   </div>
  </div>
  <div class="shrink-0">
   <p class="mb-1.5 text-xs font-medium text-ink-faint">날짜</p>
   <div class="flex items-center gap-1.5">
     <button class="grid h-9 w-9 place-items-center rounded-lg border border-line text-ink-soft">‹</button>
     <select class="tnum h-9 rounded-lg border border-line bg-surface px-2.5 text-sm text-ink"><option>2026-08-18</option></select>
     <button class="grid h-9 w-9 place-items-center rounded-lg border border-line text-ink-soft">›</button>
   </div>
  </div>
 </div>
</div>`,

  "위쪽 메뉴 (PC 에서 스크롤바가 생기던 자리)": `
<header class="border-b border-line bg-canvas">
 <div class="mx-auto max-w-6xl px-4">
  <div class="flex h-12 items-center justify-between gap-3 sm:h-14 sm:gap-4">
   <a class="min-w-0 truncate text-[15px] font-bold tracking-[-0.01em] text-ink-soft">📚 베스트셀러 트래커</a>
   <div class="flex shrink-0 items-center gap-1 sm:gap-2">
     <button class="rounded-lg px-2 py-1.5 text-sm text-ink-soft">🌙</button>
     <button class="rounded-lg px-2 py-1.5 text-sm text-ink-soft sm:px-2.5">로그아웃</button></div>
  </div>
  <nav class="scroll-x flex items-center gap-2.5 -mx-1 border-t border-line-soft px-1 py-1">
   ${[
     ["종합", "서점별", "즐겨찾기"],
     ["출판사", "저자", "분야"],
     ["리포트", "검색", "공유 링크"],
     // 2026-08-19: [수집 상태] 가 관리 묶음으로 옮겨졌습니다
     ["매칭 검토", "수집 상태", "저장 용량"],
   ]
     .map(
       (g) =>
         `<div class="flex shrink-0 items-center gap-1 rounded-xl border border-line-soft bg-surface-2/60 px-1 py-1">${g
           .map((t) => `<a class="whitespace-nowrap rounded-lg px-2.5 py-1 text-sm text-ink-soft">${t}</a>`)
           .join("")}</div>`
     )
     .join("")}
  </nav>
 </div>
</header>`,

  "웰컴 TOP 10 한 줄 (평균이 세 자리일 때)": `
<div class="rounded-2xl border border-line bg-surface shadow-card"><ol class="divide-y divide-line-soft">
 <li class="flex items-center gap-3 px-4 py-2.5 sm:px-5">
  <div class="w-8 shrink-0 text-center">
    <span class="tnum inline-flex items-center justify-center rounded-lg font-bold ring-1 bg-surface-2 text-ink-soft ring-line h-6 min-w-[1.75rem] px-1 text-xs">10</span>
    <!-- 등락 (2026-08-19). 가장 넓게 나오는 값으로 잽니다: NEW -->
    <div class="mt-0.5 leading-none"><span class="inline-block rounded bg-purple-100 font-medium text-purple-700 px-1 py-px text-[10px] leading-none">NEW</span></div>
  </div>
  <div class="cover-fallback shrink-0 rounded border border-line h-12 w-8"></div>
  <div class="min-w-0 flex-1">
    <a class="block truncate text-sm font-semibold">${LONG_TITLE}</a>
    <p class="truncate text-xs text-ink-soft">세이노 · 한국교육방송공사(EBSi) · 2026-08 · 16,800원</p></div>
  <div class="hidden shrink-0 sm:block"><span class="flex gap-1">
    <span class="inline-flex items-center gap-1 rounded-md font-medium px-1.5 py-0.5 text-2xs bg-kyobo/10 text-kyobo ring-1 ring-kyobo/25">교보<span class="tnum font-bold">137</span></span>
    <span class="inline-flex items-center gap-1 rounded-md font-medium px-1.5 py-0.5 text-2xs bg-yes24/10 text-yes24 ring-1 ring-yes24/25">예스<span class="tnum font-bold">8</span></span>
    <span class="inline-flex items-center gap-1 rounded-md font-medium px-1.5 py-0.5 text-2xs bg-surface-2 text-ink-faint ring-1 ring-line">알라딘<span class="tnum font-bold">–</span></span>
  </span></div>
  <span class="w-[4.5rem] shrink-0 whitespace-nowrap text-right text-xs text-ink-faint tnum">평균 123.4</span>
 </li></ol></div>`,

  "서점별 한 줄 (/store)": `
<div class="rounded-2xl border border-line bg-surface shadow-card"><ul class="divide-y divide-line-soft">
 <li class="flex flex-wrap items-start gap-x-3 gap-y-2 px-4 py-3">
  <div class="w-11 shrink-0 text-center">
    <span class="tnum inline-flex items-center justify-center rounded-lg font-bold ring-1 bg-surface-2 text-ink-soft ring-line h-8 min-w-[2.25rem] px-1.5 text-sm">300</span>
    <div class="mt-1"><span class="text-2xs text-emerald-600">▲123</span></div>
  </div>
  <div class="cover-fallback shrink-0 rounded border border-line h-24 w-16"></div>
  <div class="min-w-0 flex-1 basis-40">
    <a href="#" class="font-medium">${LONG_TITLE}</a>
    <p class="mt-0.5 text-sm text-ink-soft">세이노 · 한국교육방송공사(EBSi) · 2026-08 · 16,800원</p>
  </div>
  <div class="w-full shrink-0 pl-[3.5rem] sm:w-28 sm:pl-0 sm:text-right">
    <div class="w-full"><div class="text-base font-bold tnum text-ink">${BIG_SALES}</div>
    <div class="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-surface-2"><div class="h-full rounded-full bg-slate-400" style="width:100%"></div></div></div>
  </div>
 </li></ul></div>`,
};

/** 실제로 쓰는 휴대폰·태블릿·노트북 폭 */
const WIDTHS = [320, 360, 390, 430, 768, 1024, 1280];

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
});
let failed = 0;

for (const [name, body] of Object.entries(CASES)) {
  console.log(`\n── ${name} ──`);
  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<style>${css}</style></head><body class="bg-canvas text-ink">
<main class="mx-auto max-w-6xl px-4 py-6 sm:py-8">${body}</main></body></html>`;

  for (const width of WIDTHS) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.setContent(html);
    await page.waitForTimeout(80);
    const out = await page.evaluate(() => {
      const bad = [];
      for (const el of document.querySelectorAll("*")) {
        const over = el.scrollWidth - el.clientWidth;
        if (over <= 1 || el.clientWidth === 0) continue;
        // ⚠️ '넘친다' 와 '보기 흉하다' 는 다릅니다.
        //    옆으로 넘기게 만들어 둔 곳(휴대폰 메뉴)과 말줄임표로
        //    자르는 곳(긴 제목)은 넘치는 것이 **정상**입니다.
        //    실제로 상자 밖으로 삐져나와 보이는 것만 잡습니다.
        const ox = getComputedStyle(el).overflowX;
        if (ox !== "visible") continue;
        bad.push({
          over,
          w: el.clientWidth,
          text: (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 22),
        });
      }
      // 🚨 넘치는 것만 보면 안 됩니다. 한 줄짜리로 만든 칸이 두 줄로
      //    접히는 것도 "통일성이 떨어져 보인다" 는 고장입니다
      //    (2026-08-19 웰컴의 '평균 123.4').
      for (const el of document.querySelectorAll(".whitespace-nowrap, .truncate")) {
        const line = parseFloat(getComputedStyle(el).lineHeight) || 16;
        if (el.getBoundingClientRect().height > line * 1.6) {
          bad.push({ over: 0, w: Math.round(el.clientWidth), folded: true,
                     text: (el.textContent || "").trim().slice(0, 22) });
        }
      }
      return {
        pageOver: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        bad: bad.slice(0, 6),
      };
    });
    await page.close();

    if (!out.bad.length && out.pageOver <= 0) {
      console.log(`  ✅ ${String(width).padStart(4)}px`);
    } else {
      failed++;
      console.log(`  ❌ ${String(width).padStart(4)}px  가로 스크롤 ${out.pageOver}px`);
      for (const b of out.bad) {
        console.log(
          b.folded
            ? `       두 줄로 접힘 (칸 ${b.w}px)  "${b.text}"`
            : `       ${String(b.over).padStart(3)}px 넘침 (칸 ${b.w}px)  "${b.text}"`
        );
      }
    }
  }
}

console.log();
if (failed) {
  console.log(`❌ ${failed}개 폭에서 넘칩니다.`);
  process.exit(1);
}
console.log("✅ 모든 폭에서 넘치는 칸 없음");
