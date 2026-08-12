/**
 * 강제로 묶기 — 순수 계산만 모아 둔 곳 (데이터베이스를 안 씁니다).
 *
 * 【왜 파일을 나눴나요?】
 * 시험(scripts/test-join.mjs)이 이 함수들을 그대로 불러다 씁니다.
 * 데이터베이스에 붙는 코드가 한 줄이라도 섞이면 시험이 안 돌아갑니다.
 * 여기서 틀리면 **누르셨는데 저장이 통째로 실패**하므로 꼭 시험합니다.
 */

/** 한 번에 묶을 수 있는 최대 권수 — 서점이 셋이라 3권이 정상입니다 */
export const MAX_JOIN = 6;

/**
 * 찾기에서 훑어볼 최대 개수.
 * ⚠️ 넘치면 조용히 자르지 않고 화면에 "더 있습니다" 라고 적습니다.
 */
export const JOIN_SEARCH_CAP = 60;

/**
 * 고른 상품들로 만들 짝 목록. 언제나 (작은 번호, 큰 번호) 순서입니다.
 *
 * ⚠️ book_matches 표는 `store_book_a < store_book_b` 를 요구합니다.
 *    순서를 뒤집어 보내면 저장이 통째로 실패합니다.
 * ⚠️ 같은 번호를 두 번 고르면 같은 짝이 두 번 만들어져 역시 실패합니다.
 *    그래서 여기서 중복을 지웁니다.
 */
export function pairsOf(ids: number[]): [number, number][] {
  const uniq = [...new Set(ids)].sort((x, y) => x - y);
  const out: [number, number][] = [];
  for (let i = 0; i < uniq.length; i++) {
    for (let j = i + 1; j < uniq.length; j++) out.push([uniq[i], uniq[j]]);
  }
  return out;
}
