"use client";

import { useState } from "react";

/**
 * 표지 이미지.
 *
 * 【지키는 것】
 * - 표지를 우리 서버에 저장하지 않습니다. 서점 주소를 그대로 씁니다.
 * - 화면에 보이기 직전에 불러옵니다 (lazy loading = 느린 목록 방지).
 * - 못 불러오면 회색 자리표시자를 보여줍니다 (깨진 이미지 아이콘 방지).
 */
export default function Cover({
  url,
  alt,
  className = "h-24 w-16",
}: {
  url: string | null;
  alt: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);

  if (!url || failed) {
    return (
      <div
        className={`cover-fallback shrink-0 rounded border border-slate-200 ${className}`}
        aria-label="표지 없음"
        role="img"
      />
    );
  }

  return (
    // 표지는 서점 주소에서 바로 불러옵니다. 저장하지 않습니다.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={alt}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={`shrink-0 rounded border border-slate-200 object-cover ${className}`}
    />
  );
}
