-- ===========================================================================
--  용량이 어디로 가고 있는지 정확히 재기 — 자료를 하나도 바꾸지 않습니다
-- ===========================================================================
--  【왜 필요한가요? — 2026-08-10】
--  매일 도는 [용량 확인] 이 이렇게 알려 왔습니다.
--
--    전체 237MB / 500MB · 1년 뒤 예상 564MB 🚨
--    큰 표: store_books 65MB · books 54MB · rankings 47MB · book_matches 43MB
--
--  여기까지는 알겠는데, **book_meta 가 몇 MB 인지**, 그 안에 같은 값이
--  며칠씩 다시 저장되고 있는지는 알 수 없습니다.
--  짐작으로 고치면 안 되는 자리라 실제로 재 봅니다.
--
--  【안전한가요?】
--  네. 세기만 합니다. 만들지도, 고치지도, 지우지도 않습니다.
--  큰 표를 훑으므로 10~30초쯤 걸릴 수 있습니다.
--
--  실행: Supabase → SQL Editor → New query → 전체 붙여넣고 Run
--        표 세 개가 나옵니다. 그대로 알려 주시면 됩니다.
-- ===========================================================================


-- ---------------------------------------------------------------------------
--  ① 표마다 얼마나 쓰고 있나 (자료 / 색인 나눠서)
-- ---------------------------------------------------------------------------
--  색인(index)은 '빨리 찾기 위한 목차' 입니다. 눈에 안 보이지만 자리를
--  차지합니다. 자료보다 색인이 더 큰 표도 흔합니다.
-- ---------------------------------------------------------------------------
SELECT
    relname                                              AS "표 이름",
    pg_size_pretty(pg_total_relation_size(c.oid))        AS "합계",
    pg_size_pretty(pg_relation_size(c.oid))              AS "자료",
    pg_size_pretty(pg_indexes_size(c.oid))               AS "색인(목차)",
    -- ⚠️ 이 숫자는 PostgreSQL 이 예전에 어림한 값입니다. 한 번도 어림한
    --    적이 없으면 -1 이 나오는데, 그걸 그대로 보여주면 "줄이 -1개" 라는
    --    이상한 표가 됩니다. 모르면 모른다고 적습니다.
    CASE WHEN c.reltuples < 0 THEN '(아직 안 셈)'
         ELSE to_char(c.reltuples::bigint, 'FM999,999,999') END AS "대략 줄 수"
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r'
ORDER BY pg_total_relation_size(c.oid) DESC;


-- ---------------------------------------------------------------------------
--  ② 날마다 쌓이는 두 표 — 하루에 몇 줄, 한 줄에 몇 바이트인가
-- ---------------------------------------------------------------------------
SELECT * FROM (
    SELECT 1 AS "번호", 'rankings (순위)' AS "표",
           to_char(count(*), 'FM999,999,999') AS "줄 수",
           count(DISTINCT snapshot_date)::text AS "날짜 수",
           to_char((count(*) / greatest(count(DISTINCT snapshot_date), 1))::bigint,
                   'FM999,999,999') AS "하루 평균 줄",
           (pg_total_relation_size('rankings') / greatest(count(*), 1))::text || ' B'
             AS "한 줄당(색인 포함)"
    FROM rankings

    UNION ALL
    SELECT 2, 'book_meta (해시태그·이벤트)',
           to_char(count(*), 'FM999,999,999'),
           count(DISTINCT snapshot_date)::text,
           to_char((count(*) / greatest(count(DISTINCT snapshot_date), 1))::bigint,
                   'FM999,999,999'),
           (pg_total_relation_size('book_meta') / greatest(count(*), 1))::text || ' B'
    FROM book_meta
) x ORDER BY "번호";


-- ---------------------------------------------------------------------------
--  ③ 🚨 book_meta 에 같은 값이 며칠씩 다시 저장되고 있나
-- ---------------------------------------------------------------------------
--  해시태그와 이벤트 문구는 거의 안 바뀝니다. 그런데 지금은 **매일**
--  새 줄로 다시 저장합니다. 같은 값이 208개 분야 × 날짜 수만큼 쌓입니다.
--
--  '어제와 똑같음' 비율이 높을수록, 바뀔 때만 저장하도록 고쳤을 때
--  아끼는 양이 큽니다.
-- ---------------------------------------------------------------------------
WITH t AS (
    SELECT
        (hashtags = '{}' AND events = '{}')                       AS empty_row,
        (hashtags IS NOT DISTINCT FROM lag(hashtags) OVER w
         AND events IS NOT DISTINCT FROM lag(events) OVER w)      AS same_as_before,
        (lag(snapshot_date) OVER w) IS NULL                       AS first_row
    FROM book_meta
    WINDOW w AS (PARTITION BY store_book_id ORDER BY snapshot_date)
)
SELECT
    to_char(count(*), 'FM999,999,999')                            AS "전체 줄",
    to_char(count(*) FILTER (WHERE empty_row), 'FM999,999,999')   AS "아예 빈 줄",
    round(100.0 * count(*) FILTER (WHERE empty_row)
          / greatest(count(*), 1), 1)::text || '%'                AS "빈 줄 비율",
    to_char(count(*) FILTER (WHERE same_as_before AND NOT first_row),
            'FM999,999,999')                                      AS "어제와 똑같은 줄",
    round(100.0 * count(*) FILTER (WHERE same_as_before AND NOT first_row)
          / greatest(count(*), 1), 1)::text || '%'                AS "낭비 비율",
    to_char(count(*) FILTER (WHERE first_row), 'FM999,999,999')   AS "꼭 필요한 첫 줄"
FROM t;
