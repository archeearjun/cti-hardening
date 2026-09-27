import { DOMParser } from "@xmldom/xmldom";
import { checkXmlInput, wrapXml } from "./browser-xml.ts";
export const workerXml = {
  parse(xml: string) {
    checkXmlInput(xml);
    const doc = new DOMParser({
      onError: (_level, message) => {
        throw new Error(message);
      },
    }).parseFromString(xml, "application/xml");
    if (!doc.documentElement) throw new Error("Invalid XML.");
    const root = doc.documentElement;
    return { getRootElement: () => wrapXml(root) };
  },
};
