export interface PackageProgress {
  phase: string;
  detail?: string;
  file?: string;
  completed?: number;
  total?: number;
}
export interface PackageFileEvidence {
  name?: string;
  path?: string;
  href?: string;
  sha256?: string;
  presentInPackage?: boolean | null;
  hashStatus?: string;
  readError?: string;
  pdfParser?: string;
  pdfReadError?: string;
  pathResolutionAmbiguous?: boolean;
}
export interface PackageResourceEvidence {
  files: PackageFileEvidence[];
  textSample?: string;
  evidenceTruncated?: boolean;
  structuredAssessment?: { questionCount: number; questions: unknown[] } | null;
  [key: string]: unknown;
}
export interface PackageNode {
  title: string;
  type: string;
  idref: string | null;
  children: PackageNode[];
  autoDeleted?: boolean;
  sourcePayload?: PackageResourceEvidence | null;
}
export interface PackageScan {
  kind: "CTI_PACKAGE_SCAN";
  schemaVersion: 1;
  fileName: string;
  scannedAt: string;
  fileSha256: string;
  scope: string;
  moduleCount: number;
  courseTree: PackageNode[];
  stats: Record<string, number | string | boolean | unknown[]>;
  unknownTypesLog: Record<string, number>;
  fileExtensionsLog: Record<string, number>;
  sourceEvidence: {
    manifestOnly: boolean;
    resources: Record<string, PackageResourceEvidence>;
    qtiDiagnostics?: { unresolvedQtiResources: string[] };
    [key: string]: unknown;
  };
  warnings: string[];
}
export type PackageMessage =
  | { kind: "package-ready" }
  | { kind: "package-progress"; progress: PackageProgress }
  | { kind: "package-result"; result: PackageScan }
  | { kind: "package-error"; message: string };
