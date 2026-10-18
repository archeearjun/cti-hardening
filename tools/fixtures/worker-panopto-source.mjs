import { panoptoDeliveryFixture } from "../../tests/panopto-delivery-fixtures.mjs";

export const metadataPath = "/Panopto/Pages/Viewer/DeliveryInfo.aspx";
export const mediaOrigin = "https://d2y36twrtb17ty.cloudfront.net";
export const stateUrl = "https://fixture-control.invalid/state";
export const expectedForm = "deliveryId=00000001-0000-4000-8000-000000000001&isLiveNotes=false&refreshAuthCookie=false&isActiveBroadcast=false&isEditing=false&isKollectiveAgentInstalled=false&isEmbed=true&responseType=json";
export const mediaBytes = Uint8Array.from([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0, 0, 0, 83, 121, 110, 116, 104, 101, 116, 105, 99]);
export const publicHtmlOrigin = "https://opentextbc.ca";
export const publicHtmlPath = "/cti-workerd-fixture/chapter/";
export const publicHtmlRaw = '\ufeff<!doctype html>\n<html lang="en"><head><title>Original public fixture</title></head><body><main><h1>Observed café 日本語</h1><p>Keep the original markup &amp; authored wording.</p><script>globalThis.__CTI_PUBLIC_HTML_EXECUTED__ = true;</script></main></body></html>\n';
export const publicHtmlBytes = new TextEncoder().encode(publicHtmlRaw);
export function publicHtmlUrl(name) { return publicHtmlOrigin + publicHtmlPath + name + "/"; }

export function source(host = "success.hosted.panopto.com") {
  const fixture = panoptoDeliveryFixture();
  fixture.targetUrl = fixture.targetUrl.replace("video.example.test", host);
  fixture.model.EmbedUrl = fixture.model.EmbedUrl.replace("video.example.test", host);
  fixture.model.Delivery.SessionName += " café 日本語";
  fixture.model.Delivery.PodcastStreams[0].StreamUrl = mediaOrigin + "/cti-workerd-fixture/" + host + "/podcast.mp4";
  return { ...fixture, raw: " \n" + JSON.stringify(fixture.model) + "\n" };
}
