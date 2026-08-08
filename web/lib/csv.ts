/**
 * 엑셀로 내려받기 공통 도구.
 *
 * 예전에는 내려받기 버튼마다 CSV 만드는 코드를 따로 적었습니다. 그러면
 * 한쪽만 고쳤을 때 다른 쪽에서 한글이 깨지거나 쉼표가 든 제목이 칸을
 * 밀어내는 일이 생깁니다. 한 군데에만 두고 돌려 씁니다.
 */

/** 쉼표·따옴표·줄바꿈이 든 값을 안전하게 감쌉니다 */
function escape(v: unknown): string {
  const s = String(v ?? "");
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * 표를 CSV 글자열로.
 *
 * 맨 앞의 ﻿(BOM) 는 "이 파일은 한글(UTF-8)입니다" 라는 표시입니다.
 * 이게 없으면 엑셀에서 한글이 ????? 로 보입니다.
 */
export function toCsv(header: string[], rows: unknown[][]): string {
  return (
    "﻿" +
    [header, ...rows].map((r) => r.map(escape).join(",")).join("\r\n")
  );
}

/** 파일 이름에 쓸 수 없는 글자를 없앱니다 (제목에 / : * 등이 들어 있을 수 있습니다) */
export function safeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "_").slice(0, 120) || "download";
}

export function downloadCsv(csv: string, filename: string): void {
  const url = URL.createObjectURL(
    new Blob([csv], { type: "text/csv;charset=utf-8;" })
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filename}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
