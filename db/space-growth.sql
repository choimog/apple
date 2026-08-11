-- ===========================================================================
--  도서 목록이 정말 계속 늘어나는가 — 날짜별로 갈라서 잽니다
-- ===========================================================================
--  【왜 다시 재나요? — 2026-08-11】
--  앞의 db/space-where.sql ④ 가 이렇게 나왔습니다.
--
--      전체 상품 줄            133,710
--      최근 7일에 새로 생긴 줄  133,710   ← 전체와 똑같음 (100%)
--      하루 평균                19,101
--      30일 넘게 안 나온 줄          0
--
--  **이 숫자로는 답을 낼 수 없습니다.** 133,710권 전부가 최근 7일 안에
--  처음 생긴 것으로 나온다는 건, 이 표가 일주일도 안 됐다는 뜻입니다.
--
--  처음 모을 때는 **모든 책이 '처음 보는 책'** 이라 첫날에 몇 만 권이
--  한꺼번에 들어옵니다. 그걸 7로 나눈 '하루 19,101권' 은 앞으로의
--  증가 속도가 아닙니다. 그대로 ×365 하면 1년에 697만 권이라는
--  공상이 나옵니다.
--
--  (예전에도 같은 함정에 빠져 "하루 95.9MB · 3일 뒤 꽉 참" 이라고
--   잘못 알린 적이 있습니다. 실제와 4배 넘게 틀렸습니다.)
--
--  【그래서 무엇을 보나요?】
--  7일을 뭉쳐 나누지 말고 **날짜별로 몇 권이 새로 생겼는지** 봅니다.
--
--    첫날 7만 → 둘째날 8천 → 셋째날 5천 → 넷째날 4천 처럼 **줄어들면**
--      → 진짜 증가 속도는 하루 몇 천 권. 걱정할 수준이 아닙니다.
--    첫날 7만 → 그 뒤로도 계속 1만 9천씩 **이면**
--      → 「1년 뒤 528MB」 예상치가 실제보다 한참 낮게 잡힌 것이고,
--        대책이 완전히 달라집니다.
--
--  【안전한가요?】
--  네. 세기만 합니다. 만들지도, 고치지도, 지우지도 않습니다.
--
--  실행: Supabase → SQL Editor → New query → 전체 붙여넣고 Run
--        표 두 개가 나옵니다. 둘 다 알려 주세요.
-- ===========================================================================


-- ---------------------------------------------------------------------------
--  ① 날짜별로 몇 권이 '처음' 들어왔나
-- ---------------------------------------------------------------------------
--  first_seen_at = 그 상품을 처음 본 날.
--  맨 윗줄(가장 오래된 날)이 첫 수집일이라 크게 나오는 것이 정상입니다.
--  **아랫줄들이 진짜 증가 속도입니다.**
-- ---------------------------------------------------------------------------
SELECT
    (first_seen_at AT TIME ZONE 'Asia/Seoul')::date   AS "처음 본 날(한국시간)",
    to_char(count(*), 'FM999,999,999')                AS "새로 생긴 줄",
    to_char(count(*) FILTER (WHERE store_id = 1), 'FM999,999')  AS "교보",
    to_char(count(*) FILTER (WHERE store_id = 2), 'FM999,999')  AS "예스24",
    to_char(count(*) FILTER (WHERE store_id = 3), 'FM999,999')  AS "알라딘",
    CASE WHEN row_number() OVER (ORDER BY (first_seen_at AT TIME ZONE 'Asia/Seoul')::date) = 1
         THEN '← 첫 수집일. 이 줄은 빼고 보세요' ELSE '' END    AS "비고"
FROM store_books
GROUP BY 1
ORDER BY 1;


-- ---------------------------------------------------------------------------
--  ② 그래서 1년 뒤에 얼마나 될까
-- ---------------------------------------------------------------------------
--  **첫 수집일을 뺀** 나머지 날의 평균으로만 계산합니다.
--  첫날은 '쌓인 것을 한 번에 담은 날' 이라 앞으로의 속도가 아닙니다.
--
--  ⚠️ 아직 며칠 안 됐으면 이 값도 흔들립니다. 며칠 더 지나 다시 보세요.
-- ---------------------------------------------------------------------------
WITH per_day AS (
    SELECT (first_seen_at AT TIME ZONE 'Asia/Seoul')::date AS d,
           count(*) AS n
      FROM store_books
     GROUP BY 1
),
rest AS (   -- 첫 수집일을 뺀 나머지
    SELECT * FROM per_day
     WHERE d > (SELECT min(d) FROM per_day)
),
bytes_per_row AS (
    SELECT pg_total_relation_size('store_books')
           / greatest((SELECT count(*) FROM store_books), 1) AS b
)
SELECT * FROM (
    SELECT 1 AS "번호", '수집한 날수' AS "항목",
           (SELECT count(*)::text FROM per_day) AS "값",
           '첫날 포함' AS "뜻"

    UNION ALL
    SELECT 2, '첫 수집일에 담긴 줄',
           to_char((SELECT n FROM per_day ORDER BY d LIMIT 1), 'FM999,999,999'),
           '이 값은 앞으로의 속도가 아닙니다'

    UNION ALL
    SELECT 3, '그 뒤 하루 평균 새 줄',
           CASE WHEN (SELECT count(*) FROM rest) = 0
                THEN '(아직 하루도 안 지났습니다 — 판정 불가)'
                ELSE to_char((SELECT avg(n) FROM rest)::bigint, 'FM999,999,999')
           END,
           '★ 이것이 진짜 증가 속도입니다'

    UNION ALL
    SELECT 4, '한 줄당 크기(색인 포함)',
           pg_size_pretty((SELECT b FROM bytes_per_row)),
           ''

    UNION ALL
    SELECT 5, '1년 뒤 도서 목록 예상',
           CASE WHEN (SELECT count(*) FROM rest) = 0
                THEN '(판정 불가)'
                ELSE pg_size_pretty((
                    ((SELECT count(*) FROM store_books)
                     + (SELECT avg(n) FROM rest) * 365)
                    * (SELECT b FROM bytes_per_row))::bigint)
           END,
           'store_books 만. books·book_matches 는 별도'
) x ORDER BY "번호";
