-- ===========================================================================
--  안 쓰는 색인 지우기 — 자료는 한 줄도 안 지웁니다
-- ===========================================================================
--
--  【2026-08-18 대표님 질문】
--      "7일 정도 수집됐어. 용량이 얼마나 버틸 수 있을것 같아?"
--
--  재 보니 **약 2주** 였습니다 (하루 21MB · 남은 여유 303MB).
--  이 파일은 그중 당장 되찾을 수 있는 자리를 되찾습니다.
--
--  【색인이 뭔가요?】
--  책 뒤에 붙은 '찾아보기' 같은 것입니다. 본문(자료)이 아니라 **찾기
--  편하라고 따로 만들어 둔 목차**입니다.
--
--  그래서 이 파일은 **안전합니다.**
--    · 자료는 한 글자도 안 지웁니다
--    · 지워도 화면에 나오는 내용은 똑같습니다 (찾는 속도만 달라집니다)
--    · 되돌리려면 아래 【되돌리기】의 문장 한 줄만 다시 실행하면 됩니다
--
--  【자리가 바로 나나요?】
--  ✅ 네. 자료를 지울 때와 다릅니다. 자료는 지워도 '빈 자리' 로 남지만
--     (db/space-trim.sql 참고), 색인은 통째로 사라져서 **즉시** 줄어듭니다.
--
--  실행: Supabase → SQL Editor → New query → 전체 붙여넣고 Run
--        마지막에 표 하나가 나옵니다. 그대로 알려 주세요. (몇 초)
-- ===========================================================================


-- ---------------------------------------------------------------------------
--  ① 한 번도 안 쓴 색인 두 개  (약 4.3MB)
-- ---------------------------------------------------------------------------
--  db/space-where.sql 결과에서 '읽힌 횟수' 가 **0** 이었습니다.
--
--      books      → idx_books_isbn        2,440 kB   🚨 한 번도 안 씀
--      store_books→ idx_store_books_isbn  1,992 kB   🚨 한 번도 안 씀
--
--  ISBN 으로 찾는 화면이 없어서 그렇습니다. 상세 페이지에 들어가지
--  않기로 한 규칙 때문에 ISBN 자체가 일부 서점에서만 들어옵니다.
--
--  ⚠️ '중복막이(UNIQUE)' 가 아니라 그냥 목차입니다. 지워도 같은 ISBN 이
--     두 번 들어가거나 하지 않습니다. 그건 다른 장치가 막습니다.
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS idx_books_isbn;
DROP INDEX IF EXISTS idx_store_books_isbn;


-- ---------------------------------------------------------------------------
--  ①-2 안 쓰는 색인 하나 더  (약 1.1MB)  — 2026-08-18 추가
-- ---------------------------------------------------------------------------
--  위 둘을 지우고 나니 목록에 이것이 드러났습니다.
--
--      store_books → idx_store_books_unmatched  1,168 kB  🚨 한 번도 안 씀
--
--  '아직 안 묶인 상품' 을 빨리 찾으라고 만든 것인데, 지금은 76,485권이
--  **전부 묶여 있어서** 이 색인이 비어 있습니다. 게다가 코드를 훑어보니
--  'book_id 가 비어 있는 상품' 을 찾는 곳이 한 군데도 없습니다.
--  (사이트·수집·매칭 모두 그 반대인 '묶인 것' 만 찾습니다)
--
--  ⚠️ 대표님이 따로 하실 일은 없습니다. 이 파일을 다시 돌리실 일이 생기면
--     (예: db/schema.sql 을 다시 실행해서 색인이 되살아났을 때)
--     그때 함께 지워집니다.
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS idx_store_books_unmatched;


-- ---------------------------------------------------------------------------
--  ② 검색용 색인 세 개  (약 37MB)  ← 🚨 지금은 지우지 않습니다
-- ---------------------------------------------------------------------------
--  이게 제일 큽니다. 도서 표 59MB 중 **37MB 가 이 셋** 입니다.
--  (자료는 15MB 인데 찾아보기가 37MB 입니다. 한글은 색인이 이렇게 큽니다)
--
--      idx_books_title_trgm      18 MB
--      idx_books_author_trgm     11 MB
--      idx_books_publisher_trgm  8,320 kB
--
--  【그런데 이건 진짜로 쓰입니다】
--  처음에 저는 "검색 화면은 store_books 를 보는데 색인은 books 에 걸려
--  있으니 안 쓰인다" 고 봤습니다. **틀렸습니다.**
--  검색 화면은 db/perf.sql 의 search_books_merged 를 부르고, 그 안에서
--  books.title / author / publisher 를 부분일치로 찾습니다. 이 셋이
--  바로 그 색인입니다. (7일간 169번 읽힘 = 대표님이 검색하신 횟수)
--
--  【그래서 지우면 어떻게 되나요?】
--  검색 결과는 **똑같이 나옵니다.** 다만 도서 표를 처음부터 끝까지
--  훑게 되어 느려집니다.
--      지금 도서 4만 권   → 0.1~0.3초  (아마 못 느끼십니다)
--      1년 뒤 30만 권     → 1~3초      (느껴집니다)
--
--  【셋 중 하나만 지우면 안 되나요?】
--  안 됩니다. 검색은 제목·저자·출판사를 '또는' 으로 한 번에 찾습니다.
--  셋 중 하나라도 색인이 없으면 어차피 표 전체를 훑습니다.
--  **전부 지우거나 전부 두거나** 둘 중 하나입니다.
--
--  🚨 그래서 기본으로는 지우지 않습니다. 아래 세 줄 앞의 '--' 를 지우면
--     실행됩니다. **대표님이 결정하실 일입니다.**
--     (37MB = 약 이틀치 여유입니다. 근본 해결은 아닙니다)
-- ---------------------------------------------------------------------------
-- DROP INDEX IF EXISTS idx_books_title_trgm;
-- DROP INDEX IF EXISTS idx_books_author_trgm;
-- DROP INDEX IF EXISTS idx_books_publisher_trgm;


-- ---------------------------------------------------------------------------
--  【되돌리기】 — 언제든 이 문장으로 되살립니다 (몇 초 ~ 몇 분)
-- ---------------------------------------------------------------------------
--  CREATE INDEX IF NOT EXISTS idx_books_isbn
--      ON books(isbn13) WHERE isbn13 IS NOT NULL;
--  CREATE INDEX IF NOT EXISTS idx_store_books_isbn
--      ON store_books(isbn13) WHERE isbn13 IS NOT NULL;
--  CREATE INDEX IF NOT EXISTS idx_store_books_unmatched
--      ON store_books(store_id) WHERE book_id IS NULL;
--  CREATE INDEX IF NOT EXISTS idx_books_title_trgm
--      ON books USING gin (title gin_trgm_ops);
--  CREATE INDEX IF NOT EXISTS idx_books_author_trgm
--      ON books USING gin (author gin_trgm_ops);
--  CREATE INDEX IF NOT EXISTS idx_books_publisher_trgm
--      ON books USING gin (publisher gin_trgm_ops);
--
--  ⚠️ db/schema.sql 과 db/perf.sql 에도 이 문장들이 그대로 있습니다.
--     그 두 파일을 다시 실행하면 **지운 색인이 되살아납니다.**
--     (IF NOT EXISTS 라서 조용히 다시 만들어집니다)
--     지운 상태를 유지하고 싶으시면, 그 파일을 다시 돌리신 뒤 이 파일을
--     한 번 더 돌려 주세요.
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
--  확인 — 지금 남아 있는 색인과 전체 용량
-- ---------------------------------------------------------------------------
SELECT "구분", "이름", "크기", "참고" FROM (
    SELECT 1 AS ord, '① 남은 색인' AS "구분",
           (s.relname || ' → ' || s.indexrelname) AS "이름",
           pg_size_pretty(pg_relation_size(s.indexrelid)) AS "크기",
           CASE WHEN s.idx_scan = 0 THEN '🚨 한 번도 안 씀'
                ELSE '읽힌 횟수 ' || to_char(s.idx_scan, 'FM999,999,999') END
             AS "참고"
      FROM pg_stat_user_indexes s
     WHERE s.schemaname = 'public'
       AND pg_relation_size(s.indexrelid) > 500000
    UNION ALL
    SELECT 2, '② 전체 용량',
           'public 스키마 합계',
           pg_size_pretty(sum(pg_total_relation_size(c.oid))),
           '무료 한도 500MB'
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r'
    UNION ALL
    SELECT 3, '③ 지웠는지 확인',
           'ISBN 색인 두 개',
           (SELECT count(*)::text FROM pg_indexes
             WHERE schemaname = 'public'
               AND indexname IN ('idx_books_isbn', 'idx_store_books_isbn')),
           '0 이면 성공'
) x ORDER BY ord, "크기" DESC;
