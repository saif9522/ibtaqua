/** Minimal, safe Markdown renderer for CMS pages: headings, paragraphs, lists, bold, italic, links. No raw HTML. */
const inline = (text, key) => {
  const parts = [];
  const re = /(\*\*[^*]+\*\*|_[^_]+_|\[[^\]]+\]\([^)\s]+\))/g;
  let last = 0; let m; let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const t = m[0];
    if (t.startsWith('**')) parts.push(<strong key={`${key}-${i++}`}>{t.slice(2, -2)}</strong>);
    else if (t.startsWith('_')) parts.push(<em key={`${key}-${i++}`}>{t.slice(1, -1)}</em>);
    else {
      const [, label, href] = t.match(/\[([^\]]+)\]\(([^)]+)\)/);
      const safe = /^(https?:|mailto:|tel:|\/)/.test(href) ? href : '#';
      parts.push(<a key={`${key}-${i++}`} href={safe} className="link" rel="noreferrer">{label}</a>);
    }
    last = m.index + t.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
};

export default function Markdown({ source = '' }) {
  const blocks = String(source).replace(/\r/g, '').split(/\n{2,}/);
  return (
    <div className="space-y-4 text-[16px] leading-relaxed text-ink">
      {blocks.map((b, i) => {
        const line = b.trim();
        if (!line) return null;
        const h = line.match(/^(#{1,3})\s+(.*)$/);
        if (h) { const T = `h${h[1].length + 1}`; return <T key={i} className={h[1].length === 1 ? 'pt-2 text-2xl' : 'pt-2 text-xl'}>{inline(h[2], i)}</T>; }
        if (/^[-*]\s/.test(line)) return <ul key={i} className="list-disc space-y-1 pl-5">{line.split('\n').map((l, k) => <li key={k}>{inline(l.replace(/^[-*]\s+/, ''), `${i}-${k}`)}</li>)}</ul>;
        if (/^\d+\.\s/.test(line)) return <ol key={i} className="list-decimal space-y-1 pl-5">{line.split('\n').map((l, k) => <li key={k}>{inline(l.replace(/^\d+\.\s+/, ''), `${i}-${k}`)}</li>)}</ol>;
        return <p key={i}>{line.split('\n').map((l, k) => <span key={k}>{k > 0 && <br />}{inline(l, `${i}-${k}`)}</span>)}</p>;
      })}
    </div>
  );
}
