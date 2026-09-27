// Read-only XmlService compatibility for caller-supplied XML.
export interface Namespace {
  getURI(): string;
}
interface ElementLike {
  localName: string | null;
  nodeName: string;
  namespaceURI: string | null;
  textContent: string | null;
  childNodes: ArrayLike<any>;
  hasAttribute(name: string): boolean;
  getAttribute(name: string): string | null;
}
export interface XmlElement {
  getName(): string;
  getNamespace(): Namespace;
  getText(): string;
  getAttribute(name: string): { getValue(): string } | null;
  getChildren(name?: string, ns?: Namespace | string): XmlElement[];
  getChild(name: string, ns?: Namespace | string): XmlElement | null;
}
export function wrapXml(element: ElementLike): XmlElement {
  const children = (name?: string, ns?: Namespace | string) =>
    Array.from(element.childNodes).filter(
      (child) =>
        child.nodeType === 1 &&
        (name === undefined ||
          (child.localName === name &&
            (child.namespaceURI || "") ===
              (typeof ns === "string" ? ns : ns?.getURI() || ""))),
    );
  return {
    getName: () => element.localName || element.nodeName,
    getNamespace: () => ({ getURI: () => element.namespaceURI || "" }),
    getText: () => element.textContent || "",
    getAttribute: (name) =>
      element.hasAttribute(name)
        ? { getValue: () => element.getAttribute(name) || "" }
        : null,
    getChildren: (name, ns) => children(name, ns).map(wrapXml),
    getChild: (name, ns) => {
      const child = children(name, ns)[0];
      return child ? wrapXml(child) : null;
    },
  };
}
export function checkXmlInput(xml: string) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml))
    throw new Error("XML declarations are unsupported.");
}
export const browserXml = {
  parse(xml: string) {
    checkXmlInput(xml);
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    const error = Array.from(doc.getElementsByTagName("*")).find(
      (el) => el.localName === "parsererror",
    );
    if (error || !doc.documentElement)
      throw new Error(error?.textContent || "Invalid XML.");
    return { getRootElement: () => wrapXml(doc.documentElement) };
  },
};
