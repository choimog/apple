"""
config/*.yaml 설정 파일을 읽어들이는 도구.

설정을 코드에서 분리해 두었기 때문에, 서점이 바뀌어도 YAML 만 고치면 됩니다.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml

CONFIG_DIR = Path(__file__).resolve().parent.parent.parent / "config"


def load(name: str) -> dict[str, Any]:
    """config 폴더의 YAML 파일 하나를 읽습니다."""
    path = CONFIG_DIR / name
    if not path.exists():
        raise FileNotFoundError(f"설정 파일이 없습니다: {path}")
    with path.open(encoding="utf-8") as f:
        data = yaml.safe_load(f)
    if not isinstance(data, dict):
        raise ValueError(f"설정 파일 형식이 잘못됐습니다: {path}")
    return data


@dataclass
class CategoryTask:
    """수집할 카테고리 하나. sources.yaml 한 줄에 대응합니다."""

    store_code: str          # 'aladin'
    store_id: int            # 3
    kind: str                # 'online' | 'offline'
    code: str                # 서점 내부 분야 코드
    name: str                # '경제경영'
    branch_code: str = ""    # 교보 매장 코드
    branch_name: str = ""
    unified_code: str | None = None
    url_template: str = ""
    max_items: int = 200
    page_size: int = 50

    @property
    def total_pages(self) -> int:
        """이 카테고리에서 받아야 할 페이지 수"""
        return max(1, -(-self.max_items // self.page_size))  # 올림 나눗셈

    def url_for(self, page: int) -> str:
        return self.url_template.format(page=page)

    def label(self) -> str:
        if self.branch_name:
            return f"{self.store_code}/{self.branch_name}/{self.name}"
        return f"{self.store_code}/{self.name}"


STORE_IDS = {"kyobo": 1, "yes24": 2, "aladin": 3}


def build_tasks(sources: dict, only_store: str | None = None) -> list[CategoryTask]:
    """
    sources.yaml 을 읽어서 '수집할 카테고리 목록'으로 펼칩니다.
    only_store 를 주면 그 서점만 골라냅니다.
    """
    tasks: list[CategoryTask] = []

    for section_name, section in sources.items():
        if section_name == "defaults" or not isinstance(section, dict):
            continue
        store_code = section.get("store")
        if not store_code or (only_store and store_code != only_store):
            continue
        store_id = STORE_IDS.get(store_code)
        if store_id is None:
            continue

        kind = section.get("kind", "online")

        # --- 온라인 카테고리 ---
        for cat in section.get("categories") or []:
            if not cat.get("enabled", True):
                continue
            tasks.append(
                CategoryTask(
                    store_code=store_code,
                    store_id=store_id,
                    kind=kind,
                    code=str(cat.get("code", "")),
                    name=cat["name"],
                    unified_code=cat.get("unified"),
                    url_template=cat["url"],
                    max_items=int(cat.get("max_items", 200)),
                    page_size=int(cat.get("page_size", section.get("page_size", 50))),
                )
            )

        # --- 교보 오프라인 매장 (매장 × 분야) ---
        branches = section.get("branches") or []
        store_cats = section.get("store_categories") or []
        if branches and store_cats:
            template = section["url_template"]
            for br in branches:
                if not br.get("enabled", True):
                    continue
                for cat in store_cats:
                    if not cat.get("enabled", True):
                        continue
                    url = template.replace("{region}", br["region"])
                    url = url.replace("{branch}", br["branch_code"])
                    url = url.replace("{cat}", cat["code"])
                    tasks.append(
                        CategoryTask(
                            store_code=store_code,
                            store_id=store_id,
                            kind=kind,
                            code=str(cat["code"]),
                            name=cat["name"],
                            branch_code=br["branch_code"],
                            branch_name=br["branch_name"],
                            unified_code=cat.get("unified"),
                            url_template=url,
                            max_items=int(section.get("max_items", 50)),
                            page_size=int(section.get("page_size", 50)),
                        )
                    )

    return tasks
