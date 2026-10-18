import { directCanonicalSourceTextV1 } from "./direct-data-canonical.js";

export const CTI_DIRECT_MATERIAL_STABILITY_POLICY_V1 =
  "NATIVE_ASSIGNMENT_FEATURE_FLAGS_V1";

/** A separate comparison model, never a replacement for a retained native
 * response or its hash. Only the three observed boolean feature flags on a
 * native assignment item have set semantics. Every other array, including
 * unknown feature models, keeps its source order. */
export function directMaterialStabilityModelV1(root) {
  // The canonical reader rejects accessors, cycles and unsupported values and
  // supplies the same depth/node/byte bounds as the original source hash.
  const model = JSON.parse(directCanonicalSourceTextV1(root));
  const modules = model?.material?.elements;
  if (!Array.isArray(modules)) return model;
  for (const module of modules) {
    if (module?.content != null || !Array.isArray(module?.elements)) continue;
    for (const lesson of module.elements) {
      if (lesson?.content != null || !Array.isArray(lesson?.elements)) continue;
      for (const item of lesson.elements) {
        if (item?.content?.typeName !== "ungradedAssignment" ||
            (Array.isArray(item.elements) && item.elements.length)) continue;
        const definition = item.content.definition;
        if (!definition || typeof definition !== "object" ||
            Array.isArray(definition)) continue;
        const flags = definition.assignmentFeatures;
        if (!Array.isArray(flags) || flags.length > 3 ||
            flags.some((flag) => ![
              "LIMITED_SUBMISSIONS", "TAKE_LATEST_GRADE", "SHOW_GRADE_ON_RELEASE",
            ].includes(flag)) || new Set(flags).size !== flags.length) continue;
        definition.assignmentFeatures = flags.slice().sort();
      }
    }
  }
  return model;
}
