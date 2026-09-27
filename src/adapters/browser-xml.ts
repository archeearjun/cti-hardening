// Minimal XmlService-compatible read adapter. Only used for caller-provided
// package XML; it has no access to Google services or stored course records.
interface XmlElement {
  getName(): string;
  getNamespace(): string;
  getText(): string;
  getAttribute(name: string): { getValue(): string } | null;
  getChildren(name: string, ns: string): XmlElement[];
  getChild(name: string, ns: string): XmlElement | null;
}
function wrap(element: Element): XmlElement {
  return {
    getName: () => element.localName,
    getNamespace: () => element.namespaceURI || "",
    getText: () => element.textContent || "",
    getAttribute: (name: string) =>
      element.hasAttribute(name)
        ? { getValue: () => element.getAttribute(name) || "" }
        : null,
    getChildren: (name: string, ns: string) =>
      Array.from(element.children)
        .filter(
          (child) =>
            child.localName === name && (child.namespaceURI || "") === ns,
        )
        .map(wrap),
    getChild: (name: string, ns: string): ReturnType<typeof wrap> | null => {
      const child = Array.from(element.children).find(
        (child) =>
          child.localName === name && (child.namespaceURI || "") === ns,
      );
      return child ? wrap(child) : null;
    },
  };
}
export const browserXml = {
  parse(xml: string) {
    if (/<!DOCTYPE|<!ENTITY/i.test(xml))
      throw new Error("XML declarations are unsupported.");
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    const error = Array.from(doc.getElementsByTagName("*")).find(
      (el) => el.localName === "parsererror",
    );
    if (error || !doc.documentElement)
      throw new Error(error?.textContent || "Invalid XML.");
    return { getRootElement: () => wrap(doc.documentElement) };
  },
};
