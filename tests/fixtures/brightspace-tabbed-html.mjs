export const BRIGHTSPACE_TABBED_SOURCE_URL =
  "https://source.example.test/content/guide.html?version=2";
export const BRIGHTSPACE_TABBED_HTML = `<!DOCTYPE html><html><head>
<base href="https://untrusted-base.example.test/replaced/"/>
<script>globalThis.__ctiSourceScriptRan = true;</script>
<style>.tab-pane {display:none}</style></head><body>
<div class="d2l-element" data-type="horizontal">
<div class="instruction">Choose a tab &amp; inspect its source content.</div>
<div class="tabs-wrapper tabs-horizontal">
<div class="list-group"><a class="list-group-item active"><span data-itemprop="0|0">Introduction &amp; purpose</span></a>
<a class="list-group-item"><span data-itemprop="1|0">Hidden source panel</span></a></div>
<div class="tab-content"><div class="tab-pane active show" data-itemprop="0|1"><h2>First source section</h2><p>Visible authored prose.</p></div>
<div class="tab-pane" hidden="hidden" data-itemprop="1|1"><p>Hidden authored prose &amp; symbols.</p>
<table><caption>Authored dimensions</caption><thead><tr><th rowspan="2">Type</th><th colspan="2">Value</th></tr></thead>
<tbody><tr><td></td><td>42</td><td>mm</td></tr></tbody></table>
<iframe src="/d2l/common/dialogs/quickLink/quickLink.d2l?type=lti&amp;rCode=synthetic" title="Named synthetic activity"></iframe>
<img src="drawing.png?version=3" alt=""/><img src="other.png"/>
<script>inventedRuntimeContent()</script></div></div></div></div>
<div class="d2l-element" data-type="horizontal"><div class="tabs-wrapper tabs-horizontal">
<div class="list-group"><a class="list-group-item"><span data-itemprop="0|0">Second widget label</span></a></div>
<div class="tab-content"><div class="tab-pane" data-itemprop="0|1"><p>Second widget source prose.</p></div></div>
</div></div></body></html>`;
