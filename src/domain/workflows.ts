import { createEngine } from "../engine/index.js";
import { createBrowserServices } from "../adapters/browser-services.ts";
import {
  readWorkbook,
  workbookAdapter,
  type BookData,
} from "../adapters/workbook.ts";
import { buildPostQaText_ } from "../reporting/owner-report.js";
import { buildOwnerContext } from "./owner-actions.ts";
import { packageRecordIdentity } from "./package-identity.ts";
import type {
  ComparisonInput,
  ComparisonOutput,
  EvidenceObject,
  WorkflowJob,
  WorkspaceRecord,
} from "./workspace-types.ts";

export function createWorkflows(xmlService: unknown) {
  // Full evidence result objects cross this boundary intact, including fields
  // not yet represented by a dedicated TypeScript interface.
  const services = createBrowserServices();
  const engine: EvidenceObject = createEngine({
    ...services,
    XmlService: xmlService,
  });
  function generationContext(
    history: WorkspaceRecord[],
    packageId: string,
    generation: number,
  ) {
    const rows = history
      .filter(
        (r) =>
          r.kind === "audit" &&
          r.packageId === packageId &&
          r.data.generation === generation,
      )
      .sort(
        (a, b) =>
          String(a.data.capturedAt || a.updatedAt).localeCompare(
            String(b.data.capturedAt || b.updatedAt),
          ) || a.id.localeCompare(b.id),
      );
    const context: EvidenceObject = {
      generation,
      provenanceIntelligence: null,
      provenanceSourceRunId: "",
      rawBaselineRunId: "",
      rawBaselineItems: [],
      rawBaselinePolicy: "FIRST_VALID_RAW_IMMUTABLE",
      rawBaselineCandidateCount: 0,
      latestSameGenerationRunId: rows.at(-1)?.id || "",
      latestNonRawRunId: "",
      latestNonRawStage: "",
      source: "NONE",
      correctedAggregateStageRunIds: [],
    };
    for (const row of [...rows].reverse()) {
      const intel =
        row.data.result?.ingestionIntelligence ||
        row.data.result?.rawSnapshot?.ingestionIntelligence ||
        row.data.result?.currentSnapshot?.ingestionIntelligence;
      if (intel?.claims?.length) {
        context.provenanceIntelligence =
          engine.qaCompactIngestionIntelligence_(intel);
        context.provenanceSourceRunId = row.id;
        break;
      }
    }
    const isRaw = (r: WorkspaceRecord) =>
      r.data.result?.snapshotContext?.mode === "RAW_INGESTION" ||
      r.data.legacyRunMetadata?.Mode === "SINGLE_C0" ||
      r.data.legacyRunMetadata?.["Snapshot Stage"] === "RAW_UNPUBLISHED";
    const raw = rows.filter(isRaw);
    context.rawBaselineCandidateCount = raw.length;
    const rawItems = (r: WorkspaceRecord) =>
      r.data.result?.itemResults ||
      r.data.result?.rawSnapshot?.itemResults ||
      [];
    const first = raw.find((r) => rawItems(r).length);
    if (first) {
      context.rawBaselineRunId = first.id;
      context.rawBaselineItems = rawItems(first);
      context.rawBaselineEvidence = {
        excelSha256: first.data.hashes?.excel,
        jsonSha256: first.data.hashes?.json,
        hasReadingRecovery: !!(
          first.data.hashes?.recovery ||
          first.data.result?.stats?.extractorMeta
            ?.supplementalReadingRecovery ||
          first.data.result?.rawSnapshot?.stats?.extractorMeta
            ?.supplementalReadingRecovery
        ),
      };
    }
    for (const row of rows.filter((r) => !isRaw(r))) {
      if (
        engine.qaObsoleteAggregateStageGuard_(
          row.data.result,
          context.rawBaselineItems,
          !!context.latestNonRawRunId,
        )
      ) {
        context.correctedAggregateStageRunIds.push(row.id);
        continue;
      }
      context.latestNonRawRunId = row.id;
      context.latestNonRawStage =
        row.data.result?.snapshotContext?.mode ||
        row.data.legacyRunMetadata?.["Snapshot Stage"] ||
        "";
    }
    context.source =
      context.rawBaselineRunId || context.provenanceSourceRunId
        ? "QA_EVIDENCE_MEMORY"
        : "NONE";
    return context;
  }
  function ioFor(book?: BookData) {
    const books = new Map<string, BookData>();
    const registered = new Set<string>();
    if (book) {
      books.set("local-master", structuredClone(book));
      registered.add("local-master");
    }
    return {
      books,
      openWorkbook(id: string) {
        const b = books.get(id);
        if (!b) throw new Error("Workbook is not part of this workflow.");
        return workbookAdapter(b);
      },
      importWorkbook(blob: { getBytes: () => number[] }, name: string) {
        const id = crypto.randomUUID();
        books.set(id, readWorkbook(Uint8Array.from(blob.getBytes()), name));
        return { id };
      },
      validateWorkbook(id: string) {
        if (!registered.has(id))
          throw new Error("Select the registered master workbook first.");
      },
      registerWorkbook(id: string) {
        if (!books.has(id)) throw new Error("Unknown workbook.");
        registered.add(id);
      },
      getTemporaryFile(id: string) {
        return {
          setTrashed(value: boolean) {
            if (value) books.delete(id);
          },
        };
      },
      loadPackage(_id: string): EvidenceObject {
        throw new Error("Source package was not supplied.");
      },
      loadGeneration(_id: string, _lineage: unknown): EvidenceObject {
        throw new Error("Generation context was not supplied.");
      },
      externalRuntime(_meta: unknown): EvidenceObject {
        return {
          checked: false,
          required: false,
          source: "",
          warning: "External runtime inventory has not been imported.",
        };
      },
      persistRun() {
        throw new Error("Save reports through the workspace after comparison.");
      },
    };
  }
  const base64 = (bytes?: Uint8Array) =>
    bytes ? services.Utilities.base64Encode(bytes) : "";
  const hash = (bytes?: Uint8Array) =>
    bytes
      ? services.Utilities.computeDigest("SHA_256", bytes)
          .map((n) => (n & 255).toString(16).padStart(2, "0"))
          .join("")
      : "";
  function compare(input: ComparisonInput): ComparisonOutput {
    if (input.course.kind !== "package" || !input.course.data.scan?.courseTree)
      throw new Error("Choose a scanned source package.");
    if (
      !Number.isInteger(input.generation) ||
      input.generation < 0 ||
      input.generation > 99
    )
      throw new Error(
        "Ingestion generation must be a whole number from 0 (original import) through 99.",
      );
    const io = ioFor();
    const course = input.course.data;
    io.loadPackage = () => ({
      success: true,
      tree: structuredClone(course.scan.courseTree),
      packageMeta: {
        partner: course.partner,
        fileName: course.scan.fileName,
        owner: course.owner,
        status: course.status,
      },
    });
    io.loadGeneration = () =>
      generationContext(input.history, input.course.id, input.generation);
    if (course.externalRuntimeEvidence)
      io.externalRuntime = () =>
        structuredClone(course.externalRuntimeEvidence);
    const result = engine.runPostIngestionQaCore_(
      base64(input.excel.bytes),
      input.excel.name,
      base64(input.json?.bytes),
      input.json?.name || "",
      input.course.id,
      input.mode,
      false,
      {
        generation: input.generation,
        ingestionCapabilityStatus: input.ingestionCapabilityStatus || "UNKNOWN",
      },
      base64(input.brightspace?.bytes),
      input.brightspace?.name || "",
      base64(input.recovery?.bytes),
      input.recovery?.name || "",
      io,
    );
    if (!result.success) throw new Error(result.error || "Comparison failed.");
    const warnings = [];
    if (!course.externalRuntimeEvidence)
      warnings.push(
        "The external SCORM/Rise inventory is not loaded for this course. Source-package and Brightspace runtime evidence are still evaluated.",
      );
    result.workspaceWarnings = warnings;
    return {
      result,
      ownerContext: buildOwnerContext(
        input.brightspace?.bytes,
        result.liveSourceGroundTruth?.sourceTopicMappings || [],
      ),
      report:
        (warnings.length
          ? "WORKSPACE EVIDENCE NOTE\n" + warnings.join("\n") + "\n\n"
          : "") + buildPostQaText_(result),
      hashes: {
        excel: hash(input.excel.bytes),
        json: hash(input.json?.bytes),
        brightspace: hash(input.brightspace?.bytes),
        recovery: hash(input.recovery?.bytes),
      },
      generation: input.generation,
      ingestionCapabilityStatus: input.ingestionCapabilityStatus || "UNKNOWN",
      packageId: input.course.id,
      sourceScanSha256: course.scan.fileSha256 || "",
    };
  }
  function execute(job: WorkflowJob): EvidenceObject {
    if (job.kind === "compare") return compare(job.input);
    if (job.kind === "lifecycle") {
      if (
        job.before.packageId !== job.after.packageId ||
        job.before.id === job.after.id
      )
        throw new Error(
          "Select two different reports for the same source course.",
        );
      if (!job.before.data.result?.success || !job.after.data.result?.success)
        throw new Error(
          "Both snapshots must contain successful full comparisons.",
        );
      if (
        job.before.data.sourceScanSha256 &&
        job.after.data.sourceScanSha256 &&
        job.before.data.sourceScanSha256 !== job.after.data.sourceScanSha256
      )
        throw new Error(
          "The source package hashes differ. These snapshots cannot establish changes against the same source.",
        );
      const before =
        job.before.data.result.currentSnapshot || job.before.data.result;
      const after =
        job.after.data.result.currentSnapshot || job.after.data.result;
      // These checks lived in the Apps Script entry point, outside the pure
      // lifecycle engine. Saved reports need the same evidence boundary.
      for (const [label, snapshot] of [
        ["Before", before],
        ["After", after],
      ] as const) {
        if (!Array.isArray(snapshot.itemResults))
          throw new Error(`${label} report is missing its full item evidence.`);
        if (snapshot.inputCoherence?.status === "FAIL")
          throw new Error(
            `${label} snapshot files are incoherent: ${snapshot.inputCoherence.reason || "the saved XLSX and JSON do not describe a coherent snapshot"}.`,
          );
      }
      const sameAttempt =
        job.before.data.generation >= 0 &&
        job.before.data.generation === job.after.data.generation;
      const rawToCurrent =
        sameAttempt &&
        before.snapshotContext?.mode === "RAW_INGESTION" &&
        after.snapshotContext?.mode !== "RAW_INGESTION";
      if (
        rawToCurrent &&
        (!job.before.data.hashes?.json || !job.after.data.hashes?.json)
      )
        throw new Error(
          "Raw-to-current lifecycle attribution requires the full capture JSON for both snapshots, alongside their authoritative XLSX exports. Re-run the incomplete comparison with both files.",
        );
      const scope = rawToCurrent
        ? "SAME_ATTEMPT_RAW_TO_CURRENT"
        : sameAttempt
          ? "SAME_ATTEMPT_OBSERVATIONS"
          : "CROSS_ATTEMPT_OBSERVATIONS";
      let delta;
      if (rawToCurrent)
        delta = engine.qaCompareLifecycleSnapshots_(before, after);
      else {
        // The old lifecycle engine assumes C0 raw -> C1 manual. Re-ingestion
        // comparisons must not inherit that causal assumption or prior exclusions.
        const key = (item: EvidenceObject) =>
          item.sourceId ||
          JSON.stringify([item.sourcePath, item.sourceName, item.sourceType]);
        const left = new Map<string, EvidenceObject>(
          (before.itemResults || []).map((i: EvidenceObject) => [key(i), i]),
        );
        const right = new Map<string, EvidenceObject>(
          (after.itemResults || []).map((i: EvidenceObject) => [key(i), i]),
        );
        const items = [...new Set([...left.keys(), ...right.keys()])].map(
          (id) => {
            const a = left.get(id),
              b = right.get(id);
            const checks = {
              before: a?.checks || null,
              after: b?.checks || null,
            };
            return {
              sourceId: id,
              sourceName: b?.sourceName || a?.sourceName,
              beforeVerdict: a?.verdict || "NOT_IN_SNAPSHOT",
              afterVerdict: b?.verdict || "NOT_IN_SNAPSHOT",
              beforeFidelity: a?.fidelityPercent ?? null,
              afterFidelity: b?.fidelityPercent ?? null,
              changed:
                JSON.stringify([
                  a?.verdict,
                  a?.courseraType,
                  a?.courseraPath,
                  a?.checks,
                ]) !==
                JSON.stringify([
                  b?.verdict,
                  b?.courseraType,
                  b?.courseraPath,
                  b?.checks,
                ]),
              checks,
              currentOwnerAction: b?.ownerAction || null,
            };
          },
        );
        delta = {
          summary: {
            items: items.length,
            changed: items.filter((i) => i.changed).length,
            unchanged: items.filter((i) => !i.changed).length,
          },
          items,
        };
      }
      return {
        success: true,
        lifecycleSummary: delta.summary,
        lifecycleItems: delta.items,
        comparisonScope: scope,
        note: "Differences describe observed snapshots. Across ingestion attempts, prior intentional exclusions and manual-change attribution are not carried forward.",
        sourceIdentity:
          job.before.data.sourceScanSha256 && job.after.data.sourceScanSha256
            ? "MATCHING_PACKAGE_HASH"
            : "PACKAGE_ID_ONLY_SOURCE_HASH_UNAVAILABLE",
        beforeRunId: job.before.id,
        afterRunId: job.after.id,
        beforeGeneration: job.before.data.generation,
        afterGeneration: job.after.data.generation,
        rawSnapshot: engine.qaLifecycleSnapshotView_(before),
        currentSnapshot: engine.qaLifecycleSnapshotView_(after),
      };
    }

    if (job.kind === "analytics") {
      const courses = job.records.filter(
        (r) => r.kind === "package" && r.data.archived !== true,
      );
      const profiles = courses.map((record) => {
        const s = record.data.scan.stats;
        return {
          id: record.id,
          title: record.title,
          partner: record.data.partner,
          owner: record.data.owner,
          status: record.data.status,
          identityKey: packageRecordIdentity(record),
          stats: s,
          vector: engine.vectorizeCourse({
            ...s,
            quizzes: Number(s.quizzes || 0) + Number(s.assignments || 0),
            empty: s.emptyFolders,
          }),
          estimatedHours: engine.predictLaborHours(
            s.ifs,
            s.totalItems,
            s.lti,
            s.emptyFolders,
          ),
        };
      });
      const aggregate = (field: "partner" | "owner") => {
        const groups = new Map<string, any>();
        for (const profile of profiles) {
          const name = String(profile[field] || "Unassigned").trim() || "Unassigned";
          const current = groups.get(name) || {
            name,
            courses: 0,
            totalItems: 0,
            totalIfs: 0,
            estimatedHours: 0,
            statuses: {} as Record<string, number>,
          };
          current.courses++;
          current.totalItems += Number(profile.stats.totalItems || 0);
          current.totalIfs += Number(profile.stats.ifs || 0);
          current.estimatedHours += Number(profile.estimatedHours || 0);
          const status = String(profile.status || "Not set");
          current.statuses[status] = Number(current.statuses[status] || 0) + 1;
          groups.set(name, current);
        }
        return [...groups.values()].sort(
          (a, b) => b.courses - a.courses || a.name.localeCompare(b.name),
        );
      };
      const identityGroups = new Map<string, typeof profiles>();
      for (const profile of profiles) {
        if (!profile.identityKey) continue;
        const group = identityGroups.get(profile.identityKey) || [];
        group.push(profile);
        identityGroups.set(profile.identityKey, group);
      }
      const duplicates = [...identityGroups.entries()]
        .filter(([, group]) => group.length > 1)
        .map(([identityKey, group]) => ({
          identityKey,
          courses: group.map((profile) => ({
            id: profile.id,
            title: profile.title,
            partner: profile.partner,
          })),
        }));
      return {
        profiles,
        partnerTotals: aggregate("partner"),
        ownerTotals: aggregate("owner"),
        duplicates,
        similarities: profiles
          .flatMap((a, i) =>
            profiles.slice(i + 1).map((b) => ({
              left: a.id,
              right: b.id,
              leftTitle: a.title,
              rightTitle: b.title,
              similarity: engine.calculateCosineSimilarity(a.vector, b.vector),
            })),
          )
          .sort((a, b) => b.similarity - a.similarity)
          .slice(0, 100),
        note: "IFS, labor estimates, z-scores and vector similarity are deterministic review aids. They do not prove content loss or quality.",
      };
    }
    const io = ioFor(job.kind === "macmillan-scan" ? undefined : job.book);
    if (job.kind === "macmillan-scan") {
      const result = engine.uploadAndScanMasterCore_(
        base64(job.bytes),
        job.name,
        io,
      );
      if (!result.success) throw new Error(result.error);
      return { result, book: io.books.get(result.fileId) };
    }
    const result =
      job.kind === "macmillan-split"
        ? engine.executeDynamicNSplitAndScanCore_(
            "local-master",
            job.anchors,
            job.names,
            job.partner,
            job.approved,
            "macmillan",
            io,
          )
        : engine.qaCompareGptOutputCore_(
            base64(job.bytes),
            job.name,
            "local-master",
            job.stage,
            job.spec,
            io,
          );
    return { result, book: io.books.get("local-master") };
  }
  return { execute, compare, generationContext };
}
