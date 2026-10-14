export interface CourseraMaterialLeafRelation {
  ordinal: number;
  itemId: string;
  ancestorIds: string[];
  sourceContentType: string;
  contentBearing: boolean;
  atomId: string | null;
  sourceContentId: string | null;
  atomReferenceBound: boolean;
  atomReferenceReason: string;
  staffAssignmentId: string | null;
  supplementAssetId: string | null;
  supplementAssetType: string | null;
}

export interface CourseraCourseMaterialsRelations {
  courseId: string;
  materialVersion: number | null;
  courseBranchVersion: number | null;
  inventoryCount: number;
  structuralLeafCount: number;
  contentItemCount: number;
  emptyStructuralLeafCount: number;
  contentTypeCounts: Record<string, number>;
  boundAtomReferenceCount: number;
  inventory: CourseraMaterialLeafRelation[];
  contentItems: CourseraMaterialLeafRelation[];
  wholeCourseVerified: false;
}

/** Parse the complete ordered hierarchy returned for one exact course.
 * The body supplies item-to-atom references, not assessment part order or keys.
 * Runtime helpers remain local so this function can be supplied to a bookmark
 * explicitly without capturing its TypeScript module's bindings. */
export function parseCourseraCourseMaterialsRelations(
  value: unknown,
  expectedCourseId: string,
): CourseraCourseMaterialsRelations {
  const limits = { nodes: 50000, leaves: 20000, depth: 32 };
  const object = (entry: unknown): entry is Record<string, any> =>
    !!entry && typeof entry === "object" && !Array.isArray(entry);
  function fail(code: string): never {
    throw new Error(code);
  }
  if (!/^[A-Za-z0-9_-]{8,160}$/.test(expectedCourseId))
    fail("INVALID_EXPECTED_COURSE_ID");
  if (
    !object(value) ||
    !Array.isArray(value.elements) ||
    value.elements.length !== 1
  )
    fail("AMBIGUOUS_MATERIAL_RESOURCE_ROOT");
  if (
    value.paging !== undefined &&
    (!object(value.paging) || Object.keys(value.paging).length !== 0)
  )
    fail("PAGINATED_MATERIAL_RESOURCE_NOT_SUPPORTED");
  const root = value.elements[0];
  if (!object(root) || root.id !== expectedCourseId)
    fail("MATERIAL_COURSE_ID_MISMATCH");
  if (!object(root.material) || !Array.isArray(root.material.elements))
    fail("MATERIAL_HIERARCHY_MISSING");
  const inventory: CourseraMaterialLeafRelation[] = [];
  const seenIds = new Set<string>();
  const active = new Set<object>();
  let visited = 0;
  function visit(entry: unknown, ancestors: string[], depth: number): void {
    if (++visited > limits.nodes || depth > limits.depth)
      fail("MATERIAL_HIERARCHY_LIMIT");
    if (!object(entry)) fail("MATERIAL_HIERARCHY_NODE_INVALID");
    if (active.has(entry)) fail("MATERIAL_HIERARCHY_CYCLE");
    active.add(entry);
    if (
      typeof entry.id !== "string" ||
      !/^[A-Za-z0-9_-]{1,160}$/.test(entry.id)
    )
      fail("MATERIAL_NODE_ID_INVALID");
    if (seenIds.has(entry.id)) fail("DUPLICATE_MATERIAL_NODE_ID");
    seenIds.add(entry.id);
    if (entry.elements !== undefined && !Array.isArray(entry.elements))
      fail("MATERIAL_CHILDREN_INVALID");
    const children = entry.elements || [];
    if (children.length) {
      if (entry.content !== undefined) fail("AMBIGUOUS_CONTENT_CONTAINER");
      for (const child of children)
        visit(child, ancestors.concat(entry.id), depth + 1);
    } else {
      const title = entry.originalName || entry.name || entry.title;
      if (typeof title !== "string" || !title.trim())
        fail("MATERIAL_LEAF_TITLE_MISSING");
      if (inventory.length >= limits.leaves) fail("MATERIAL_INVENTORY_LIMIT");
      const contentBearing = entry.content !== undefined;
      if (
        contentBearing &&
        (!object(entry.content) ||
          typeof entry.content.typeName !== "string" ||
          !entry.content.typeName.trim() ||
          !object(entry.content.definition))
      )
        fail("MATERIAL_CONTENT_REFERENCE_INVALID");
      const sourceContentType = contentBearing ? entry.content.typeName : "";
      const definition = contentBearing ? entry.content.definition : {};
      const atomId = typeof entry.atomId === "string" ? entry.atomId : null;
      const sourceContentId =
        typeof entry.contentId === "string" ? entry.contentId : null;
      // The actual material model's content key is atom~<22-character atom ID>.
      // Observed paired authoring resource requests use the plain atom ID.
      const atomReferenceBound =
        contentBearing &&
        !!atomId &&
        /^[A-Za-z0-9_-]{22}$/.test(atomId) &&
        sourceContentId === "atom~" + atomId;
      const reference = (key: string): string | null =>
        typeof definition[key] === "string" && definition[key].length <= 256
          ? definition[key]
          : null;
      inventory.push({
        ordinal: inventory.length + 1,
        itemId: entry.id,
        ancestorIds: [...ancestors],
        sourceContentType,
        contentBearing,
        atomId,
        sourceContentId,
        atomReferenceBound,
        atomReferenceReason: atomReferenceBound
          ? "EXACT_MATERIAL_ATOM_CONTENT_REFERENCE"
          : contentBearing
            ? "ATOM_CONTENT_REFERENCE_NOT_BOUND"
            : "EMPTY_STRUCTURE_LEAF",
        // Staff assignment references and authoring question owners are distinct.
        // No question group identity is inferred from this versioned reference.
        staffAssignmentId:
          sourceContentType === "staffGraded"
            ? reference("assignmentId")
            : null,
        supplementAssetId:
          sourceContentType === "supplement" ? reference("assetId") : null,
        supplementAssetType:
          sourceContentType === "supplement"
            ? reference("assetTypeName")
            : null,
      });
    }
    active.delete(entry);
  }
  for (const entry of root.material.elements) visit(entry, [], 1);
  if (!inventory.length) fail("MATERIAL_INVENTORY_EMPTY");
  const metadata = object(root.conflictMetadata) ? root.conflictMetadata : {};
  const version = (key: string): number | null =>
    Number.isSafeInteger(metadata[key]) && metadata[key] >= 0
      ? metadata[key]
      : null;
  const contentItems = inventory.filter((item) => item.contentBearing);
  const contentItemCount = contentItems.length;
  const contentTypeCounts: Record<string, number> = Object.create(null);
  for (const item of contentItems)
    contentTypeCounts[item.sourceContentType] =
      (contentTypeCounts[item.sourceContentType] || 0) + 1;
  return {
    courseId: expectedCourseId,
    materialVersion: version("version"),
    courseBranchVersion: version("courseBranchVersion"),
    inventoryCount: inventory.length,
    structuralLeafCount: inventory.length,
    contentItemCount,
    emptyStructuralLeafCount: inventory.length - contentItemCount,
    contentTypeCounts,
    boundAtomReferenceCount: inventory.filter((item) => item.atomReferenceBound)
      .length,
    inventory,
    contentItems,
    wholeCourseVerified: false,
  };
}

export interface CourseraBoundAtomSchemaRequest {
  resource: "authoringItemContentRelations.v1" | "authoringAtoms.v2";
  requestPath: string;
  sourceBinding: {
    courseId: string;
    itemId: string;
    atomId: string;
    sourceContentId: string;
    sourceContentType: string;
    staffAssignmentId: string | null;
    materialVersion: number | null;
    courseBranchVersion: number | null;
    requestScope: "EXPLICIT_MATERIAL_ATOM_REFERENCE_SCHEMA_SAMPLE";
    identitySemantics: "REQUEST_BOUND_TO_DECLARED_ATOM_RESPONSE_MODEL_NOT_CERTIFIED";
    assessmentRootCertified: false;
  };
}

/** A bounded schema sample, not a full-course acquisition queue.
 * Only two known resource families are emitted, for at most one current
 * staffGraded item and one supplement in the material's declared order. */
export function planCourseraCourseRelationSample(
  relations: CourseraCourseMaterialsRelations,
  currentItemId?: string,
): CourseraBoundAtomSchemaRequest[] {
  if (
    !relations ||
    relations.wholeCourseVerified !== false ||
    !Array.isArray(relations.inventory) ||
    relations.inventory.length !== relations.inventoryCount ||
    relations.inventoryCount > 20000
  )
    throw new Error("INVALID_PARSED_MATERIAL_RELATIONS");
  const requests: CourseraBoundAtomSchemaRequest[] = [];
  for (const type of ["staffGraded", "supplement"]) {
    const candidates = relations.inventory.filter(
      (item) =>
        item.sourceContentType === type &&
        item.atomReferenceBound &&
        typeof item.atomId === "string" &&
        /^[A-Za-z0-9_-]{22}$/.test(item.atomId) &&
        item.sourceContentId === "atom~" + item.atomId,
    );
    const selected =
      candidates.find((item) => item.itemId === currentItemId) || candidates[0];
    if (!selected || !selected.atomId || !selected.sourceContentId) continue;
    for (const resource of [
      "authoringItemContentRelations.v1",
      "authoringAtoms.v2",
    ] as const)
      requests.push({
        resource,
        requestPath:
          "/api/" + resource + "/" + encodeURIComponent(selected.atomId),
        sourceBinding: {
          courseId: relations.courseId,
          itemId: selected.itemId,
          atomId: selected.atomId,
          sourceContentId: selected.sourceContentId,
          sourceContentType: selected.sourceContentType,
          staffAssignmentId: selected.staffAssignmentId,
          materialVersion: relations.materialVersion,
          courseBranchVersion: relations.courseBranchVersion,
          requestScope: "EXPLICIT_MATERIAL_ATOM_REFERENCE_SCHEMA_SAMPLE",
          identitySemantics:
            "REQUEST_BOUND_TO_DECLARED_ATOM_RESPONSE_MODEL_NOT_CERTIFIED",
          assessmentRootCertified: false,
        },
      });
  }
  return requests;
}
