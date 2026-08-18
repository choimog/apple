/**
 * 즐겨찾기 담기 / 빼기 버튼 (별표).
 *
 * 【2026-08-18 대표님 요청】
 *   "각 아이디 이용자마다 도서를 즐겨찾기 할 수 있는 기능"
 *
 * ⚠️ 자바스크립트 없이도 동작하는 평범한 form 입니다. 이 사이트의 다른
 *    누르는 것들(공유 링크·매칭 판정)과 같은 방식입니다.
 *
 * ⚠️ 제목·저자·출판사를 함께 보냅니다. 나중에 그 책이 자료 정리로
 *    지워졌을 때 **무엇이 사라졌는지 이름으로 알려 드리기 위함**입니다.
 */
export default function FavoriteButton({
  bookId,
  title,
  author,
  publisher,
  on,
  back,
}: {
  bookId: number;
  title: string;
  author?: string | null;
  publisher?: string | null;
  /** 지금 담겨 있는가. null 이면 아직 모릅니다(표를 못 읽음) */
  on: boolean | null;
  /** 누른 뒤 돌아올 주소 */
  back: string;
}) {
  const added = on === true;
  return (
    <form action="/favorites/action" method="post" className="shrink-0">
      <input type="hidden" name="do" value={added ? "remove" : "add"} />
      <input type="hidden" name="book" value={bookId} />
      <input type="hidden" name="back" value={back} />
      {!added && (
        <>
          <input type="hidden" name="title" value={title} />
          <input type="hidden" name="author" value={author ?? ""} />
          <input type="hidden" name="publisher" value={publisher ?? ""} />
        </>
      )}
      <button
        type="submit"
        title={
          added
            ? "즐겨찾기에서 뺍니다"
            : "즐겨찾기에 담습니다. [즐겨찾기] 화면에서 3사 순위를 한눈에 보실 수 있습니다"
        }
        className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg border px-3 py-1.5 text-sm transition-colors ${
          added
            ? "border-amber-400/70 bg-amber-500/10 font-semibold text-amber-700 hover:bg-amber-500/20 dark:text-amber-400"
            : "border-line bg-surface text-ink-soft hover:bg-surface-2 hover:text-ink"
        }`}
      >
        <span aria-hidden>{added ? "★" : "☆"}</span>
        {added ? "즐겨찾기 담음" : "즐겨찾기"}
      </button>
    </form>
  );
}
