import { workspaceRequest } from "./workspace-http.ts";
import type { CourseraExtractionStatus } from "./coursera-background-extraction.ts";

export interface CourseraConnectionSummary {
  connected: boolean;
  connectedAt: string;
  verifiedCourseId: string;
}

export async function courseraConnection(
  signal?: AbortSignal,
): Promise<CourseraConnectionSummary> {
  return workspaceRequest(
    "extraction/session",
    {},
    { signal, context: "Checking Coursera connection" },
  );
}

export async function startCourseraConnection(
  url: string,
  signal?: AbortSignal,
): Promise<CourseraExtractionStatus> {
  const data = await workspaceRequest(
    "extraction/connections",
    { method: "POST", body: JSON.stringify({ url }) },
    { signal, context: "Starting secure Coursera connection" },
  );
  return data.status;
}

export async function readCourseraConnectionJob(
  id: string,
  signal?: AbortSignal,
): Promise<CourseraExtractionStatus> {
  const data = await workspaceRequest(
    "extraction/connections/" + encodeURIComponent(id),
    {},
    { signal, context: "Checking Coursera sign-in" },
  );
  return data.status;
}

export async function disconnectCoursera(
  signal?: AbortSignal,
): Promise<CourseraConnectionSummary> {
  return workspaceRequest(
    "extraction/session",
    { method: "DELETE" },
    { signal, context: "Disconnecting Coursera" },
  );
}

export async function recentCourseraExtractions(
  signal?: AbortSignal,
): Promise<CourseraExtractionStatus[]> {
  const data = await workspaceRequest(
    "extraction/jobs",
    {},
    { signal, context: "Loading recent Coursera extractions" },
  );
  return Array.isArray(data.statuses) ? data.statuses : [];
}

export async function startCourseraExtraction(
  url: string,
  signal?: AbortSignal,
): Promise<CourseraExtractionStatus> {
  const data = await workspaceRequest(
    "extraction/jobs",
    { method: "POST", body: JSON.stringify({ url }) },
    { signal, context: "Starting background Coursera extraction" },
  );
  return data.status;
}

export async function readCourseraExtractionJob(
  id: string,
  signal?: AbortSignal,
): Promise<CourseraExtractionStatus> {
  const data = await workspaceRequest(
    "extraction/jobs/" + encodeURIComponent(id),
    {},
    { signal, context: "Checking background Coursera extraction" },
  );
  return data.status;
}

export async function courseraCaptureFile(
  status: CourseraExtractionStatus,
  signal?: AbortSignal,
): Promise<File> {
  if (!status.artifactAvailable)
    throw new Error("The background capture is not available yet.");
  const timeout = AbortSignal.timeout(90_000);
  const response = await fetch(
    "/api/extraction/jobs/" + encodeURIComponent(status.id) + "/artifact",
    {
      credentials: "same-origin",
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    },
  );
  if (!response.ok || response.redirected)
    throw new Error(
      `Downloading Coursera capture: HTTP ${response.status}. Reopen the team site and retry.`,
    );
  const blob = await response.blob();
  if (!blob.size) throw new Error("The saved Coursera capture is empty.");
  const disposition = response.headers.get("content-disposition") || "";
  const match = disposition.match(/filename="([^"]+)"/i);
  const name =
    match?.[1] ||
    status.artifactName ||
    `CTI__COURSERA__${status.courseId}__${status.id}.json`;
  return new File([blob], name, { type: "application/json" });
}

export function courseraCaptureDownloadUrl(id: string) {
  return "/api/extraction/jobs/" + encodeURIComponent(id) + "/artifact";
}
