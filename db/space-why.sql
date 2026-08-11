-- ===========================================================================
--  왜 하루에 2만 줄씩 늘어나는가 — 원인을 가려냅니다
-- ===========================================================================
--  【무엇을 알아냈나요? — 2026-08-11】
--  날짜별로 갈라 재 보니 이렇게 나왔습니다.
--
--      2026-08-07   7,790   ← 첫날(부분 수집)
--      2026-08-08  66,244   ← 첫 전체 수집. 모든 책이 '처음 보는 책'
--      2026-08-09  21,427
--      2026-08-10  18,499
--      2026-08-11  19,750
--
--  08-09 부터 사흘이 **줄지 않고 하루 2만 줄씩** 늘고 있습니다.
--  한 줄이 599바이트니 하루 12MB. 1년이면 store_books 만 4GB 가 넘습니다.
--  무료 한도는 500MB 입니다. 지금 307MB 를 썼으니 **일주일쯤 남았습니다.**
--
--  그런데 이상합니다. 서점 한 곳에서 매일 받아오는 상품은 2만 8천 개
--  남짓인데, 그중 7천 개가 **매일 처음 보는 책**이라는 뜻입니다.
--  베스트셀러 목록이 하루에 27%씩 갈리지는 않습니다.
--
--  두 가지 중 하나입니다. **어느 쪽이냐에 따라 대책이 정반대입니다.**
--
--    (가) 진짜로 새 책이다
--         → 500~1000위 뒤쪽이 원래 그렇게 출렁입니다.
--           줄이려면 순위를 얕게 보거나, 오래된 상품을 지워야 합니다.
--
--    (나) 같은 책이 매일 새 줄로 다시 등록되고 있다   🚨
--         → 서점이 상품번호(주소)를 바꾸면 저희는 '처음 보는 책' 으로
--           칩니다. 그러면 같은 책이 표 안에 수십 줄로 불어납니다.
--           이건 **고쳐야 하는 고장**이지 줄일 자료가 아닙니다.
--           순위 그래프도 끊기고, 매칭 검토 거리도 헛되이 늘어납니다.
--
--  ③ 번 줄을 보시면 어느 쪽인지 바로 갈립니다.
--
--  【안전한가요?】
--  네. 세기만 합니다. 만들지도, 고치지도, 지우지도 않습니다.
--  30~90초쯤 걸릴 수 있습니다.
--
--  실행: Supabase → SQL Editor → New query → 전체 붙여넣고 Run
--        표 **하나**가 나옵니다. 통째로 알려 주세요.
-- ===========================================================================

WITH latest AS (   -- 가장 마지막으로 상품이 들어온 날 (한국시간)
    SELECT max((first_seen_at AT TIME ZONE 'Asia/Seoul')::date) AS d
      FROM store_books
),
newest AS (        -- 그날 새로 생긴 줄
    SELECT * FROM store_books
     WHERE (first_seen_at AT TIME ZONE 'Asia/Seoul')::date = (SELECT d FROM latest)
),
older AS (         -- 그 전에 이미 있던 줄
    SELECT DISTINCT store_id, norm_title, norm_author
      FROM store_books
     WHERE (first_seen_at AT TIME ZONE 'Asia/Seoul')::date < (SELECT d FROM latest)
       AND coalesce(norm_title, '') <> ''
),
dup AS (           -- 같은 서점 안에 같은 제목+저자가 여러 줄인 묶음
    SELECT store_id, norm_title, norm_author, count(*) AS n
      FROM store_books
     WHERE coalesce(norm_title, '') <> ''
     GROUP BY 1, 2, 3
    HAVING count(*) > 1
),
lastrank AS (      -- 가장 최근 순위 날짜
    SELECT max(snapshot_date) AS d FROM rankings
)

SELECT "번호", "항목", "값", "뜻" FROM (

    SELECT 1 AS "번호", '전체 상품 줄' AS "항목",
           to_char((SELECT count(*) FROM store_books), 'FM999,999,999') AS "값",
           '' AS "뜻"

    UNION ALL
    SELECT 2, '가장 최근 하루에 새로 생긴 줄',
           to_char((SELECT count(*) FROM newest), 'FM999,999,999'),
           (SELECT d::text FROM latest) || ' 에 들어온 것'

    UNION ALL
    -- 🚨 여기가 갈림길입니다.
    --    높으면 (나) — 같은 책이 새 줄로 다시 등록되는 고장입니다.
    --    낮으면 (가) — 진짜로 새 책이 들어오는 것입니다.
    SELECT 3, '  └ 그중 이미 있던 책 (제목+저자가 같음)',
           to_char((SELECT count(*) FROM newest n
                     WHERE EXISTS (SELECT 1 FROM older o
                                    WHERE o.store_id = n.store_id
                                      AND o.norm_title = n.norm_title
                                      AND o.norm_author IS NOT DISTINCT FROM n.norm_author)),
                   'FM999,999,999')
           || ' ('
           || round(100.0 * (SELECT count(*) FROM newest n
                              WHERE EXISTS (SELECT 1 FROM older o
                                             WHERE o.store_id = n.store_id
                                               AND o.norm_title = n.norm_title
                                               AND o.norm_author IS NOT DISTINCT FROM n.norm_author))
                    / greatest((SELECT count(*) FROM newest), 1), 1)::text || '%)',
           '🚨 이 비율이 높으면 같은 책이 다시 등록되는 고장입니다'

    UNION ALL
    SELECT 4, '같은 서점에 두 줄 이상인 책',
           to_char((SELECT count(*) FROM dup), 'FM999,999,999'),
           '한 서점에 같은 제목+저자가 여러 줄'

    UNION ALL
    SELECT 5, '  └ 거기에 딸린 줄 수',
           to_char((SELECT coalesce(sum(n), 0) FROM dup), 'FM999,999,999')
           || ' (여분 ' || to_char((SELECT coalesce(sum(n - 1), 0) FROM dup),
                                   'FM999,999,999') || '줄)',
           '여분이 많으면 그만큼이 헛되이 쌓인 것입니다'

    UNION ALL
    SELECT 6, '순위에 한 번도 안 나온 상품',
           to_char((SELECT count(*) FROM store_books s
                     WHERE NOT EXISTS (SELECT 1 FROM rankings r
                                        WHERE r.store_book_id = s.id)),
                   'FM999,999,999'),
           '순위가 보관소로 빠지면 이렇게 됩니다 (정상일 수 있음)'

    UNION ALL
    -- 뒤쪽 순위가 많이 차지하면, 깊이를 줄이는 것이 바로 효과를 냅니다.
    SELECT 7, '가장 최근 순위 중 301위 이하',
           to_char((SELECT count(*) FROM rankings
                     WHERE snapshot_date = (SELECT d FROM lastrank) AND rank > 300),
                   'FM999,999,999')
           || ' / '
           || to_char((SELECT count(*) FROM rankings
                        WHERE snapshot_date = (SELECT d FROM lastrank)),
                      'FM999,999,999'),
           '뒤쪽이 많으면 깊이를 줄이는 것이 바로 효과를 냅니다'

    UNION ALL
    -- 사이트도 리포트도 매칭도 이 표를 읽지 않습니다 (2026-08-11 확인).
    -- 지우면 그만큼 그냥 비는 자리입니다.
    SELECT 8, '아무도 안 읽는 book_meta',
           to_char((SELECT count(*) FROM book_meta), 'FM999,999,999') || '줄 · '
           || pg_size_pretty(pg_total_relation_size('book_meta')),
           '해시태그·이벤트. 사이트에서 쓰는 곳이 없습니다'

) x ORDER BY "번호";
