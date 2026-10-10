import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/** One renderer for saved answers, streaming answers and the Thinking panel. */
export function AgentMarkdown({ text }: { text: string }) {
  return (
    <div className="rag__markdown">
      <Markdown remarkPlugins={[remarkGfm]} skipHtml disallowedElements={['img']}
        components={{
          a: ({ href, children, title }) => <a href={href} title={title} target="_blank" rel="noopener noreferrer">{children}</a>,
          table: ({ children }) => <div className="rag__table-scroll"><table>{children}</table></div>,
        }}>
        {text}
      </Markdown>
    </div>
  );
}
