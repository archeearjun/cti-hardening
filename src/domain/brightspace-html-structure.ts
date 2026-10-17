import { DOMParser, type Element, type Node } from "@xmldom/xmldom";

export interface BrightspaceHtmlStructureContext {
  topicId: string;
  originalRef: string;
  sourceUrl: string;
}
export interface BrightspaceHtmlResource {
  tag: string;
  attribute: string;
  rawUrl: string;
  url: string;
  title: string | null;
  alt: string | null;
}
export interface BrightspaceHtmlTable {
  ordinal: number;
  caption: string;
  rows: {
    cells: {
      kind: "th" | "td";
      text: string;
      rowSpan: string | null;
      colSpan: string | null;
    }[];
  }[];
}
export interface BrightspaceHtmlPanel {
  key: string;
  label: string;
  activeAtCapture: boolean;
  text: string;
  textTruncated: boolean;
  resources: BrightspaceHtmlResource[];
  tables: BrightspaceHtmlTable[];
}
export interface BrightspaceHtmlStructure
  extends BrightspaceHtmlStructureContext {
  schemaVersion: 1;
  method: "STATIC_AUTHORED_HTML";
  scope: "STATIC_MARKUP_ONLY";
  groups: {
    ordinal: number;
    kind: "D2L_HORIZONTAL_TABS";
    instruction: string;
    panels: BrightspaceHtmlPanel[];
  }[];
  issues: string[];
  truncated: boolean;
}

const limits = {
  input: 4 * 1024 * 1024,
  output: 1024 * 1024,
  nodes: 50000,
  depth: 120,
  groups: 50,
  panels: 200,
  resources: 1000,
  tables: 100,
  rows: 3000,
  cells: 12000,
  characters: 120000,
};
const encoder = new TextEncoder();
const tag = (node: Node) =>
  node.nodeType === 1 ? (node as Element).tagName.toLowerCase() : "";
const hasClass = (element: Element, name: string) =>
  (element.getAttribute("class") || "").split(/\s+/).includes(name);
const skipped = new Set(["script", "style", "head", "noscript", "template"]);
const blocks = new Set([
  "p",
  "div",
  "section",
  "article",
  "header",
  "footer",
  "li",
  "tr",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote",
  "pre",
]);
function validSourceUrl(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > 16384 ||
    /[\u0000-\u0020\u007f]/.test(value)
  )
    return false;
  try {
    const url = new URL(value);
    return /^https?:$/.test(url.protocol) && !url.username && !url.password;
  } catch {
    return false;
  }
}
function validContext(value: BrightspaceHtmlStructureContext) {
  return (
    value &&
    typeof value.topicId === "string" &&
    value.topicId.length > 0 &&
    value.topicId.length <= 160 &&
    !/[\u0000-\u001f\u007f]/.test(value.topicId) &&
    typeof value.originalRef === "string" &&
    /^[a-f0-9]{64}$/.test(value.originalRef) &&
    validSourceUrl(value.sourceUrl)
  );
}
function resolveResource(rawUrl: string, sourceUrl: string) {
  try {
    // HTML base elements cannot replace the independently bound response URL.
    if (/[\u0000-\u001f\u007f]/.test(rawUrl)) return "";
    const url = new URL(rawUrl, sourceUrl);
    return /^https?:$/.test(url.protocol) && !url.username && !url.password
      ? url.href
      : "";
  } catch {
    return "";
  }
}
function nearest(element: Node | null, predicate: (value: Element) => boolean) {
  for (let node = element; node; node = node.parentNode)
    if (node.nodeType === 1 && predicate(node as Element))
      return node as Element;
  return null;
}
const widgetOwner = (node: Node) =>
  nearest(node.parentNode, (el) => hasClass(el, "d2l-element"));
function ownDescendants(element: Element, skipNestedPanes = false) {
  const found: Element[] = [];
  const pending = Array.from(element.childNodes || []).reverse();
  while (pending.length) {
    const node = pending.pop()!;
    if (node.nodeType !== 1 || skipped.has(tag(node))) continue;
    const child = node as Element;
    if (
      hasClass(child, "d2l-element") ||
      (skipNestedPanes && hasClass(child, "tab-pane"))
    )
      continue;
    found.push(child);
    const children = Array.from(child.childNodes || []);
    for (let index = children.length - 1; index >= 0; index--)
      pending.push(children[index]);
  }
  return found;
}

/** Inert, bounded interpretation of supported authored markup. The caller must
 * first bind HTML to its independently verified retained original. This never
 * executes source scripts, opens LTI tools or asserts rendered/runtime fidelity. */
export function deriveBrightspaceHtmlStructure(
  html: string,
  context: BrightspaceHtmlStructureContext,
): BrightspaceHtmlStructure | null {
  if (typeof html !== "string" || !validContext(context)) return null;
  const result: BrightspaceHtmlStructure = {
    schemaVersion: 1,
    method: "STATIC_AUTHORED_HTML",
    scope: "STATIC_MARKUP_ONLY",
    topicId: context.topicId,
    originalRef: context.originalRef,
    sourceUrl: context.sourceUrl,
    groups: [],
    issues: [],
    truncated: false,
  };
  const issue = (code: string) => {
    if (!result.issues.includes(code) && result.issues.length < 100)
      result.issues.push(code);
  };
  const diagnostic = (code: string) => {
    issue(code);
    result.truncated = true;
    return result;
  };
  const looksSupported =
    /d2l-element/.test(html) && /tabs-horizontal/.test(html);
  if (
    html.length > limits.input ||
    encoder.encode(html).byteLength > limits.input
  )
    return looksSupported ? diagnostic("HTML_INPUT_LIMIT_EXCEEDED") : null;
  if (/<!ENTITY\b|<!DOCTYPE[^>]*\[/i.test(html))
    return looksSupported
      ? diagnostic("HTML_ENTITY_DECLARATION_UNSUPPORTED")
      : null;
  let document;
  let parseProblem = false;
  try {
    document = new DOMParser({
      onError: () => {
        parseProblem = true;
      },
    }).parseFromString(html, "text/html");
  } catch {
    return looksSupported ? diagnostic("HTML_PARSE_UNRESOLVED") : null;
  }
  if (parseProblem)
    return looksSupported ? diagnostic("HTML_PARSE_UNRESOLVED") : null;
  const elements: Element[] = [];
  const stack: { node: Node; depth: number }[] = [{ node: document, depth: 0 }];
  let nodes = 0;
  while (stack.length) {
    const current = stack.pop()!;
    if (++nodes > limits.nodes || current.depth > limits.depth)
      return looksSupported ? diagnostic("HTML_DOM_LIMIT_EXCEEDED") : null;
    if (current.node.nodeType === 1) elements.push(current.node as Element);
    // Excluded content is still bounded but can never become a widget or text.
    if (skipped.has(tag(current.node))) continue;
    const children = Array.from(current.node.childNodes || []);
    for (let i = children.length - 1; i >= 0; i--)
      stack.push({ node: children[i], depth: current.depth + 1 });
  }
  const ownedElements = new Map<Element, Element[]>();
  const supported = new Set<Element>();
  for (const element of elements) {
    const owner = widgetOwner(element);
    if (!owner) continue;
    const owned = ownedElements.get(owner) || [];
    owned.push(element);
    ownedElements.set(owner, owned);
    if (
      hasClass(element, "tabs-wrapper") &&
      hasClass(element, "tabs-horizontal") &&
      owner.getAttribute("data-type") === "horizontal"
    )
      supported.add(owner);
  }
  const widgets = elements.filter((element) => supported.has(element));
  if (!widgets.length) return null;
  const widgetSet = new Set(widgets);
  let characters =
    context.topicId.length +
    context.originalRef.length +
    context.sourceUrl.length;
  let panelCount = 0,
    resourceCount = 0,
    tableCount = 0,
    rowCount = 0,
    cellCount = 0;
  function take(
    value: string,
    maximum: number,
    code = "STRUCTURE_TEXT_LIMIT_EXCEEDED",
  ) {
    const remaining = Math.max(
      0,
      Math.min(maximum, limits.characters - characters),
    );
    const output = value.slice(0, remaining);
    characters += output.length;
    if (output.length !== value.length) {
      issue(code);
      result.truncated = true;
    }
    return { value: output, truncated: output.length !== value.length };
  }
  function staticText(root: Node, skipNestedTables = false) {
    function visit(node: Node): string {
      if (node.nodeType === 3 || node.nodeType === 4)
        return node.nodeValue || "";
      const name = tag(node);
      if (
        skipped.has(name) ||
        (node !== root &&
          node.nodeType === 1 &&
          (widgetSet.has(node as Element) ||
            hasClass(node as Element, "tab-pane") ||
            (skipNestedTables && name === "table")))
      )
        return "";
      if (name === "br") return "\n";
      let text = Array.from(node.childNodes || [])
        .map(visit)
        .join("");
      if (blocks.has(name)) text += "\n";
      if (node !== root && (name === "td" || name === "th")) text += "\t";
      return text;
    }
    return visit(root);
  }
  for (const widget of widgets) {
    if (result.groups.length >= limits.groups) {
      diagnostic("WIDGET_LIMIT_EXCEEDED");
      break;
    }
    const ordinal = result.groups.length + 1;
    const owned = ownedElements.get(widget) || [];
    const wrappers = owned.filter(
      (el) => hasClass(el, "tabs-wrapper") && hasClass(el, "tabs-horizontal"),
    );
    const group = {
      ordinal,
      kind: "D2L_HORIZONTAL_TABS" as const,
      instruction: "",
      panels: [] as BrightspaceHtmlPanel[],
    };
    result.groups.push(group);
    const instructions = owned.filter((el) => hasClass(el, "instruction"));
    group.instruction = take(
      instructions.map((el) => staticText(el)).join("\n"),
      4096,
    ).value;
    if (wrappers.length !== 1) {
      issue(`GROUP_${ordinal}_AMBIGUOUS_WRAPPER`);
      continue;
    }
    const wrapper = wrappers[0];
    const scoped = ownDescendants(wrapper);
    const labels = new Map<string, Element[]>(),
      panels = new Map<string, Element[]>();
    for (const el of scoped) {
      const property = el.getAttribute("data-itemprop") || "";
      const match = /^(0|[1-9]\d{0,3})\|([01])$/.exec(property);
      if (!match) continue;
      if (
        match[2] === "0" &&
        tag(el) === "span" &&
        nearest(
          el.parentNode,
          (candidate) =>
            tag(candidate) === "a" && hasClass(candidate, "list-group-item"),
        )
      )
        labels.set(match[1], [...(labels.get(match[1]) || []), el]);
      if (match[2] === "1" && hasClass(el, "tab-pane")) {
        const enclosing = nearest(
          el.parentNode,
          (candidate) =>
            hasClass(candidate, "tab-pane") ||
            hasClass(candidate, "d2l-element"),
        );
        if (enclosing && hasClass(enclosing, "tab-pane"))
          issue(`GROUP_${ordinal}_KEY_${match[1]}_NESTED_PANEL_UNRESOLVED`);
        else if (
          el.parentNode?.nodeType === 1 &&
          hasClass(el.parentNode as Element, "tab-content")
        )
          panels.set(match[1], [...(panels.get(match[1]) || []), el]);
      }
    }
    if (!labels.size && !panels.size)
      issue(`GROUP_${ordinal}_NO_SUPPORTED_PAIRS`);
    const keys = [...new Set([...labels.keys(), ...panels.keys()])];
    for (const key of keys) {
      if (labels.get(key)?.length !== 1 || panels.get(key)?.length !== 1) {
        issue(`GROUP_${ordinal}_KEY_${key}_AMBIGUOUS_OR_MISSING_PAIR`);
        continue;
      }
      if (panelCount >= limits.panels) {
        diagnostic("PANEL_LIMIT_EXCEEDED");
        break;
      }
      panelCount++;
      const label = labels.get(key)![0],
        pane = panels.get(key)![0];
      const paneText = take(staticText(pane), 100000);
      const panel: BrightspaceHtmlPanel = {
        key,
        label: take(staticText(label), 4096).value,
        activeAtCapture: hasClass(pane, "active"),
        text: paneText.value,
        textTruncated: paneText.truncated,
        resources: [],
        tables: [],
      };
      group.panels.push(panel);
      const descendants = ownDescendants(pane, true);
      for (const el of descendants) {
        const name = tag(el);
        const attrs =
          name === "object"
            ? ["data"]
            : name === "video"
              ? ["src", "poster"]
              : ["a", "area"].includes(name)
                ? ["href"]
                : [
                      "img",
                      "iframe",
                      "embed",
                      "audio",
                      "source",
                      "track",
                    ].includes(name)
                  ? ["src"]
                  : [];
        for (const attribute of attrs) {
          const raw = el.getAttribute(attribute);
          if (raw === null) continue;
          if (resourceCount >= limits.resources) {
            diagnostic("RESOURCE_LIMIT_EXCEEDED");
            break;
          }
          if (
            raw.length > 16384 ||
            characters + raw.length * 2 + 100 > limits.characters
          ) {
            diagnostic("RESOURCE_TEXT_LIMIT_EXCEEDED");
            continue;
          }
          const rawUrl = take(raw, 16384).value;
          const url = resolveResource(rawUrl, context.sourceUrl);
          if (characters + url.length > limits.characters) {
            diagnostic("RESOURCE_TEXT_LIMIT_EXCEEDED");
            continue;
          }
          characters += url.length;
          resourceCount++;
          panel.resources.push({
            tag: name,
            attribute,
            rawUrl,
            url,
            title: el.hasAttribute("title")
              ? take(el.getAttribute("title")!, 4096).value
              : null,
            alt: el.hasAttribute("alt")
              ? take(el.getAttribute("alt")!, 4096).value
              : null,
          });
        }
        if (name !== "table") continue;
        if (tableCount >= limits.tables) {
          diagnostic("TABLE_LIMIT_EXCEEDED");
          continue;
        }
        tableCount++;
        const table: BrightspaceHtmlTable = {
          ordinal: panel.tables.length + 1,
          caption: "",
          rows: [],
        };
        panel.tables.push(table);
        const inside = ownDescendants(el, true);
        const captions = inside.filter(
          (child) =>
            tag(child) === "caption" &&
            nearest(
              child.parentNode,
              (candidate) => tag(candidate) === "table",
            ) === el,
        );
        table.caption = take(
          captions.map((caption) => staticText(caption)).join("\n"),
          4096,
        ).value;
        for (const row of inside.filter(
          (child) =>
            tag(child) === "tr" &&
            nearest(
              child.parentNode,
              (candidate) => tag(candidate) === "table",
            ) === el,
        )) {
          if (rowCount >= limits.rows) {
            diagnostic("TABLE_ROW_LIMIT_EXCEEDED");
            break;
          }
          rowCount++;
          const outputRow: BrightspaceHtmlTable["rows"][number] = { cells: [] };
          table.rows.push(outputRow);
          for (const cell of Array.from(row.childNodes || []).filter((child) =>
            ["th", "td"].includes(tag(child)),
          ) as Element[]) {
            if (cellCount >= limits.cells) {
              diagnostic("TABLE_CELL_LIMIT_EXCEEDED");
              break;
            }
            cellCount++;
            outputRow.cells.push({
              kind: tag(cell) as "th" | "td",
              text: take(staticText(cell, true), 50000).value,
              rowSpan: cell.hasAttribute("rowspan")
                ? take(cell.getAttribute("rowspan")!, 64).value
                : null,
              colSpan: cell.hasAttribute("colspan")
                ? take(cell.getAttribute("colspan")!, 64).value
                : null,
            });
          }
        }
      }
    }
  }
  try {
    validateBrightspaceHtmlStructure(result, context);
  } catch {
    result.groups = [];
    diagnostic("STRUCTURE_OUTPUT_LIMIT_OR_SHAPE_UNRESOLVED");
  }
  return result;
}

/** A saved projection is bounded and bound to its original native topic. This
 * validates that projection; it does not attest source-server or runtime state. */
export function validateBrightspaceHtmlStructure(
  value: unknown,
  context: BrightspaceHtmlStructureContext,
): asserts value is BrightspaceHtmlStructure {
  const fail = () => {
    throw Error("Invalid or mismatched saved Brightspace HTML structure.");
  };
  if (!validContext(context)) fail();
  const object = (item: unknown, keys: string[]): Record<string, any> => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return fail();
    const record = item as Record<string, any>;
    if (
      Object.keys(record).length !== keys.length ||
      keys.some((key) => !Object.hasOwn(record, key))
    )
      fail();
    return record;
  };
  let characters = 0;
  const text = (item: unknown, maximum: number): string => {
    if (typeof item !== "string" || item.length > maximum) return fail();
    characters += item.length;
    if (characters > limits.characters) fail();
    return item;
  };
  const optionalText = (item: unknown, maximum: number) =>
    item === null ? null : text(item, maximum);
  const array = (item: unknown, maximum: number): any[] => {
    if (!Array.isArray(item) || item.length > maximum) return fail();
    return item;
  };
  const body = object(value, [
    "schemaVersion",
    "method",
    "scope",
    "topicId",
    "originalRef",
    "sourceUrl",
    "groups",
    "issues",
    "truncated",
  ]);
  if (
    body.schemaVersion !== 1 ||
    body.method !== "STATIC_AUTHORED_HTML" ||
    body.scope !== "STATIC_MARKUP_ONLY" ||
    typeof body.truncated !== "boolean"
  )
    fail();
  for (const [key, maximum] of [
    ["topicId", 160],
    ["originalRef", 64],
    ["sourceUrl", 16384],
  ] as const)
    if (text(body[key], maximum) !== context[key]) fail();
  let panels = 0,
    resources = 0,
    tables = 0,
    rows = 0,
    cells = 0;
  array(body.groups, limits.groups).forEach((value, index) => {
    const group = object(value, ["ordinal", "kind", "instruction", "panels"]);
    if (group.ordinal !== index + 1 || group.kind !== "D2L_HORIZONTAL_TABS")
      fail();
    text(group.instruction, 4096);
    const keys = new Set<string>();
    for (const value of array(group.panels, limits.panels)) {
      if (++panels > limits.panels) fail();
      const panel = object(value, [
        "key",
        "label",
        "activeAtCapture",
        "text",
        "textTruncated",
        "resources",
        "tables",
      ]);
      const key = text(panel.key, 4);
      if (
        !/^(0|[1-9]\d{0,3})$/.test(key) ||
        keys.has(key) ||
        typeof panel.activeAtCapture !== "boolean" ||
        typeof panel.textTruncated !== "boolean"
      )
        fail();
      keys.add(key);
      text(panel.label, 4096);
      text(panel.text, 100000);
      if (panel.textTruncated && !body.truncated) fail();
      for (const value of array(panel.resources, limits.resources)) {
        if (++resources > limits.resources) fail();
        const resource = object(value, [
          "tag",
          "attribute",
          "rawUrl",
          "url",
          "title",
          "alt",
        ]);
        const name = text(resource.tag, 16),
          attribute = text(resource.attribute, 16);
        const allowed =
          name === "object"
            ? ["data"]
            : name === "video"
              ? ["src", "poster"]
              : ["a", "area"].includes(name)
                ? ["href"]
                : [
                      "img",
                      "iframe",
                      "embed",
                      "audio",
                      "source",
                      "track",
                    ].includes(name)
                  ? ["src"]
                  : [];
        if (!allowed.includes(attribute)) fail();
        const raw = text(resource.rawUrl, 16384),
          resolved = text(resource.url, 32768);
        if (resolved !== resolveResource(raw, context.sourceUrl)) fail();
        optionalText(resource.title, 4096);
        optionalText(resource.alt, 4096);
      }
      array(panel.tables, limits.tables).forEach((value, index) => {
        if (++tables > limits.tables) fail();
        const table = object(value, ["ordinal", "caption", "rows"]);
        if (table.ordinal !== index + 1) fail();
        text(table.caption, 4096);
        for (const value of array(table.rows, limits.rows)) {
          if (++rows > limits.rows) fail();
          const row = object(value, ["cells"]);
          for (const value of array(row.cells, limits.cells)) {
            if (++cells > limits.cells) fail();
            const cell = object(value, ["kind", "text", "rowSpan", "colSpan"]);
            if (cell.kind !== "th" && cell.kind !== "td") fail();
            text(cell.text, 50000);
            optionalText(cell.rowSpan, 64);
            optionalText(cell.colSpan, 64);
          }
        }
      });
    }
  });
  for (const issue of array(body.issues, 100)) {
    if (!/^[A-Z0-9_]+$/.test(text(issue, 100))) fail();
  }
  if (encoder.encode(JSON.stringify(value)).byteLength > limits.output) fail();
}

export function brightspaceHtmlStructureText(
  structure: BrightspaceHtmlStructure,
): string {
  validateBrightspaceHtmlStructure(structure, structure);
  const lines = [
    "Captured tab structure — static authored HTML only",
    `Native topic: ${structure.topicId} | Original SHA-256: ${structure.originalRef}`,
    `Source response URL: ${structure.sourceUrl}`,
    "Panel presence and captured active classes do not establish rendered visibility, playback or loaded external activity content.",
  ];
  for (const group of structure.groups) {
    lines.push(
      `Tab group ${group.ordinal}${group.instruction ? `: ${group.instruction}` : ""}`,
    );
    for (const panel of group.panels) {
      lines.push(
        `Tab ${panel.key}: ${panel.label} | Active class at capture: ${panel.activeAtCapture}`,
        panel.text,
      );
      if (panel.textTruncated)
        lines.push(
          "Panel text preview truncated; the retained original remains separate.",
        );
      for (const resource of panel.resources)
        lines.push(
          `Static resource: ${resource.tag}.${resource.attribute} | ${resource.url || "Unsafe or unsupported URL; not linked"}`,
          `Authored reference: ${resource.rawUrl}`,
          `Authored title: ${resource.title === null ? "[attribute absent]" : resource.title === "" ? "[empty attribute]" : resource.title}`,
          `Authored alt text: ${resource.alt === null ? "[attribute absent]" : resource.alt === "" ? "[empty attribute]" : resource.alt}`,
        );
      for (const table of panel.tables) {
        lines.push(
          `Authored table ${table.ordinal}${table.caption ? `: ${table.caption}` : ""}`,
        );
        table.rows.forEach((row, index) =>
          lines.push(
            `Row ${index + 1}: ` +
              row.cells
                .map(
                  (cell) =>
                    `${cell.kind}${cell.rowSpan === null ? "" : ` rowspan=${cell.rowSpan}`}${cell.colSpan === null ? "" : ` colspan=${cell.colSpan}`}: ${cell.text}`,
                )
                .join(" | "),
          ),
        );
      }
    }
  }
  if (structure.truncated)
    lines.push(
      "Static structure preview is incomplete or exceeds a supported bound.",
    );
  lines.push(...structure.issues.map((issue) => `Structure issue: ${issue}`));
  return lines.join("\n");
}
