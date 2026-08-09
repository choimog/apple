import type { ReactNode } from "react";

/**
 * 아주 작은 마크다운 표시기.
 *
 * 【왜 라이브러리를 안 썼나요?】
 * 리포트는 AI 가 쓴 글입니다. 남이 쓴 글을 HTML 로 바꿔서 화면에 그대로
 * 꽂으면(dangerouslySetInnerHTML) 위험합니다. 여기서는 **글자를 글자로만**
 * 다룹니다. 어떤 경우에도 HTML 이 실행되지 않습니다.
 *
 * 알아듣는 것은 네 가지뿐입니다. crawler/run_report.py 에서 AI 에게
 * 이 네 가지만 쓰라고 못박아 두었습니다.
 *   ## 소제목
 *   - 항목
 *   **굵게**
 *   그냥 문단
 *
 * 모르는 표시가 오면 지우지 않고 **글자 그대로** 보여줍니다.
 * (조용히 없애면 리포트가 잘린 줄 모르고 지나갑니다)
 */

/** **굵게** 만 처리합니다. 나머지는 전부 그냥 글자입니다. */
function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const parts = text.split(/\*\*(.+?)\*\*/g);
  parts.forEach((p, i) => {
    if (!p) return;
    // 홀수 번째가 ** ** 안쪽입니다
    if (i % 2 === 1) {
      out.push(
        <strong key={`${keyBase}-b${i}`} className="font-semibold text-ink">
          {p}
        </strong>
      );
    } else {
      out.push(<span key={`${keyBase}-t${i}`}>{p}</span>);
    }
  });
  return out;
}

export default function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];

  let bullets: string[] = [];
  let para: string[] = [];

  const flushBullets = (k: number) => {
    if (!bullets.length) return;
    const items = bullets;
    bullets = [];
    blocks.push(
      <ul key={`ul${k}`} className="mt-2 space-y-1.5 pl-1">
        {items.map((b, i) => (
          <li key={i} className="flex gap-2 text-sm leading-relaxed text-ink-soft">
            <span aria-hidden className="mt-[7px] size-1 shrink-0 rounded-full bg-accent" />
            <span className="min-w-0">{inline(b, `li${k}-${i}`)}</span>
          </li>
        ))}
      </ul>
    );
  };

  const flushPara = (k: number) => {
    if (!para.length) return;
    const t = para.join(" ");
    para = [];
    blocks.push(
      <p key={`p${k}`} className="mt-2 text-sm leading-relaxed text-ink-soft">
        {inline(t, `p${k}`)}
      </p>
    );
  };

  lines.forEach((raw, k) => {
    const line = raw.trimEnd();

    if (!line.trim()) {
      flushBullets(k);
      flushPara(k);
      return;
    }

    const head = /^(#{1,4})\s+(.*)$/.exec(line);
    if (head) {
      flushBullets(k);
      flushPara(k);
      blocks.push(
        <h3
          key={`h${k}`}
          className="mt-5 text-[15px] font-bold tracking-[-0.01em] first:mt-0"
        >
          {inline(head[2], `h${k}`)}
        </h3>
      );
      return;
    }

    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    if (bullet) {
      flushPara(k);
      bullets.push(bullet[1]);
      return;
    }

    flushBullets(k);
    para.push(line.trim());
  });

  flushBullets(lines.length);
  flushPara(lines.length);

  return <div className="report-body">{blocks}</div>;
}
