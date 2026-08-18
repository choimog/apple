import { FieldLabel, Pill } from "@/components/ui";
import type { ReactNode } from "react";

/**
 * 분야(또는 매장) 고르기 — **네 화면이 하나를 같이 씁니다.**
 *
 * 【2026-08-18 대표님 요청】
 *   "종합, 서점별에서 분야 스크롤 방식이랑
 *    출판사, 저자에서 분야 스크롤 방식의 차이도 통일해줘."
 *
 * 상자 자체는 원래 네 화면이 같았습니다. 다른 것은 **상자의 폭**이었습니다.
 *
 *   · 종합 · 서점별   분야 상자가 날짜 고르기와 한 줄을 나눠 씀 → 좁음
 *                     → 버튼이 여러 줄로 접혀서 **금방 스크롤**이 생김
 *   · 출판사 · 저자   분야 상자가 한 줄을 다 씀, 날짜는 아랫줄 → 넓음
 *                     → 같은 분야 수인데도 스크롤이 거의 안 생김
 *
 * 그래서 **폭이 정해지는 방식**을 하나로 모읍니다.
 *   휴대폰  분야가 한 줄을 다 쓰고, 날짜는 아랫줄로 내려갑니다
 *   넓은 화면  분야와 날짜가 한 줄에 나란히 놓입니다
 *
 * 🚨 여기 말고 다른 곳에서 이 상자를 또 만들지 마세요. 지금까지 네 군데에
 *    같은 코드가 네 벌 있었고, 그래서 조금씩 어긋났습니다.
 *    (BookRow 맨 위에 적어 둔 것과 같은 이유입니다)
 */

export type PickItem = {
  /** 버튼을 구분하는 값 (분야 코드나 번호) */
  key: string;
  label: string;
  href: string;
  /** 손가락을 올렸을 때 나오는 설명 */
  title?: string;
};

/**
 * 분야·날짜를 담는 한 줄.
 *
 * ⚠️ 이 안에서는 순서가 **분야 → 날짜** 여야 합니다. 휴대폰에서 날짜가
 *    아랫줄로 내려가야 하는데, 순서가 반대면 날짜가 위로 올라갑니다.
 */
export function PickerBar({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-start gap-4">{children}</div>;
}

/** 날짜 고르기처럼 옆에 붙는 것 (폭이 정해져 있고 안 줄어듭니다) */
export function PickerSide({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="shrink-0">
      <FieldLabel>{label}</FieldLabel>
      {children}
    </div>
  );
}

export default function CategoryPicker({
  label = "분야",
  items,
  activeKey,
}: {
  /** '분야' 또는 '매장' */
  label?: string;
  items: PickItem[];
  activeKey: string;
}) {
  return (
    /*
      basis-full  휴대폰에서는 한 줄을 다 씁니다 (날짜가 아랫줄로 내려감)
      sm:basis-0 sm:flex-1  넓은 화면에서는 날짜와 한 줄을 나눠 씁니다

      ⚠️ 예전에는 `min-w-0 flex-1` 이었습니다. 그러면 휴대폰에서도 날짜와
         한 줄을 나눠 쓰느라 분야 상자가 계속 좁아졌습니다.
    */
    <div className="min-w-0 basis-full sm:basis-0 sm:flex-1">
      <FieldLabel>{label}</FieldLabel>
      {/*
        분야가 많아 그냥 두면 휴대폰에서 화면 절반을 버튼이 덮습니다
        (2026-08-09 대표님 요청). 높이를 정해 두고 그 안에서만 넘깁니다.

        ⚠️ scroll-x 는 이름이 아주 긴 분야 하나가 상자보다 넓을 때를 위한
           안전장치입니다. 평소에는 줄바꿈(flex-wrap)이라 안 쓰입니다.
      */}
      <div className="scroll-x flex max-h-48 flex-wrap gap-1.5 overflow-y-auto rounded-lg border border-line-soft bg-surface-2 p-2">
        {items.map((it) => (
          <Pill
            key={it.key}
            href={it.href}
            active={it.key === activeKey}
            title={it.title}
          >
            {it.label}
          </Pill>
        ))}
      </div>
    </div>
  );
}
