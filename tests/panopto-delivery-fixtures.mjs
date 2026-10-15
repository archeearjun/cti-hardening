/** Synthetic delivery metadata only; no private course or player data. */
export function panoptoDeliveryFixture() {
  const ids = {
    A: "00000001-0000-4000-8000-000000000001",
    B: "00000002-0000-4000-8000-000000000002",
    C: "00000003-0000-4000-8000-000000000003",
    D: "00000004-0000-4000-8000-000000000004",
    E: "00000005-0000-4000-8000-000000000005",
    invocation: "00000006-0000-4000-8000-000000000006",
  };
  const targetUrl =
    "https://video.example.test/Panopto/Pages/Embed.aspx?id=" +
    ids.A +
    "&autoplay=false&captions=true";
  const spec = {
    auditId: "audit-panopto",
    courseId: "course-panopto",
    itemId: "item-panopto",
    name: "Synthetic player",
    url: "https://www.coursera.org/teach/synthetic-course/course-panopto/content/item/plugin/item-panopto",
    checks: [],
  };
  const mediaBase = "https://media.example.test/sessions/" + ids.C + "/";
  const streamBase = {
    StreamType: 1,
    StreamTypeName: "Archival",
    SourceMediaFileType: 3,
    RelativeStart: 0,
  };
  const model = {
    SessionId: ids.B,
    ViewerFileId: ids.D,
    Delivery: {
      PublicID: ids.A,
      SessionPublicID: ids.B,
      SessionFileId: ids.C,
      IsReferenceCopy: true,
      SessionName: "Synthetic &lt;video&gt; &amp; <markup> literal",
      Duration: 528.567,
      HasCaptions: false,
      AvailableCaptions: [],
      AvailableLanguages: [],
      Streams: [
        {
          ...streamBase,
          PublicID: ids.E,
          StreamFileId: ids.E,
          Name: "Synthetic viewer stream",
          ViewerMediaFileType: 11,
          ViewerMediaFileTypeName: "hls",
          RelativeEnd: 528.567,
          StreamUrl: mediaBase + "viewer/master.m3u8",
          StreamHttpUrl: mediaBase + "viewer/master.m3u8",
          Variants: [
            { Bandwidth: 657294, Url: mediaBase + "viewer/low/index.m3u8" },
            { Bandwidth: 1056894, Url: mediaBase + "viewer/medium/index.m3u8" },
            { Bandwidth: 1969832, Url: mediaBase + "viewer/high/index.m3u8" },
          ],
        },
      ],
      PodcastStreams: [
        {
          ...streamBase,
          PublicID: ids.D,
          StreamFileId: ids.D,
          Name: null,
          ViewerMediaFileType: 3,
          ViewerMediaFileTypeName: "mp4",
          RelativeEnd: 0,
          StreamUrl: mediaBase + "podcast.mp4",
          StreamHttpUrl: null,
          Variants: null,
        },
      ],
      Timestamps: Array.from({ length: 9 }, (_, index) => ({
        ID: index + 1,
        EventTargetType: "SmartOcrToc",
        Caption: "Synthetic section " + (index + 1) + " &lt;label&gt; &amp; <literal>",
        Time: index * 62,
        SessionID: ids.C,
      })),
      UnknownMetadata: "Synthetic unknown delivery text &lt;retain&gt; &amp; <literal>",
    },
    DownloadUrl: null,
    EmbedUrl: '<iframe src="' + targetUrl.replaceAll("&", "&amp;") + '"></iframe>',
    InvocationId: ids.invocation,
    UnknownMetadata: "Synthetic unknown root text &lt;retain&gt; &amp; <literal>",
  };
  return { model, responseText: JSON.stringify(model), spec, targetUrl, ids };
}
