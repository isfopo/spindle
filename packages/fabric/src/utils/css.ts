export const TAG_DISPLAY: Record<string, string> = {
  div: "block", span: "inline", p: "block", a: "inline",
  nav: "block", section: "block", article: "block", aside: "block",
  header: "block", footer: "block", main: "block",
  ul: "block", ol: "block", li: "list-item",
  table: "table", tr: "table-row", td: "table-cell", th: "table-cell",
  form: "block", button: "inline-block", label: "inline", fieldset: "block",
  h1: "block", h2: "block", h3: "block", h4: "block", h5: "block", h6: "block",
};

export function buildConditionSelector(condition: string, scopeSelector: string): string {
  switch (condition) {
    case "valid": return `${scopeSelector}:valid`;
    case "invalid": return `${scopeSelector}:invalid`;
    case "checked": return `${scopeSelector}:has(:checked)`;
    case "unchecked": return `${scopeSelector}:not(:has(:checked))`;
    case "focused": return `${scopeSelector}:focus-within`;
    default: return `${scopeSelector}:has([data-state-value="${condition}"]:checked)`;
  }
}
export function toCSSProp(jsx: string): string {
  return jsx.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}

export function cssBlock(props: Record<string, string>): string {
  return Object.entries(props)
    .map(([k, v]) => `${toCSSProp(k)}: ${v}`)
    .join("; ");
}
