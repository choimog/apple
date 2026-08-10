/**
 * 매칭 검토를 **엑셀로 내려받고, 채워서 올리는** 기능.
 *
 * 【2026-08-09 대표님 요청】
 * "사이트에서 일일이 클릭해서 결정하려니까 많이 힘든데, 혹시 엑셀로
 *  내려받고 거기에 결정할 수 있는 항목을 만든 다음에 그걸 작성한 엑셀을
 *  업로드해서 결과를 반영하는 것도 가능할까?"
 *
 * 가능합니다. 다만 **조용히 틀리면 가장 위험한 기능**입니다.
 * 한 번에 수백 건을 바꾸는데, 잘못 반영돼도 화면에는 "완료" 만 뜹니다.
 * 그래서 이렇게 만듭니다.
 *
 *   · 엉뚱한 파일이면 **아무것도 반영하지 않고** 왜 안 되는지 말합니다
 *   · 몇 건 반영/건너뜀/실패인지 **숫자로** 알려줍니다
 *   · 빈칸은 '건너뜀' 이지 '오류' 가 아닙니다 (다 채울 필요 없음)
 *   · 모르는 짝번호는 세어서 알려줍니다 (조용히 무시하지 않음)
 */

/** 엑셀 첫 줄. 이 순서와 이름이 바뀌면 올릴 때 못 알아봅니다. */
export const SHEET_HEADER = [
  "짝번호",
  "결정",
  "점수",
  "묶인권수",
  "A서점",
  "A제목",
  "A저자",
  "A출판사",
  "A배본",
  "B서점",
  "B제목",
  "B저자",
  "B출판사",
  "B배본",
  "근거",
] as const;

/** '결정' 칸에 적을 수 있는 말 */
export const DECISION_WORDS: Record<string, "merge" | "split" | "undo"> = {
  "같은책": "merge",
  "같은 책": "merge",
  "o": "merge",
  "O": "merge",
  "ㅇ": "merge",
  "1": "merge",
  "다른책": "split",
  "다른 책": "split",
  "x": "split",
  "X": "split",
  "ㅌ": "split",
  "2": "split",
  "되돌리기": "undo",
  "취소": "undo",
};

export type SheetRow = { id: number; action: "merge" | "split" | "undo" };

export type ParseResult = {
  rows: SheetRow[];
  /** 결정 칸이 비어 있어 넘어간 줄 수 (정상입니다) */
  blank: number;
  /** 결정 칸에 모르는 말이 적힌 줄 */
  unknown: { line: number; text: string }[];
  /** 짝번호가 숫자가 아닌 줄 */
  badId: number[];
  /** 파일 자체가 잘못됐을 때의 이유. 있으면 **아무것도 반영하면 안 됩니다.** */
  fatal: string | null;
};

/**
 * 쉼표로 나뉜 한 줄을 칸으로 쪼갭니다.
 * 따옴표 안의 쉼표는 칸 구분이 아닙니다 ("아버지, 해방일지" 같은 제목).
 */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuote) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuote = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuote = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/**
 * 올린 파일을 읽습니다. **여기서는 아무것도 저장하지 않습니다.**
 * 저장은 부르는 쪽이 합니다 (그래야 시험할 수 있습니다).
 */
export function parseSheet(text: string): ParseResult {
  const empty: ParseResult = {
    rows: [],
    blank: 0,
    unknown: [],
    badId: [],
    fatal: null,
  };

  // 엑셀이 앞에 붙이는 보이지 않는 글자(BOM)를 뗍니다
  const clean = text.replace(/^﻿/, "");
  const lines = clean.split(/\r?\n/).filter((l) => l.trim() !== "");

  if (lines.length === 0) {
    return { ...empty, fatal: "파일이 비어 있습니다." };
  }

  const head = splitCsvLine(lines[0]);

  // 🚨 엉뚱한 파일을 올렸을 때 **조용히 0건 반영** 하면 안 됩니다.
  //    "완료" 라고 뜨는데 아무것도 안 바뀐 상태가 가장 위험합니다.
  if (head[0] !== "짝번호" || head[1] !== "결정") {
    return {
      ...empty,
      fatal:
        "이 파일은 매칭 검토 파일이 아닌 것 같습니다. " +
        `첫 줄 첫 칸이 '짝번호', 둘째 칸이 '결정' 이어야 하는데 ` +
        `'${head[0] ?? ""}' / '${head[1] ?? ""}' 입니다. ` +
        "[검토 목록 내려받기] 로 받은 파일을 그대로 채워서 올려 주세요.",
    };
  }

  const rows: SheetRow[] = [];
  const unknown: { line: number; text: string }[] = [];
  const badId: number[] = [];
  let blank = 0;
  const seen = new Set<number>();

  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    const idText = cells[0] ?? "";
    const word = (cells[1] ?? "").trim();

    if (word === "") {
      blank++;
      continue;
    }

    const id = Number(idText);
    if (!Number.isInteger(id) || id <= 0) {
      badId.push(i + 1); // 사람이 세는 줄 번호 (1부터, 머리글 포함)
      continue;
    }

    const action = DECISION_WORDS[word] ?? DECISION_WORDS[word.toLowerCase()];
    if (!action) {
      unknown.push({ line: i + 1, text: word });
      continue;
    }

    // 같은 짝을 두 번 적었으면 **나중 것**을 씁니다 (엑셀에서 고쳐 쓴 경우)
    if (seen.has(id)) {
      const at = rows.findIndex((r) => r.id === id);
      if (at >= 0) rows[at] = { id, action };
    } else {
      seen.add(id);
      rows.push({ id, action });
    }
  }

  return { rows, blank, unknown, badId, fatal: null };
}
