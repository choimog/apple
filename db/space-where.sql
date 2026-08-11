-- ===========================================================================
--  용량 234MB '도서 목록' 이 어디로 갔는지 재기 — 자료를 하나도 안 바꿉니다
-- ===========================================================================
--  【왜 필요한가요? — 2026-08-11】
--  오늘 수집이 끝난 뒤 [용량 확인] 이 이렇게 알려 왔습니다.
--
--      전체 307MB / 500MB
--      순위 자료   71MB  (하루 17.8MB · 보관소로 빠져나감)
--      도서 목록  234MB  (거의 안 늘어남 · 보관소로 안 빠짐)
--      1년 뒤 예상 최대 528MB  🚨  한도(500MB) 초과
--      이대로 두면 10일 뒤 한도
--
--  줄여야 하는 것은 분명한데, **어디를 줄여야 하는지 저는 아직 모릅니다.**
--  '도서 목록 234MB' 는 뭉뚱그린 숫자입니다. 그 안에
--    · 자료가 큰 건지, 색인(빨리 찾기용 목차)이 큰 건지
--    · 지금도 순위에 나오는 책인지, 몇 달째 안 나오는 책인지
--  를 모르는 채로 고치면, 아껴 봐야 몇 MB 인 곳을 건드리면서
--  대표님 자료만 잃게 됩니다.
--
--  ⚠️ 한 가지 더 확인합니다. 지금 계산은 도서 목록이 '거의 안 늘어난다' 고
--     보고 있습니다. 그런데 매일 새 책이 순위에 들어오면 그만큼 줄이
--     늘어나고, 이 표는 보관소로 빠지지도 않습니다. 이 가정이 틀렸다면
--     '1년 뒤 528MB' 도 실제보다 **낮게** 잡힌 것입니다. ④에서 잽니다.
--
--  【안전한가요?】
--  네. 세기만 합니다. 만들지도, 고치지도, 지우지도 않습니다.
--  큰 표를 훑으므로 20~60초쯤 걸릴 수 있습니다.
--
--  실행: Supabase → SQL Editor → New query → 전체 붙여넣고 Run
--        표 네 개가 나옵니다. **네 개 다** 그대로 알려 주세요.
-- ===========================================================================


-- ---------------------------------------------------------------------------
--  ① 색인(목차) 하나하나가 몇 MB 인가
-- ---------------------------------------------------------------------------
--  색인은 '빨리 찾기 위한 목차' 입니다. 눈에 안 보이지만 자리를 차지하고,
--  자료보다 색인이 더 큰 표도 흔합니다. 안 쓰는 목차가 있으면 지우는 것이
--  **자료를 하나도 안 잃고 용량을 줄이는 유일한 방법**입니다.
--
--  "읽힌 횟수" 가 0 이면 만들어 놓고 한 번도 안 쓴 목차입니다.
--  (다만 데이터베이스를 다시 켜면 이 숫자는 0부터 다시 셉니다)
-- ---------------------------------------------------------------------------
SELECT
    s.relname                                   AS "표",
    s.indexrelname                              AS "색인(목차) 이름",
    pg_size_pretty(pg_relation_size(s.indexrelid)) AS "크기",
    to_char(s.idx_scan, 'FM999,999,999')        AS "읽힌 횟수",
    CASE WHEN i.indisprimary THEN '기본키(못 지움)'
         WHEN i.indisunique  THEN '중복막이(못 지움)'
         WHEN s.idx_scan = 0 THEN '한 번도 안 씀'
         ELSE '' END                            AS "비고"
FROM pg_stat_user_indexes s
JOIN pg_index i ON i.indexrelid = s.indexrelid
WHERE s.schemaname = 'public'
ORDER BY pg_relation_size(s.indexrelid) DESC
LIMIT 25;


-- ---------------------------------------------------------------------------
--  ② 큰 표 세 개 — 자료와 색인 중 어느 쪽이 큰가
-- ---------------------------------------------------------------------------
SELECT
    c.relname                                        AS "표",
    pg_size_pretty(pg_total_relation_size(c.oid))    AS "합계",
    pg_size_pretty(pg_relation_size(c.oid))          AS "자료",
    pg_size_pretty(pg_indexes_size(c.oid))           AS "색인(목차)",
    round(100.0 * pg_indexes_size(c.oid)
          / greatest(pg_total_relation_size(c.oid), 1))::text || '%'
                                                     AS "색인 비중"
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r'
ORDER BY pg_total_relation_size(c.oid) DESC
LIMIT 8;


-- ---------------------------------------------------------------------------
--  ③ book_matches — 어떤 판정이 몇 줄인가
-- ---------------------------------------------------------------------------
--  이 표에는 '왜 그렇게 봤는지' 근거가 줄마다 함께 저장됩니다.
--  검토 화면이 실제로 근거를 보여주는 것은 「검토 대기(auto_low)」 뿐입니다.
--  자동병합(auto_high)이 압도적으로 많다면, 그쪽 근거는 안 남기는 것만으로
--  **대표님이 보시는 화면은 하나도 안 바뀌면서** 용량이 줄어듭니다.
--
--  ⚠️ 사람이 내린 결정(manual_merge / manual_split)은 무슨 일이 있어도
--     그대로 둡니다. 그것까지 지우면 대표님이 하신 검토가 사라집니다.
-- ---------------------------------------------------------------------------
SELECT
    decision                                         AS "판정",
    to_char(count(*), 'FM999,999,999')               AS "줄 수",
    round(100.0 * count(*) / greatest(sum(count(*)) OVER (), 1), 1)::text || '%'
                                                     AS "비중",
    pg_size_pretty((avg(pg_column_size(reasons)) * count(*))::bigint)
                                                     AS "근거가 차지하는 양(대략)"
FROM book_matches
GROUP BY decision
ORDER BY count(*) DESC;


-- ---------------------------------------------------------------------------
--  ④ 🚨 도서 목록이 정말 '거의 안 늘어나는가'
-- ---------------------------------------------------------------------------
--  store_books 는 서점에서 한 번이라도 본 상품을 모아 둔 표입니다.
--  순위 자료는 14일이 지나면 보관소로 빠지지만, **이 표는 안 빠집니다.**
--  매일 새 책이 순위에 들어오는 만큼 영원히 쌓입니다.
--
--  · '최근 7일에 새로 생긴 줄' 이 하루 수천 줄이면 → 계속 늘어나는 것이고,
--    지금의 1년 예상치(528MB)는 실제보다 낮게 잡힌 것입니다.
--  · '30일 넘게 순위에 한 번도 안 나온 줄' 이 많으면 → 그만큼은
--    지워도 지금 화면에 아무 영향이 없습니다.
--
--  ⚠️ 여기서는 세기만 합니다. 지우는 것은 이 숫자를 보고 결정합니다.
-- ---------------------------------------------------------------------------
SELECT * FROM (
    SELECT 1 AS "번호",
           '전체 상품 줄' AS "항목",
           to_char(count(*), 'FM999,999,999') AS "값",
           '' AS "뜻"
      FROM store_books

    UNION ALL
    SELECT 2, '최근 7일에 새로 생긴 줄',
           to_char(count(*), 'FM999,999,999'),
           '이만큼이 매주 영원히 쌓입니다'
      FROM store_books
     WHERE first_seen_at >= now() - interval '7 days'

    UNION ALL
    SELECT 3, '  └ 하루 평균',
           to_char((count(*) / 7)::bigint, 'FM999,999,999'),
           '× 365일 = 1년에 늘어날 줄'
      FROM store_books
     WHERE first_seen_at >= now() - interval '7 days'

    UNION ALL
    SELECT 4, '30일 넘게 순위에 안 나온 줄',
           to_char(count(*), 'FM999,999,999'),
           '지워도 지금 화면은 그대로입니다'
      FROM store_books
     WHERE last_seen_at < now() - interval '30 days'

    UNION ALL
    SELECT 5, '90일 넘게 순위에 안 나온 줄',
           to_char(count(*), 'FM999,999,999'),
           '가장 안전하게 지울 수 있는 범위'
      FROM store_books
     WHERE last_seen_at < now() - interval '90 days'

    UNION ALL
    -- 지운다면 실제로 얼마나 줄어드는지 어림합니다.
    -- (한 줄당 평균 크기 × 지울 줄 수. 색인까지 포함한 값입니다)
    SELECT 6, '  └ 90일 넘은 것을 지우면 대략',
           pg_size_pretty(
               (pg_total_relation_size('store_books')
                / greatest((SELECT count(*) FROM store_books), 1)
                * count(*))::bigint),
           'store_books 에서만. books·book_matches 도 함께 줄어듭니다'
      FROM store_books
     WHERE last_seen_at < now() - interval '90 days'
) x ORDER BY "번호";
