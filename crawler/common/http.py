"""
서점에 요청을 보낼 때 지켜야 할 예의를 한 곳에 모아둔 파일입니다.

여기서 보장하는 것:
  1. 요청과 요청 사이에 1~2초 쉼        (서버 부담 최소화)
  2. 실패하면 대기 시간을 늘려가며 재시도  (지수 백오프)
  3. 우리가 누구인지 밝히는 User-Agent
  4. 차단 징후(403 / 429 / 캡차 / 빈 응답)를 명확히 구분해서 보고

※ 이 파일의 delay 값을 임의로 줄이지 마세요. 차단당하면 프로젝트 전체가 멈춥니다.
"""

from __future__ import annotations

import random
import time
from dataclasses import dataclass, field
from typing import Optional

import httpx


# 차단으로 의심되는 상태 코드
BLOCK_STATUS = {403, 429, 503}

# 응답 본문에 이런 단어가 있으면 캡차/차단 페이지일 가능성이 높습니다
BLOCK_MARKERS = (
    "captcha",
    "CAPTCHA",
    "자동입력",
    "비정상적인 접근",
    "비정상적인 요청",
    "접근이 차단",
    "Access Denied",
    "robot",
)


@dataclass
class FetchStats:
    """수집 한 번(카테고리 하나)에 대한 통계. crawl_logs 테이블에 그대로 저장됩니다."""

    requests: int = 0
    retries: int = 0
    elapsed_sec: float = 0.0
    status_counts: dict[int, int] = field(default_factory=dict)
    block_suspected: bool = False
    block_reason: str = ""

    def record(self, status: int) -> None:
        self.requests += 1
        self.status_counts[status] = self.status_counts.get(status, 0) + 1

    def to_json(self) -> dict:
        return {
            "requests": self.requests,
            "retries": self.retries,
            "elapsed_sec": round(self.elapsed_sec, 1),
            "status": {str(k): v for k, v in sorted(self.status_counts.items())},
            "block_suspected": self.block_suspected,
            "block_reason": self.block_reason,
        }


class BlockedError(RuntimeError):
    """서점이 우리를 차단한 것으로 판단될 때 발생. 조용히 넘어가지 않고 실패 처리합니다."""


class PoliteClient:
    """
    서점 한 곳에 요청을 보내는 클라이언트.
    서점별로 하나씩 만들어서 씁니다 (요청 간격이 서점별로 독립적으로 지켜지도록).
    """

    def __init__(
        self,
        *,
        user_agent: str,
        delay_min: float = 1.0,
        delay_max: float = 2.0,
        max_retries: int = 4,
        timeout: float = 20.0,
        referer: Optional[str] = None,
    ) -> None:
        # 1초 미만은 허용하지 않습니다 — 설정 실수로 서점에 부담을 주는 것을 막는 안전장치
        self.delay_min = max(1.0, delay_min)
        self.delay_max = max(self.delay_min, delay_max)
        self.max_retries = max_retries
        self.stats = FetchStats()
        self._last_request_at: float = 0.0

        headers = {
            "User-Agent": user_agent,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "ko-KR,ko;q=0.9",
        }
        if referer:
            headers["Referer"] = referer

        self._client = httpx.Client(
            headers=headers,
            timeout=timeout,
            follow_redirects=True,
        )

    def __enter__(self) -> "PoliteClient":
        return self

    def __exit__(self, *exc) -> None:
        self.close()

    def close(self) -> None:
        self._client.close()

    def _wait_turn(self) -> None:
        """직전 요청으로부터 delay 만큼 지날 때까지 기다립니다."""
        if self._last_request_at:
            wait = random.uniform(self.delay_min, self.delay_max)
            elapsed = time.monotonic() - self._last_request_at
            if elapsed < wait:
                time.sleep(wait - elapsed)
        self._last_request_at = time.monotonic()

    def get(
        self,
        url: str,
        *,
        allow_status: tuple[int, ...] = (),
        check_block_markers: bool = True,
        min_body_len: int = 500,
    ) -> httpx.Response:
        """
        한 페이지를 가져옵니다.

        allow_status: 이 상태 코드는 차단으로 보지 않고 그대로 돌려줍니다.
                      (예: robots.txt 가 404인 건 정상 상황)

        check_block_markers: 본문에서 차단 문구를 찾을지 여부.
                      ※ robots.txt 를 받을 때는 반드시 False 로 주세요.
                        robots.txt 안에는 'robot' 이라는 단어가 당연히 들어 있어서
                        차단 페이지로 오인합니다. (실제로 겪은 버그)

        min_body_len: 본문이 이 길이 미만이면 빈 응답으로 간주.
                      robots.txt 는 짧을 수 있으므로 작게 주세요.

        실패 시 지수 백오프로 재시도하고, 그래도 안 되면 예외를 던집니다.
        조용히 빈 데이터를 돌려주는 일은 절대 없습니다.
        """
        started = time.monotonic()
        last_error: Optional[Exception] = None

        for attempt in range(self.max_retries + 1):
            self._wait_turn()
            try:
                resp = self._client.get(url)
            except httpx.RequestError as exc:
                # 네트워크 오류 — 재시도 대상
                last_error = exc
                self.stats.retries += 1
                self._backoff(attempt)
                continue

            self.stats.record(resp.status_code)

            if resp.status_code in allow_status:
                self.stats.elapsed_sec += time.monotonic() - started
                return resp

            if resp.status_code in BLOCK_STATUS:
                # 차단 의심 — 재시도는 하되 끝까지 안 되면 BlockedError
                self.stats.block_suspected = True
                self.stats.block_reason = f"HTTP {resp.status_code}"
                last_error = BlockedError(
                    f"HTTP {resp.status_code} — 차단 의심: {url}"
                )
                self.stats.retries += 1
                self._backoff(attempt)
                continue

            if resp.status_code >= 500:
                last_error = RuntimeError(f"HTTP {resp.status_code}: {url}")
                self.stats.retries += 1
                self._backoff(attempt)
                continue

            if resp.status_code != 200:
                # 4xx — 재시도해도 소용없음. 즉시 실패
                self.stats.elapsed_sec += time.monotonic() - started
                raise RuntimeError(f"HTTP {resp.status_code}: {url}")

            # 200이지만 캡차/차단 페이지일 수 있음
            body = resp.text
            if check_block_markers:
                marker = self._find_block_marker(body)
                if marker:
                    self.stats.block_suspected = True
                    self.stats.block_reason = f"차단 문구 발견: {marker!r}"
                    raise BlockedError(f"차단 페이지로 보임 ({marker!r}): {url}")

            if len(body.strip()) < min_body_len:
                # 정상 목록 페이지가 이보다 짧을 수는 없습니다
                self.stats.block_suspected = True
                self.stats.block_reason = f"응답 본문이 너무 짧음 ({len(body)}자)"
                raise BlockedError(f"빈 응답으로 보임 ({len(body)}자): {url}")

            self.stats.elapsed_sec += time.monotonic() - started
            return resp

        self.stats.elapsed_sec += time.monotonic() - started
        raise last_error or RuntimeError(f"요청 실패: {url}")

    def _backoff(self, attempt: int) -> None:
        """재시도 전 대기. 1초 → 2초 → 4초 → 8초 (+ 약간의 무작위)"""
        delay = (2 ** attempt) + random.uniform(0, 1.0)
        time.sleep(min(delay, 30.0))

    @staticmethod
    def _find_block_marker(body: str) -> Optional[str]:
        head = body[:4000]
        for marker in BLOCK_MARKERS:
            if marker in head:
                return marker
        return None
