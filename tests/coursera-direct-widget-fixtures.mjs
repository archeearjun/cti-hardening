import { createHash } from "node:crypto";
import { bindDirectAuthoringDraftV1 } from "../src/extractors/coursera/direct-data-models.js";
import { directCanonicalSourceTextV1 } from "../src/extractors/coursera/direct-data-canonical.js";
import {
  CTI_DIRECT_WIDGET_PROVIDER_FIELDS_V1,
  CTI_DIRECT_WIDGET_PROVIDER_INCLUDES_V1,
  directDraftWidgetProviderV1,
  directWidgetProviderSourceV1,
  directWidgetProviderTargetsV1,
} from "../src/extractors/coursera/direct-data-widget.js";

export const WIDGET_COURSE = "Synthetic_widget_course",
  WIDGET_SLUG = "synthetic-widget-course",
  WIDGET_PROVIDER = "p".repeat(22),
  WIDGET_ATOM = "a".repeat(22),
  WIDGET_VERSION = "v".repeat(22) + "@7";
export const widgetSourceHash = (value) => createHash("sha256")
  .update(directCanonicalSourceTextV1(value)).digest("hex");

/** Synthetic source proof only: no live account, provider, course or URL. */
export function widgetFixture({ itemId = "WidgetA", providerId = WIDGET_PROVIDER,
  atomId = WIDGET_ATOM,
  url = "https://video.example.test/embed?id=synthetic-video&autoplay=false&captions=true" } = {}) {
  const fp = {
    id: itemId, name: "Repeated widget title", type: "Plugin", typeName: "ungradedWidget",
    atomId, contentId: "atom~" + atomId, payload: {},
  };
  const atom = {
    id: atomId, contentId: fp.contentId, storedAtomVersion: 3,
    metadata: { updatedAt: 1_800_000_000_000 },
    status: { typeName: "draftAtomStatus", definition: {} },
    draft: { name: fp.name, content: { typeName: "widgetDraft", definition: {
      isGraded: false, providerId, iframeTitle: fp.name,
    } } },
  };
  const relation = { id: atomId, atomId, branchRelationMap: {
    [WIDGET_COURSE + "~" + itemId]: { courseId: WIDGET_COURSE, itemId, courseSlug: WIDGET_SLUG },
  } };
  const bound = bindDirectAuthoringDraftV1(fp, WIDGET_COURSE, WIDGET_SLUG,
    { elements: [atom] }, { elements: [relation] });
  const model = {
    elements: [{
      id: providerId, metadata: { createdAt: 1_700_000_000_000, updatedAt: 1_800_000_000_000 },
      isPublished: false, owners: ["USER~synthetic"],
      draft: { configuration: { url, autoplay: false, customSetting: "retained setting" },
        iframeTitle: fp.name, widgetVersionId: WIDGET_VERSION, pageSrc: url },
    }],
    paging: {},
    linked: { "authoringWidgetSummaries.v1": [{
      id: WIDGET_VERSION, pluginType: "CUSTOM_PLUGIN", gradingType: "UNGRADED",
      name: "External webpage", description: "Synthetic provider summary",
      configurationExamples: [{ name: "Format example", configuration: {
        url: "https://examples.example.test/not-this-widget?example=1",
      } }],
    }] },
  };
  const receipt = (resource, id) => ({
    resource, id, status: 200, bodyFormat: "PARSED_SANITIZED_JSON_MODEL",
    originalResponseSha256: "d".repeat(64),
    sha256: "d".repeat(64),
    requestPath: "/api/" + resource + "/" + id,
    observedAt: "2027-01-15T08:00:00.000Z",
  });
  fp.payload.directDataSources = {
    atom: { elements: [atom] }, relation: { elements: [relation] },
    receipts: {
      atom: receipt("authoringAtoms.v2", atomId),
      relation: receipt("authoringItemContentRelations.v1", atomId),
      stability: { stable: true, draftHash: widgetSourceHash(atom.draft),
        storedAtomVersion: atom.storedAtomVersion, updatedAt: atom.metadata.updatedAt,
        atom: { elements: [structuredClone(atom)] },
        receipt: receipt("authoringAtoms.v2", atomId) },
    },
  };
  const providerReceipt = {
    ...receipt("authoringWidgetSessionProviders.v1", providerId),
    requestPath: "/api/authoringWidgetSessionProviders.v1/",
    requestQuery: [["q", "getWithCourseId"], ["widgetSessionProviderId", providerId],
      ["courseId", WIDGET_COURSE], ["fields", CTI_DIRECT_WIDGET_PROVIDER_FIELDS_V1],
      ["includes", CTI_DIRECT_WIDGET_PROVIDER_INCLUDES_V1]],
  };
  const sourceHash = widgetSourceHash(directWidgetProviderSourceV1(bound, model));
  fp.payload.directWidgetProviderEvidence = {
    method: "BOUND_AUTHORING_WIDGET_PROVIDER", ...directDraftWidgetProviderV1(bound),
    initial: { model: structuredClone(model), receipt: structuredClone(providerReceipt), sourceHash },
    final: { model: structuredClone(model), receipt: structuredClone(providerReceipt), sourceHash },
    stableSource: true, targets: directWidgetProviderTargetsV1(bound, model),
    bodyVerified: false, playbackVerified: false, launchVerified: false, wholeWidgetVerified: false,
  };
  return { fp, atom, relation, bound, model, url, providerReceipt };
}
