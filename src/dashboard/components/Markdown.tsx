import { useMemo } from "preact/hooks";
import { parseMarkdown, type Block, type Inline } from "../../core/markdown";

// Renders the safe Markdown AST as elements — no innerHTML anywhere, so text
// from the API can never become markup. Links are https-only (enforced by the
// parser) and open in a new tab.

function Inl({ nodes }: { nodes: Inline[] }) {
  return (
    <>
      {nodes.map((n, i) => {
        switch (n.t) {
          case "text":
            return n.v;
          case "br":
            return <br key={i} />;
          case "b":
            return (
              <strong key={i}>
                <Inl nodes={n.c} />
              </strong>
            );
          case "i":
            return (
              <em key={i}>
                <Inl nodes={n.c} />
              </em>
            );
          case "code":
            return <code key={i}>{n.v}</code>;
          case "a":
            return (
              <a key={i} href={n.href} target="_blank" rel="noopener noreferrer">
                <Inl nodes={n.c} />
              </a>
            );
        }
      })}
    </>
  );
}

function Blk({ b }: { b: Block }) {
  switch (b.t) {
    case "h": {
      const H = (`h${Math.min(6, b.level + 2)}` as "h3");
      return (
        <H class="md__h">
          <Inl nodes={b.c} />
        </H>
      );
    }
    case "p":
      return (
        <p>
          <Inl nodes={b.c} />
        </p>
      );
    case "pre":
      return (
        <pre class="md__pre">
          <code>{b.v}</code>
        </pre>
      );
    case "ul":
    case "ol": {
      const L = b.t;
      return (
        <L>
          {b.items.map((it, i) => (
            <li key={i}>
              <Inl nodes={it} />
            </li>
          ))}
        </L>
      );
    }
    case "quote":
      return (
        <blockquote>
          {b.c.map((x, i) => (
            <Blk key={i} b={x} />
          ))}
        </blockquote>
      );
    case "hr":
      return <hr />;
  }
}

export function Markdown({ src, class: cls }: { src: string; class?: string }) {
  const blocks = useMemo(() => parseMarkdown(src), [src]);
  return (
    <div class={`md${cls ? ` ${cls}` : ""}`}>
      {blocks.map((b, i) => (
        <Blk key={i} b={b} />
      ))}
    </div>
  );
}
