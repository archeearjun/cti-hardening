// Optional public-provider integration probe. No LMS credentials or private
// course data; failures are reported as unverified, never converted into counts.
import { fetchSourceQuestions } from "../server/source-questions.ts";
const urls = [
  "https://opentextbc.ca/mathfortrades1/?p=225/#main",
  "https://opentextbc.ca/mathfortrades1/?p=197/#main",
  "https://opentextbc.ca/mathfortrades2/?p=93/#main",
];
for (const url of urls) {
  try {
    const c = await fetchSourceQuestions("public-provider-probe", url);
    console.log(
      JSON.stringify({
        url,
        status: c.status,
        count: c.bank?.count ?? null,
        library: c.bank?.library,
        selectedPerAttempt: c.bank?.selectedPerAttempt,
        documents: c.documents,
        reason: c.reason,
      }),
    );
  } catch (e) {
    console.log(
      JSON.stringify({ url, status: "UNVERIFIED", reason: e.message }),
    );
  }
}
