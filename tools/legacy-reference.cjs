const fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto'),path=require('node:path');
const root=path.resolve(__dirname,'../archive/apps-script');
const c={console,URL,Logger:{log(){}},Utilities:{getUuid:()=>crypto.randomUUID(),base64Encode:x=>Buffer.from(x).toString('base64'),base64Decode:x=>[...Buffer.from(x,'base64')],newBlob:x=>({getBytes:()=>[...Buffer.from(x)],getDataAsString:()=>Buffer.from(x).toString()}),computeDigest:(alg,x)=>[...crypto.createHash('sha256').update(Buffer.from(x)).digest()],DigestAlgorithm:{SHA_256:'SHA_256'}}};
vm.createContext(c);vm.runInContext(fs.readFileSync(path.join(root,'Code.gs'),'utf8'),c);vm.runInContext(fs.readFileSync(path.join(root,'Tests.gs'),'utf8'),c);c.CTI_TEST_INDEX_SOURCE_CACHE_=fs.readFileSync(path.join(root,'Index.html'),'utf8');
module.exports=c;
if(require.main===module){
 if(!fs.readFileSync(path.join(root,'Index.html')).equals(fs.readFileSync(path.join(root,'Index_COPYABLE.txt'))))throw Error('Copyable Index is stale');
 new vm.Script(c.ctiCanonicalCourseraExtractorSource_());
 const skip=new Set(['CTI_TEST_legacyWebLinkXml_','CTI_TEST_assignmentXml_','CTI_TEST_discussionXml_','CTI_TEST_imsccSyntheticManifest_','CTI_TEST_imsccAdvancedMetrics_','CTI_TEST_imsccZScoreLexical_','CTI_TEST_imsccInvalidRoot_','CTI_TEST_imsccMalformedInputs_','CTI_TEST_imsccDepthLimit_']);
 const reports=[];
 for(const kind of ['fast','sourceContract']){const cases=c['CTI_TEST_'+kind+'Cases_']();const result=c.CTI_TEST_runSuite_(kind,cases.filter(e=>!skip.has(e[1].name)));reports.push({suite:kind,passed:result.passed,failed:result.failed,failures:result.tests.filter(t=>t.status==='FAIL'),skipped:cases.filter(e=>skip.has(e[1].name)).map(e=>e[0])});}
 const result={status:reports.some(r=>r.failed)?'FAIL':'PASS',reports,integration:'NOT_RUN_REQUIRES_GOOGLE_SERVICES',fullGolden:'NOT_RUN_REQUIRES_GOOGLE_SERVICES'};console.log(JSON.stringify(result,null,2));if(result.status!=='PASS')process.exitCode=1;
}
