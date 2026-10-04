// Run retained regression assertions against the maintained engine. The archived
// shell supplies Google-only fixtures; every active engine function is replaced.
// Archive-only functions and old UI contracts still run here. Passing this
// hybrid suite does not prove application feature parity; audit:parity accounts
// for those omissions independently.
const fs=require('node:fs'), vm=require('node:vm'), path=require('node:path');
const root=path.resolve(__dirname,'../archive/apps-script');
const c=require('./legacy-reference.cjs');
const {createEngine}=require('../src/engine/index.js');
const xml=new Proxy({}, {get(_target,key){return c.XmlService?.[key];}});
const engine=createEngine({Utilities:c.Utilities, XmlService:xml});
// The archived stale-delivery test deliberately replaces its global source
// getter. Its delivery adapter exercises that seam; production delivery has its
// own ESM tests. All evidence decisions below use the current module functions.
const {ctiExtractorDelivery_, ...decisions}=engine;
Object.assign(c,decisions);
const originalRecoveryFixture=c.CTI_TEST_editorRecoveryFixture_;
c.CTI_TEST_editorRecoveryFixture_=function(sourceOverride){
 const fixture=originalRecoveryFixture(sourceOverride);
 const functions=require('./extractor-functions.cjs').extractorFunctions(sourceOverride || c.ctiCanonicalCourseraExtractorSource_());
 fixture.code=name=>{if(!functions.has(name))throw Error('Missing extractor function: '+name);return functions.get(name);};
 return fixture;
};
module.exports=c;
if(require.main===module){
 if(!fs.readFileSync(path.join(root,'Index.html')).equals(fs.readFileSync(path.join(root,'Index_COPYABLE.txt'))))throw Error('Copyable Index is stale');
 new vm.Script(c.ctiCanonicalCourseraExtractorSource_());
 const skip=new Set([
  'CTI_TEST_legacyWebLinkXml_','CTI_TEST_assignmentXml_','CTI_TEST_discussionXml_',
  'CTI_TEST_imsccSyntheticManifest_','CTI_TEST_imsccAdvancedMetrics_','CTI_TEST_imsccZScoreLexical_',
  'CTI_TEST_imsccInvalidRoot_','CTI_TEST_imsccMalformedInputs_','CTI_TEST_imsccDepthLimit_',
  // These frozen tests assert the retired v6.14.7/schema-34 delivery contract
  // or its 24k/24-minute limits. v6.15.4 replacements live in native Node tests;
  // the archive remains immutable and must not be edited to make current code pass.
  'CTI_TEST_assignmentTextBlocks_','CTI_TEST_answerOnlyBoundaries_',
  'CTI_TEST_captureInputReadiness_','CTI_TEST_extractorDeliveryIntegrity_',
  'CTI_TEST_courseraCanonicalExtractor_','CTI_TEST_courseraSearchableFilename_',
  'CTI_TEST_semanticQaUiContract_','CTI_TEST_courseraV68CoverageUiContract_',
  // The frozen release identity predates the reviewed corpus QA corrections.
  // tests/current-release.test.mjs asserts all maintained identities explicitly.
  'CTI_TEST_releaseIdentityContract_'
 ]);
 const reports=[];
 for(const kind of ['fast','sourceContract']){const cases=c['CTI_TEST_'+kind+'Cases_']();const result=c.CTI_TEST_runSuite_(kind,cases.filter(e=>!skip.has(e[1].name)));reports.push({suite:kind,passed:result.passed,failed:result.failed,failures:result.tests.filter(t=>t.status==='FAIL'),skipped:cases.filter(e=>skip.has(e[1].name)).map(e=>e[0])});}
 const result={status:reports.some(r=>r.failed)?'FAIL':'PASS',reports,integration:'NOT_RUN_REQUIRES_GOOGLE_SERVICES',fullGolden:'NOT_RUN_REQUIRES_GOOGLE_SERVICES'};console.log(JSON.stringify(result,null,2));if(result.status!=='PASS')process.exitCode=1;
}
