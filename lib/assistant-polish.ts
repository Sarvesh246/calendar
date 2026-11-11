/**
 * The model's wording drifts: "Based on your digest, …", `*` bullets in one
 * answer and `-` in the next, a trailing italic note. Style rules in the prompt
 * cut most of it; this is the deterministic pass for what is left, so the two
 * engines read alike. It only ever removes or normalises — it never adds words.
 */
export function polishReply(text: string): string {
  let out = text.replace(/\r\n/g, "\n").trim();

  // "Based on your digest," / "According to your calendar:" — internal wording.
  out = out.replace(
    /^(?:based on|according to|from|looking at|using)\s+(?:your|the)\s+(?:digest|data|calendar|snapshot|schedule|records?|information)\b[,:;\s-]*/i,
    "",
  );

  // `*`, `•` bullets become `-`. A line that opens `**bold**` is not a bullet.
  out = out.replace(/^([ \t]*)(?:\*(?!\*)|•)[ \t]+/gm, "$1- ");

  // A trailing paragraph that is nothing but italics (or a bracketed note) is
  // a plain sentence, not an aside.
  const paragraphs = out.split(/\n{2,}/);
  if (paragraphs.length > 1) {
    const last = paragraphs[paragraphs.length - 1].trim();
    const wrapped = /^(?:\*([^*\n]+)\*|_([^_\n]+)_)$/.exec(last);
    if (wrapped) paragraphs[paragraphs.length - 1] = unbracket(wrapped[1] ?? wrapped[2]);
    out = paragraphs.join("\n\n");
  }

  // Re-capitalise what the opener strip left behind.
  return out.replace(/^[a-z]/, (c) => c.toUpperCase());
}

function unbracket(note: string): string {
  const inner = /^[[(](.*)[\])]$/.exec(note.trim());
  return (inner ? inner[1] : note).trim();
}
