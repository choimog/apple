"""
robots.txt 를 "제대로" 해석하는 도구.

【왜 따로 만들었나요?】
robots.txt 는 User-Agent 별로 규칙이 그룹지어져 있습니다.
파일 전체에서 'Disallow: /' 를 찾으면 안 됩니다.

  User-Agent: *          ← 우리가 해당되는 그룹
  Allow: /
  Disallow: /api/gw

  User-Agent: ClaudeBot  ← 다른 그룹. 우리와 무관
  Disallow: /            ← 이걸 우리 규칙으로 착각하면 안 됨

교보문고가 정확히 이 구조입니다. 일반 크롤러에겐 전체를 허용하고,
AI 학습 봇에게만 전체 금지를 겁니다.

【표준 규칙】
- 우리 User-Agent 와 정확히 일치하는 그룹이 있으면 그 그룹만 적용
- 없으면 '*' 그룹을 적용
- 그 외 그룹은 완전히 무시
- 같은 경로에 Allow 와 Disallow 가 겹치면, 더 긴(구체적인) 규칙이 이김
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from urllib.parse import unquote, urlparse


@dataclass
class RobotsGroup:
    """하나의 User-Agent 그룹"""

    agents: list[str] = field(default_factory=list)
    allows: list[str] = field(default_factory=list)
    disallows: list[str] = field(default_factory=list)


@dataclass
class RobotsRules:
    """파싱된 robots.txt 전체"""

    groups: list[RobotsGroup] = field(default_factory=list)
    sitemaps: list[str] = field(default_factory=list)
    raw: str = ""

    def group_for(self, user_agent: str) -> RobotsGroup | None:
        """
        우리 User-Agent 에 적용될 그룹을 찾습니다.
        정확히 일치하는 그룹 우선, 없으면 '*' 그룹.
        """
        ua = user_agent.lower()
        # 1순위: 우리 UA 이름이 그룹 이름을 포함하는 경우 (표준 동작)
        best: RobotsGroup | None = None
        best_len = -1
        for g in self.groups:
            for a in g.agents:
                al = a.lower()
                if al == "*":
                    continue
                if al in ua and len(al) > best_len:
                    best, best_len = g, len(al)
        if best is not None:
            return best

        # 2순위: '*' 그룹
        for g in self.groups:
            if any(a == "*" for a in g.agents):
                return g
        return None

    def is_allowed(self, url_or_path: str, user_agent: str) -> tuple[bool, str]:
        """
        이 경로를 수집해도 되는지 판단합니다.
        돌려주는 값: (허용여부, 판단 근거 설명)
        """
        path = url_or_path
        if url_or_path.startswith("http"):
            parsed = urlparse(url_or_path)
            path = parsed.path or "/"
            if parsed.query:
                path += "?" + parsed.query

        group = self.group_for(user_agent)
        if group is None:
            return True, "우리에게 적용되는 규칙 그룹이 없음 → 허용"

        agent_label = ", ".join(group.agents)

        # 가장 구체적인(긴) 규칙이 이깁니다
        best_rule: tuple[int, bool, str] | None = None
        for rule in group.disallows:
            if _match(rule, path):
                cand = (len(rule), False, rule)
                if best_rule is None or cand[0] > best_rule[0]:
                    best_rule = cand
        for rule in group.allows:
            if _match(rule, path):
                cand = (len(rule), True, rule)
                # 길이가 같으면 Allow 가 이깁니다 (표준)
                if best_rule is None or cand[0] >= best_rule[0]:
                    best_rule = cand

        if best_rule is None:
            return True, f"`User-Agent: {agent_label}` 그룹에 해당 규칙 없음 → 허용"

        _, allowed, rule = best_rule
        verb = "Allow" if allowed else "Disallow"
        return allowed, f"`User-Agent: {agent_label}` 그룹의 `{verb}: {rule}` 적용"


def _match(rule: str, path: str) -> bool:
    """robots.txt 경로 규칙이 이 경로에 걸리는지. * 와 $ 를 지원합니다."""
    if rule == "":
        return False
    pattern = re.escape(unquote(rule)).replace(r"\*", ".*")
    if pattern.endswith(r"\$"):
        pattern = pattern[:-2] + "$"
    return re.match(pattern, unquote(path)) is not None


def parse(text: str) -> RobotsRules:
    """robots.txt 원문을 파싱합니다."""
    rules = RobotsRules(raw=text)
    current: RobotsGroup | None = None
    # User-Agent 줄이 연달아 나오면 같은 그룹으로 묶입니다
    last_was_agent = False

    for line in text.splitlines():
        line = line.split("#", 1)[0].strip()
        if not line or ":" not in line:
            continue
        key, _, value = line.partition(":")
        key = key.strip().lower()
        value = value.strip()

        if key == "user-agent":
            if current is None or not last_was_agent:
                current = RobotsGroup()
                rules.groups.append(current)
            current.agents.append(value)
            last_was_agent = True
        elif key == "disallow":
            if current is not None:
                current.disallows.append(value)
            last_was_agent = False
        elif key == "allow":
            if current is not None:
                current.allows.append(value)
            last_was_agent = False
        elif key == "sitemap":
            rules.sitemaps.append(value)
            last_was_agent = False
        else:
            last_was_agent = False

    return rules
