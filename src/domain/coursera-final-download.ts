import type { CourseraExtractionStatus } from "./coursera-background-extraction.ts";

const key = (id: string) => "cti-coursera-final-download:" + id;

export function queueCourseraFinalDownload(storage: Storage, id: string) {
  storage.setItem(key(id), "pending");
}

// Keep only download intent in browser storage, never course content or SSO.
// A failed fetch leaves the intent pending so reopening CTI can retry it.
export async function requestCourseraFinalDownload(
  status: CourseraExtractionStatus,
  storage: Storage,
  fetchFile: () => Promise<File>,
  saveFile: (file: File) => void,
): Promise<boolean> {
  if (
    !["COMPLETE", "INCOMPLETE", "FAILED"].includes(status.state) ||
    !status.artifactAvailable ||
    storage.getItem(key(status.id)) !== "pending"
  )
    return false;
  const file = await fetchFile();
  // A different mounted view may already have handled this intent.
  if (storage.getItem(key(status.id)) !== "pending") return false;
  saveFile(file);
  storage.setItem(key(status.id), "requested");
  return true;
}
