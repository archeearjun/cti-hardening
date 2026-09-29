// Maintained source: explicit dependencies; no ordered concatenation.
import { brightspaceSource, courseraSource } from "../generated/extractor-sources.js";
import { CTI_RELEASE_REGISTRY_ } from "./release.js";

export function ctiExtractorDelivery_(platform) {
  platform = String(platform || '').trim().toLowerCase();
  if (platform !== 'brightspace' && platform !== 'coursera') return {success:false,error:'Unsupported extractor platform: ' + platform};
  var config=platform==='coursera'?CTI_RELEASE_REGISTRY_.courseraExtractor:CTI_RELEASE_REGISTRY_.brightspaceExtractor;
  var script=platform==='coursera'?ctiCanonicalCourseraExtractorSource_():ctiCanonicalBrightspaceExtractorSource_();
  if(script.indexOf(config.version)===-1 || script.indexOf(config.build)===-1) return {success:false,error:'The extractor source does not match its release label. Rebuild and deploy the application before copying.'};
  return {success:true,platform:platform.toUpperCase(),name:platform==='coursera'?'CTI Coursera Authoring Evidence Extractor':'CTI Source LMS Ground-Truth Extractor — Brightspace',version:config.version,schemaVersion:config.schema,buildId:config.build,delivery:config.delivery,gatewayRelease:CTI_RELEASE_REGISTRY_.gateway,script:script};
}







export function ctiCanonicalCourseraExtractorSource_() { return courseraSource; }

export function ctiCanonicalBrightspaceExtractorSource_() { return brightspaceSource; }
