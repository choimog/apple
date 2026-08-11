-- ===========================================================================
--  정가·판매가를 저장할 칸 만들기 — 2026-08-11 대표님 지시
-- ===========================================================================
--  【왜 필요한가요?】
--  "왜 우리 지금까지 정가를 고려하지 않았지?"
--
--  목록 페이지에 정가와 판매가가 둘 다 나와 있는데 안 걷고 있었습니다.
--  이제 걷도록 고쳤는데, **저장할 칸이 없으면 수집이 통째로 실패합니다.**
--  그래서 이 파일을 먼저 실행하셔야 합니다.
--
--  【얼마나 걸리나요?】
--  1초. 칸 두 개를 만들 뿐입니다.
--
--  【안전한가요?】
--  네. 있는 자료를 건드리지 않습니다. 빈 칸 두 개가 생길 뿐입니다.
--  이미 실행하셨어도 다시 실행할 수 있습니다 (아무 일도 안 일어납니다).
--
--  실행: Supabase → SQL Editor → New query → 전체 붙여넣고 Run
-- ===========================================================================

ALTER TABLE store_books ADD COLUMN IF NOT EXISTS list_price int;
ALTER TABLE store_books ADD COLUMN IF NOT EXISTS sale_price int;

COMMENT ON COLUMN store_books.list_price IS
  '정가(원). 도서정가제상 출판사가 정한 하나의 값이라 3사가 같아야 정상입니다. 다르면 다른 판형입니다.';
COMMENT ON COLUMN store_books.sale_price IS
  '실제 판매가(원). 서점마다 할인율이 달라 다를 수 있습니다. 매칭에는 쓰지 않습니다.';

-- 사이트가 바뀐 것을 알아채도록 알립니다
NOTIFY pgrst, 'reload schema';


-- ---------------------------------------------------------------------------
--  확인 — 두 줄 다 ✅ 면 끝입니다
-- ---------------------------------------------------------------------------
SELECT * FROM (
    SELECT 1 AS "번호", '정가 칸' AS "항목",
           CASE WHEN EXISTS (
               SELECT 1 FROM information_schema.columns
                WHERE table_name = 'store_books' AND column_name = 'list_price')
                THEN '✅ 생겼습니다' ELSE '❌ 이 파일을 다시 실행하세요' END AS "결과"
    UNION ALL
    SELECT 2, '판매가 칸',
           CASE WHEN EXISTS (
               SELECT 1 FROM information_schema.columns
                WHERE table_name = 'store_books' AND column_name = 'sale_price')
                THEN '✅ 생겼습니다' ELSE '❌ 이 파일을 다시 실행하세요' END
    UNION ALL
    -- 지금은 비어 있는 게 정상입니다. 내일 새벽 수집부터 채워집니다.
    SELECT 3, '지금 값이 든 책',
           (SELECT count(*)::text || '권 (오늘은 0권이 정상입니다)'
              FROM store_books WHERE list_price IS NOT NULL)
) x ORDER BY "번호";
