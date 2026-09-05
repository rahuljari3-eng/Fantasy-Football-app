import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";

const components: Components = {
  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold text-white">{children}</strong>,
  em: ({ children }) => <em className="italic text-[#E5E5EA]">{children}</em>,
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-[#C9A227] underline underline-offset-2 decoration-[#C9A227]/40 hover:decoration-[#C9A227]"
    >
      {children}
    </a>
  ),
  ul: ({ children }) => <ul className="my-2 ml-4 list-disc space-y-1 marker:text-[#C9A227]">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 ml-4 list-decimal space-y-1 marker:text-[#C9A227]">{children}</ol>,
  li: ({ children }) => <li className="pl-0.5">{children}</li>,
  h1: ({ children }) => <h3 className="mt-2 mb-1 text-base font-semibold text-white">{children}</h3>,
  h2: ({ children }) => <h3 className="mt-2 mb-1 text-sm font-semibold text-white">{children}</h3>,
  h3: ({ children }) => <h3 className="mt-2 mb-1 text-sm font-semibold text-[#E5E5EA]">{children}</h3>,
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-[#C9A227]/50 pl-3 text-[#98989D]">{children}</blockquote>
  ),
  code: ({ className, children }) => {
    const isBlock = Boolean(className);
    if (isBlock) {
      return (
        <code className="mono-font block overflow-x-auto rounded-lg bg-black/50 px-2.5 py-2 text-[12px] text-[#E5E5EA]">
          {children}
        </code>
      );
    }
    return (
      <code className="mono-font rounded bg-black/40 px-1 py-0.5 text-[12px] text-[#C9A227]">{children}</code>
    );
  },
  pre: ({ children }) => <pre className="my-2 overflow-x-auto">{children}</pre>,
  hr: () => <hr className="my-3 border-[#38383A]" />,
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto">
      <table className="w-full border-collapse text-left text-[12px]">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="border-b border-[#38383A] text-[#98989D]">{children}</thead>,
  th: ({ children }) => <th className="px-2 py-1.5 font-medium">{children}</th>,
  td: ({ children }) => <td className="border-t border-[#38383A]/60 px-2 py-1.5">{children}</td>,
};

/** Render Sensei replies as formatted markdown (links, bold, lists) instead of raw syntax. */
export function SenseiMarkdown({ content }: { content: string }) {
  return (
    <div className="sensei-md break-words">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
