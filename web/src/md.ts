import DOMPurify from "dompurify";
import { marked } from "marked";

// Agent replies are markdown. They're rendered, then sanitized: an agent quoting a web page or a file
// must never be able to run script in Kuvend's tab (which holds the token that drives your agents).
marked.setOptions({ gfm: true, breaks: false });

export function renderMarkdown(text: string): string {
  const html = marked.parse(text, { async: false }) as string;
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true }, FORBID_TAGS: ["style", "form", "input", "button", "iframe"], FORBID_ATTR: ["style"] });
}
