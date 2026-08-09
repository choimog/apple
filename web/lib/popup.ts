/**
 * "하루 한 번만 띄우기" 규칙.
 *
 * 화면 코드에서 떼어 놓은 이유는 **시험할 수 있게** 하기 위해서입니다.
 * (scripts/test-popup.mjs 가 이 파일을 그대로 가져다 씁니다)
 *
 * 규칙은 하나뿐입니다:
 *   마지막으로 본 **리포트 날짜**가 지금 리포트 날짜와 다르면 띄운다.
 *
 * ⚠️ '오늘 날짜' 로 세면 안 됩니다.
 *    리포트는 아침 7시 반쯤 만들어집니다. 그보다 일찍 들어와서 창을 한 번
 *    닫으면(=오늘 날짜를 적어 두면), 정작 그날 리포트가 나온 뒤에는
 *    "오늘은 이미 봤다" 가 되어 **영영 못 봅니다.**
 *    그래서 반드시 '리포트 날짜' 로 셉니다.
 */

export const POPUP_KEY = "report-seen";

export function shouldShow(
  seen: string | null | undefined,
  reportDate: string | null | undefined
): boolean {
  // 리포트가 없으면 띄울 것도 없습니다
  if (!reportDate) return false;
  // 한 번도 안 봤으면 띄웁니다
  if (!seen) return true;
  // 본 적 있는 그 리포트면 안 띄웁니다
  return seen !== reportDate;
}
