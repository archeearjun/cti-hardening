/** Describe a sanitized resource projection without certifying its contents.
 * Only one element with the expected ID can establish a matching projection.
 * Extra fields may be metadata, references or content; their presence proves
 * none of the item order, question coverage or answer keys needed by a capture.
 * Self-contained so the browser diagnostic can print this function directly. */
export function classifyCourseraResourceProjection(
  value: unknown,
  expectedAtomId: string,
) {
  const result = {
    status: "UNRECOGNIZED_RESOURCE_BODY",
    schemaFieldCount: 0,
    expectedIdObserved: false,
    hasRelationMetadata: false,
    contentCertified: false as const,
    wholeCourseVerified: false as const,
  };
  if (!value || typeof value !== "object" || Array.isArray(value))
    return result;
  const ownValue = (object: object, key: string): unknown => {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    return descriptor && "value" in descriptor ? descriptor.value : undefined;
  };
  const links = ownValue(value, "links");
  const relationMap =
    links && typeof links === "object" && !Array.isArray(links)
      ? ownValue(links, "elements")
      : undefined;
  result.hasRelationMetadata = Boolean(
    relationMap &&
      typeof relationMap === "object" &&
      !Array.isArray(relationMap) &&
      Object.keys(relationMap).some((key) => {
        const resource = ownValue(relationMap, key);
        return (
          typeof resource === "string" &&
          /^[A-Za-z][A-Za-z0-9]*\.v\d+(?:\/[A-Za-z0-9]+)*$/.test(resource)
        );
      }),
  );
  const elements = ownValue(value, "elements");
  if (
    !Array.isArray(elements) ||
    typeof expectedAtomId !== "string" ||
    !expectedAtomId
  )
    return result;
  if (elements.length === 0) return { ...result, status: "EMPTY_RESOURCE" };
  if (elements.length !== 1) return result;
  const element = elements[0];
  if (!element || typeof element !== "object" || Array.isArray(element))
    return result;
  const id = ownValue(element, "id");
  if (typeof id !== "string" || !id) return result;
  result.schemaFieldCount = Object.keys(element).filter(
    (key) => key !== "id",
  ).length;
  if (id !== expectedAtomId)
    return { ...result, status: "UNEXPECTED_RESOURCE_ID" };
  result.expectedIdObserved = true;
  if (result.schemaFieldCount > 0)
    return { ...result, status: "SCHEMA_FIELDS_RETURNED" };
  return {
    ...result,
    status: result.hasRelationMetadata
      ? "IDENTIFIER_ONLY_WITH_RELATION_METADATA"
      : "IDENTIFIER_ONLY",
  };
}
