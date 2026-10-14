import assert from 'node:assert/strict';
import fs from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createServer} from 'vite';
import {chromium} from 'playwright';

// The maintained React component emits the program tested below. The required
// CI execution is browser-initiated javascript: navigation. An explicit local
// flag permits a debugger-only reader test when native Chromium's known URL
// policy also blocks a tiny no-CSP canary. That test is not bookmark proof.
// Native bookmark installation and activation are separate acceptance checks;
// the local managed Chrome policy prevents certifying them here. These
// synthetic APIs establish browser mechanics, not Coursera's
// private full-course schema, throughput, completeness, or crash isolation.
const origin='https://www.coursera.org';
const courseId='Bookmark_fixture_123',secondId='Other_bookmark_fixture_456';
const fixturePath='/__cti_coursera_bookmark__.html';
const allowPolicyBlockedReaderCheck=process.env.CTI_ALLOW_BOOKMARK_POLICY_BLOCKED==='1';
const managedPolicyPath='/etc/chromium/policies/managed/urls.json';
let bookmarkSchemeBlockedByManagedPolicy=false;
try{
  const policy=JSON.parse(fs.readFileSync(managedPolicyPath,'utf8'));
  bookmarkSchemeBlockedByManagedPolicy=policy.URLBlocklist?.includes('*')===true&&
    !policy.URLAllowlist?.some(value=>value==='*'||/^javascript(?::|$)/i.test(value));
}catch{ /* Stock Chromium has no policy fixture at this path. */ }
const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'cti-bookmark-browser-'));
execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes',
  '-keyout',path.join(scratch,'key.pem'),'-out',path.join(scratch,'cert.pem'),
  '-subj','/CN=www.coursera.org','-days','1'],{stdio:'ignore'});
const requests=[],documentLoads=[],errors=[],browserMessages=[],atomBindings=new Map(),inFlight=new Map(),maxInFlight=new Map(),completedRoots=new Map();
const credentialMarkers=['fixture-http-only-cookie','fixture-write-access-secret',
  'fixture-nested-token-secret','fixture-serialized-token-secret','fixture-url-token-secret'];
const relation={format:'unrecognized-future-relation',assignment:'fixture-assignment',
  questionOrder:['fixture-q2','fixture-q1'],unsupportedKind:'fixture-custom-kind'};
function atomReference(id,kind){return(kind==='staffGraded'?'assess':'read__')+Buffer.from(id).toString('base64url').slice(0,16);}
function models(id){
  const assessmentAtom=atomReference(id,'staffGraded'),readingAtom=atomReference(id,'supplement');
  atomBindings.set(assessmentAtom,{courseId:id,itemId:'Assess01',sourceContentType:'staffGraded',staffAssignmentId:'staff-fixture@3'});
  atomBindings.set(readingAtom,{courseId:id,itemId:'Read01',sourceContentType:'supplement',staffAssignmentId:null});
  return {
    materials:{elements:[{id,courseId:id,conflictMetadata:{version:17,courseBranchVersion:23},material:{elements:[
      {id:'module-fixture',name:'Synthetic module',elements:[
        {id:'lesson-fixture',name:'Synthetic lesson',elements:[
          {id:'Assess01',name:'Synthetic assessment',atomId:assessmentAtom,contentId:'atom~'+assessmentAtom,
            content:{typeName:'staffGraded',definition:{assignmentId:'staff-fixture@3',opaqueRelation:relation}}},
          {id:'Read01',name:'Synthetic reading',atomId:readingAtom,contentId:'atom~'+readingAtom,
            content:{typeName:'supplement',definition:{assetId:'reading-asset-fixture',assetTypeName:'html',opaqueRelation:relation}}},
        ]},
      ]},
    ]},writeAccessToken:credentialMarkers[1],nested:{accessToken:credentialMarkers[2]},
    configuration:JSON.stringify({writeAccessToken:credentialMarkers[3],knownRelation:relation}),
    url:'https://example.test/content?item=fixture&accessToken='+credentialMarkers[4]}]},
    course:{elements:[{id,courseId:id,opaqueFutureRelation:relation}]},
  };
}
const server=https.createServer({key:fs.readFileSync(path.join(scratch,'key.pem')),
  cert:fs.readFileSync(path.join(scratch,'cert.pem'))},(request,response)=>{
  const url=new URL(request.url,origin);
  if(url.pathname==='/favicon.ico'){response.statusCode=204;response.end();return;}
  if(url.pathname.startsWith('/api/')){
    const match=url.pathname.match(/^\/api\/(authoringCourseMaterials\.v1|authoringCourses\.v2|authoringItemContentRelations\.v1|authoringAtoms\.v2)\/([^/]+)\/?$/);
    const resource=match?.[1],reference=match?decodeURIComponent(match[2]):null;
    const binding=atomBindings.get(reference),boundCourse=binding?.courseId||reference;
    const active=(inFlight.get(boundCourse)||0)+1;inFlight.set(boundCourse,active);
    maxInFlight.set(boundCourse,Math.max(maxInFlight.get(boundCourse)||0,active));
    let settled=false;
    const settle=()=>{
      if(settled)return;settled=true;inFlight.set(boundCourse,(inFlight.get(boundCourse)||1)-1);
      if(resource==='authoringCourseMaterials.v1'||resource==='authoringCourses.v2')
        completedRoots.set(boundCourse,(completedRoots.get(boundCourse)||0)+1);
    };
    response.on('finish',settle);response.on('close',settle);
    requests.push({path:url.pathname,search:url.search,method:request.method,
      authenticated:request.headers.cookie?.includes('fixtureSession='+credentialMarkers[0])===true,
      courseId:boundCourse,resource,completedRootResponses:completedRoots.get(boundCourse)||0});
    response.setHeader('Content-Type','application/json; charset=utf-8');
    if(!match){response.statusCode=404;response.end('{}');return;}
    const id=reference;
    if(id==='Forbidden_fixture_123'){response.statusCode=403;response.end('{"error":"fixture denied"}');return;}
    if(id==='Invalid_fixture_123'){response.end('{invalid synthetic JSON');return;}
    if(id==='Oversize_fixture_123'){
      // No Content-Length: the maintained reader must limit actual stream bytes.
      const body='{"padding":"'+'x'.repeat(2*1024*1024+65536)+'"}';let offset=0;
      const write=()=>{
        if(response.destroyed)return;
        if(offset>=body.length){response.end();return;}
        const chunk=body.slice(offset,offset+32768);offset+=chunk.length;
        if(response.write(chunk))setImmediate(write);else response.once('drain',write);
      };
      write();return;
    }
    let body;
    if(resource==='authoringCourseMaterials.v1')body=models(id).materials;
    else if(resource==='authoringCourses.v2')body=models(id).course;
    else{
      if(!binding){response.statusCode=404;response.end('{"error":"unknown fixture atom"}');return;}
      body={elements:[{id:reference,courseId:binding.courseId,unknownSchemaRelation:relation,
        ...(resource==='authoringAtoms.v2'?{content:{typeName:binding.sourceContentType,definition:{opaqueRelation:relation}}}:{}),
        nested:{writeAccessToken:credentialMarkers[1]}}]};
    }
    // A small fixture delay makes overlap observable, so the browser check can
    // enforce the maintained two-read ceiling rather than infer it from code.
    setTimeout(()=>{if(!response.destroyed)response.end(JSON.stringify(body));},20);
    return;
  }
  documentLoads.push({origin:request.headers.host,path:url.pathname});
  response.setHeader('Content-Type','text/html; charset=utf-8');
  response.setHeader('Set-Cookie','fixtureSession='+credentialMarkers[0]+'; HttpOnly; Secure; SameSite=Lax; Path=/');
  if(!url.searchParams.has('open'))response.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'nonce-fixture'; style-src 'self'; connect-src 'self'");
  const active=url.searchParams.has('active')?'window.__CTI_ITEM_FIDELITY_RUN_LOCK={running:true};':'';
  const frame=url.searchParams.has('frame')?`<iframe src="/teach/synthetic/${courseId}/content/edit?child=1"></iframe>`:'';
  response.end(`<!doctype html><title>Coursera bookmark browser fixture</title><main>Normal authoring outline fixture.</main>${frame}<script nonce="fixture">${active}window.fixtureCspViolations=[];document.addEventListener('securitypolicyviolation',event=>window.fixtureCspViolations.push(event.violatedDirective));</script>`);
});
let vite,browser;
try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  vite=await createServer({
    configFile:path.resolve('vite.config.ts'),
    server:{host:'127.0.0.1',port:0,strictPort:false},
    optimizeDeps:{entries:[path.resolve('web/CourseraBookmarkSetup.tsx')],
      include:['react','react-dom/client','react/jsx-dev-runtime','@noble/hashes/sha2.js']},
    plugins:[{name:'cti-coursera-bookmark-component-fixture',configureServer(viteServer){
      viteServer.middlewares.use(async(request,response,next)=>{
        if(request.url?.split('?')[0]!==fixturePath)return next();
        try{
          const html=await viteServer.transformIndexHtml(fixturePath,`<!doctype html><title>CTI bookmark setup fixture</title><div id="root"></div><script type="module">
            import React,{useState} from 'react';
            import {createRoot} from 'react-dom/client';
            import CourseraBookmarkSetup from '/CourseraBookmarkSetup.tsx';
            function Fixture(){const[disabled,setDisabled]=useState(false);return React.createElement(React.Fragment,null,
              React.createElement('button',{id:'fixture-toggle',onClick:()=>setDisabled(value=>!value)},'Toggle fixture disabled'),
              React.createElement(CourseraBookmarkSetup,{disabled}));}
            createRoot(document.getElementById('root')).render(React.createElement(Fixture));
          </script>`);
          response.setHeader('Content-Type','text/html; charset=utf-8');response.end(html);
        }catch(error){next(error);}
      });
    }}],
  });
  await vite.listen();
  const hostOrigin='http://127.0.0.1:'+vite.httpServer.address().port;
  browser=await chromium.launch({headless:true,
    ...(process.env.CTI_CHROMIUM_PATH?{executablePath:process.env.CTI_CHROMIUM_PATH}:{channel:'chromium'}),
    args:['--no-sandbox','--disable-dev-shm-usage','--no-proxy-server',
      '--host-resolver-rules=MAP www.coursera.org 127.0.0.1:'+server.address().port+', MAP example.test 127.0.0.1:'+server.address().port],
  });
  const context=await browser.newContext({ignoreHTTPSErrors:true,acceptDownloads:true});
  await context.grantPermissions(['clipboard-read','clipboard-write'],{origin:hostOrigin});
  const setup=await context.newPage();setup.on('pageerror',error=>errors.push(error.message));
  await setup.goto(hostOrigin+fixturePath);
  const component=setup.locator('.coursera-bookmark-setup');
  const bookmark=component.getByRole('link',{name:'CTI course data check',exact:true});
  await bookmark.waitFor();
  await setup.waitForFunction(()=>document.querySelector('.coursera-bookmark-setup a')?.getAttribute('href')?.startsWith('javascript:'));
  const emitted=await bookmark.getAttribute('href');assert(emitted.startsWith('javascript:'));
  assert.equal(await component.getByRole('textbox',{name:'CTI course data check bookmark address',includeHidden:true}).inputValue(),emitted);
  await bookmark.click();
  await component.getByRole('status').getByText(/Drag this link/).waitFor();
  assert.equal(requests.length,0,'Clicking the CTI drag link must initiate no Coursera requests');
  assert.equal(await setup.evaluate(()=>window.__CTI_COURSERA_COURSE_DATA_PROBE),undefined);
  await component.getByRole('button',{name:'Copy bookmark address',exact:true}).click();
  assert.equal(await setup.evaluate(()=>navigator.clipboard.readText()),emitted);
  await setup.locator('#fixture-toggle').click();
  assert.equal(await component.getByRole('link',{name:'CTI course data check',exact:true}).count(),0);
  assert(await component.getByRole('button',{name:'Copy bookmark address',exact:true}).isDisabled());
  await setup.locator('#fixture-toggle').click();
  assert.equal(await bookmark.getAttribute('href'),emitted,'Re-enabling the setup must restore the trusted bookmark href');
  // Simulate a denied clipboard permission on the UI side only. The fallback
  // address is the same maintained program, with no program execution here.
  await setup.evaluate(()=>Object.defineProperty(navigator.clipboard,'writeText',{configurable:true,value:()=>Promise.reject(new Error('fixture denied clipboard'))}));
  await component.getByRole('button',{name:'Copy bookmark address',exact:true}).click();
  await component.getByRole('status').getByText(/Use the bookmark address below/).waitFor();
  await component.getByText('Bookmark address copy fallback',{exact:true}).click();
  await component.getByRole('textbox',{name:'CTI course data check bookmark address'}).focus();
  assert.deepEqual(await setup.evaluate(()=>{const text=document.querySelector('.coursera-bookmark-setup textarea');return [text.selectionStart,text.selectionEnd,text.value.length];}),[0,emitted.length,emitted.length]);

  let bookmarkExecuted=true,policyCanaryVerified=false,noCspCanaryResult;
  async function boundedNativePoll(read){
    const deadline=Date.now()+2000;
    do{
      if(await read())return true;
      await new Promise(resolve=>setTimeout(resolve,25));
    }while(Date.now()<deadline);
    return false;
  }
  async function noCspNavigationCanary(){
    if(noCspCanaryResult)return noCspCanaryResult;
    const canary=await context.newPage();
    try{
      await canary.goto(origin+'/teach/synthetic/'+courseId+'/content/edit?open=1');
      const canarySession=await context.newCDPSession(canary);
      try{
        const navigation=await canarySession.send('Page.navigate',{url:'javascript:void(window.__CTI_BOOKMARK_NAVIGATION_CANARY=true)',transitionType:'auto_bookmark'});
        const executed=await boundedNativePoll(()=>canary.evaluate(()=>window.__CTI_BOOKMARK_NAVIGATION_CANARY===true));
        noCspCanaryResult={errorText:navigation.errorText||null,executed};
        return noCspCanaryResult;
      }finally{await canarySession.detach();}
    }finally{await canary.close();}
  }
  if(allowPolicyBlockedReaderCheck&&bookmarkSchemeBlockedByManagedPolicy&&process.env.CTI_CHROMIUM_PATH==='/usr/bin/chromium'){
    const canary=await noCspNavigationCanary();
    assert.equal(canary.errorText,'net::ERR_ABORTED');assert.equal(canary.executed,false);
    assert.equal(requests.length,0);policyCanaryVerified=true;
  }
  async function invoke(page,frameId){
    const session=await context.newCDPSession(page);
    let nativeDialogObserved=false;
    const observeDialog=()=>{nativeDialogObserved=true;};page.on('dialog',observeDialog);
    const recentErrors=[];
    const observeConsole=message=>{
      if(message.type()==='error')recentErrors.push(message.text().replace(/javascript:[^\s"'<>]*/gi,'javascript:[emitted bookmark]').slice(0,500));
    };
    page.on('console',observeConsole);
    // This submits the actual href emitted by the maintained UI to the browser's
    // navigation machinery. It does not execute source with Runtime.evaluate.
    let navigation,nativeExecutionObserved;
    try{
      navigation=await session.send('Page.navigate',{url:emitted,transitionType:'auto_bookmark',...(frameId?{frameId}:{})});
      // The navigation reply precedes the renderer's javascript URL task on
      // some builds. Keep the real guard listener and wait for browser-visible
      // execution evidence, rather than reading state at the IPC reply boundary.
      nativeExecutionObserved=await boundedNativePoll(async()=>nativeDialogObserved||
        (!frameId&&await page.evaluate(()=>Boolean(window.__CTI_COURSERA_COURSE_DATA_PROBE))));
    }finally{page.off('dialog',observeDialog);page.off('console',observeConsole);}
    // javascript: programs returning void do not replace the document. Some
    // browser builds report ERR_ABORTED even after executing the program; use
    // its real state or visible guard alert as execution evidence as well.
    if(!nativeExecutionObserved){
      if(!policyCanaryVerified||navigation.errorText!=='net::ERR_ABORTED'){
        const cspDirectives=await page.evaluate(()=>Array.isArray(window.fixtureCspViolations)?window.fixtureCspViolations.slice(-5):[]);
        const canary=await noCspNavigationCanary();
        console.error(JSON.stringify({nativeBookmarkFailure:{errorText:navigation.errorText||null,
          observedProbeState:false,observedGuardDialog:nativeDialogObserved,cspDirectives,
          recentConsoleErrors:recentErrors.slice(-4),noCspCanary:canary}}));
        await session.detach();throw new Error('Browser rejected emitted bookmark navigation: '+(navigation.errorText||'no execution evidence within 2 seconds'));
      }
      bookmarkExecuted=false;
      let contextId;
      if(frameId){
        const executionContexts=[];
        session.on('Runtime.executionContextCreated',event=>executionContexts.push(event.context));
        await session.send('Runtime.enable');
        contextId=executionContexts.find(entry=>entry.auxData?.frameId===frameId&&entry.auxData?.isDefault)?.id;
        assert(contextId,'The synthetic subframe must have a default debugger execution context');
      }
      // Explicit debugger/Console reader check only. This is the identical
      // maintained UI-emitted source, with no substituted implementation. Its
      // success cannot establish a native bookmark launch under this policy.
      const evaluation=await session.send('Runtime.evaluate',{
        expression:decodeURIComponent(emitted.slice('javascript:'.length)),
        ...(contextId?{contextId}:{}),userGesture:true,returnByValue:true,
      });
      assert.equal(evaluation.exceptionDetails,undefined,'The diagnostic source must run without module closure references');
    }
    return session;
  }
  async function finished(page){
    await page.waitForFunction(()=>window.__CTI_COURSERA_COURSE_DATA_PROBE?.running===false);
    return page.evaluate(()=>window.__CTI_COURSERA_COURSE_DATA_PROBE.result);
  }
  async function clickClosedButton(page,session,label){
    const {root}=await session.send('DOM.getDocument',{depth:-1,pierce:true});
    let target;
    const textContent=node=>(node.nodeValue||'')+(node.children||[]).map(textContent).join('');
    function walk(node){
      if(node.nodeName==='BUTTON'&&textContent(node)===label)target=node;
      for(const child of [...(node.children||[]),...(node.shadowRoots||[])])walk(child);
    }
    walk(root);assert(target,'Maintained closed-shadow button must exist: '+label);
    const {model}=await session.send('DOM.getBoxModel',{nodeId:target.nodeId});
    const box=model.content;
    await page.mouse.click((box[0]+box[2]+box[4]+box[6])/4,(box[1]+box[3]+box[5]+box[7])/4);
  }
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  const fetchedOrigins=[];page.on('request',request=>fetchedOrigins.push(new URL(request.url()).origin));
  page.on('console',message=>{if(message.type()==='error')browserMessages.push(message.text());});
  await page.goto(origin+'/teach/synthetic/'+courseId+'/content/edit');
  const downloads=[];page.on('download',download=>downloads.push(download));
  const downloading=page.waitForEvent('download');
  // A strict native-launch failure may occur before a download is possible.
  // Await this same promise below on success; avoid an orphaned rejection when
  // the browser closes while reporting the earlier launch failure.
  void downloading.catch(()=>{});
  const beforeLoads=documentLoads.length,beforeRequests=requests.length;
  const session=await invoke(page),result=await finished(page);
  assert.equal(result.kind,'CTI_COURSERA_COURSE_DATA_CHECK_V1');
  assert.equal(result.notForCourseAudit,true);assert.equal(result.wholeCourseVerified,false);
  assert.equal(result.courseId,courseId);assert.equal(result.status,'COURSE_SCHEMA_SAMPLED');
  assert.equal(result.stopReason,'COURSE_DATA_CHECK_FINISHED');assert.equal(result.requests,6);
  assert.equal(result.capturedResponses,6);assert.equal(result.inventoryLeafCount,2);
  assert.equal(result.relationRequests,4);assert.equal(result.originalResponseBytesRetained,false);
  assert.equal(result.bodyFormat,'PARSED_SANITIZED_JSON_MODEL');
  assert.equal(documentLoads.length,beforeLoads,'The probe opens no quiz and reloads no document');
  const capturedRequests=requests.slice(beforeRequests);
  assert.equal(capturedRequests.length,6);assert(capturedRequests.every(request=>request.method==='GET'&&request.authenticated));
  assert.deepEqual(new Set(capturedRequests.slice(0,2).map(request=>request.resource)),new Set(['authoringCourseMaterials.v1','authoringCourses.v2']));
  assert(capturedRequests.slice(2).every(request=>request.completedRootResponses===2),'Root responses settle before relation samples start');
  assert.equal(maxInFlight.get(courseId),2,'Exactly two reads overlap and the next pair waits for them');
  assert(capturedRequests.every(request=>request.courseId===courseId));
  assert.deepEqual(new Set(fetchedOrigins),new Set([origin]),'The course check contacts no other origin');
  assert.equal(result.relationSamplePlan.length,4);
  const assessmentAtom=atomReference(courseId,'staffGraded'),readingAtom=atomReference(courseId,'supplement');
  assert.deepEqual(capturedRequests.slice(2).map(request=>request.path),[
    '/api/authoringItemContentRelations.v1/'+assessmentAtom,'/api/authoringAtoms.v2/'+assessmentAtom,
    '/api/authoringItemContentRelations.v1/'+readingAtom,'/api/authoringAtoms.v2/'+readingAtom,
  ]);
  for(const record of result.records.filter(record=>record.sourceBinding)){
    const binding=record.sourceBinding,expected=atomBindings.get(binding.atomId);
    assert.equal(binding.courseId,courseId);assert.equal(binding.itemId,expected.itemId);
    assert.equal(binding.sourceContentId,'atom~'+binding.atomId);assert.equal(binding.sourceContentType,expected.sourceContentType);
    assert.equal(binding.staffAssignmentId,expected.staffAssignmentId);assert.equal(binding.materialVersion,17);
    assert.equal(binding.courseBranchVersion,23);assert.equal(binding.assessmentRootCertified,false);
    assert.equal(record.requestScope,'EXPLICIT_MATERIAL_ATOM_REFERENCE_SCHEMA_SAMPLE');
    assert.equal(record.declaredIdentityFields.identitySemantics,'REQUEST_BOUND_TO_DECLARED_ATOM_RESPONSE_MODEL_NOT_CERTIFIED');
    assert.deepEqual(record.data.elements[0].unknownSchemaRelation,relation);
  }
  assert.equal(result.records.filter(record=>record.sourceBinding).length,4);
  assert.equal(await page.evaluate(()=>document.cookie.includes('fixtureSession')),false,'The session credential is HttpOnly');
  assert.deepEqual(await page.evaluate(()=>window.fixtureCspViolations),[],'The emitted bookmark runs without a fixture CSP relaxation');
  const courseRecord=result.records.find(record=>record.resource==='authoringCourses.v2');
  assert.deepEqual(courseRecord.data.elements[0].opaqueFutureRelation,relation,'Unknown relation fields must remain available for schema investigation');
  const materialsRecord=result.records.find(record=>record.resource==='authoringCourseMaterials.v1');
  assert.deepEqual(JSON.parse(materialsRecord.data.elements[0].configuration),{knownRelation:relation});
  assert.equal(materialsRecord.data.elements[0].url,'https://example.test/content?item=fixture');
  const serialized=JSON.stringify(result);
  for(const marker of credentialMarkers)assert(!serialized.includes(marker),'The local diagnostic must exclude credential marker '+marker);
  assert(result.records.every(record=>/^[a-f0-9]{64}$/.test(record.originalResponseSha256)));
  const download=await downloading;
  assert.equal(downloads.length,1);assert(download.suggestedFilename().includes(courseId));
  assert.deepEqual(JSON.parse(fs.readFileSync(await download.path(),'utf8')),result);
  assert.equal(result.automaticDownloadAttempts,1,'Finishing attempts one automatic local diagnostic download');
  await page.evaluate(()=>window.__CTI_COURSERA_COURSE_DATA_PROBE.stop('OPERATOR_STOPPED'));
  await page.waitForTimeout(50);assert.equal(downloads.length,1,'A repeated finish must not download again');
  await clickClosedButton(page,session,'Close check');
  assert.equal(await page.locator('#__cti_coursera_course_data_probe').count(),0);
  await session.detach();

  // The same emitted bookmark determines a different course from the active
  // authoring document; it contains no hard-coded initial course identifier.
  const second=await context.newPage();await second.goto(origin+'/teach/another-synthetic/'+secondId+'/content/edit');
  const secondStart=requests.length,secondSession=await invoke(second),secondResult=await finished(second);
  assert.equal(secondResult.courseId,secondId);assert.equal(requests.length-secondStart,6);
  assert(requests.slice(secondStart).every(request=>request.courseId===secondId));
  assert.equal(maxInFlight.get(secondId),2);await secondSession.detach();

  for(const [id,code] of [['Forbidden_fixture_123','HTTP_403'],['Invalid_fixture_123','INVALID_JSON'],['Oversize_fixture_123','BODY_BYTE_LIMIT']]){
    const rejected=await context.newPage();await rejected.goto(origin+'/teach/synthetic/'+id+'/content/edit');
    const rejectedStart=requests.length,rejectedSession=await invoke(rejected),rejectedResult=await finished(rejected);
    assert.equal(requests.length-rejectedStart,2);assert.equal(rejectedResult.status,'COURSE_SCHEMA_NOT_CAPTURED');
    assert.equal(rejectedResult.capturedResponses,0);assert.equal(rejectedResult.failures.length,2);
    assert(rejectedResult.failures.every(failure=>failure.code===code));
    assert(rejectedResult.responseBytes<=rejectedResult.limits.bodyBytes*2);
    await rejectedSession.detach();await rejected.close();
  }
  const guardErrors=[],guardDialogs=[];
  function handleGuard(page){
    page.on('pageerror',error=>guardErrors.push(error.message));
    page.on('dialog',async dialog=>{guardDialogs.push(dialog.message());await dialog.dismiss();});
  }
  const active=await context.newPage();handleGuard(active);await active.goto(origin+'/teach/synthetic/'+courseId+'/content/edit?active=1');
  const activeStart=requests.length,activeSession=await invoke(active);
  await active.waitForTimeout(100);assert.equal(requests.length,activeStart);
  assert.equal(await active.evaluate(()=>window.__CTI_COURSERA_COURSE_DATA_PROBE),undefined);
  assert(guardDialogs.at(-1).includes('Stop the running CTI extractor'));await activeSession.detach();
  for(const url of ['https://example.test/teach/synthetic/'+courseId+'/content/edit',origin+'/learn/synthetic']){
    const wrong=await context.newPage();handleGuard(wrong);await wrong.goto(url);
    const guardStart=requests.length,wrongSession=await invoke(wrong);
    await wrong.waitForTimeout(100);assert.equal(requests.length,guardStart);
    assert.equal(await wrong.evaluate(()=>window.__CTI_COURSERA_COURSE_DATA_PROBE),undefined);
    await wrongSession.detach();await wrong.close();
  }
  const framing=await context.newPage();handleGuard(framing);
  await framing.goto(origin+'/teach/synthetic/'+courseId+'/content/edit?frame=1');
  await framing.frames()[1].waitForLoadState();
  const treeSession=await context.newCDPSession(framing),tree=await treeSession.send('Page.getFrameTree');
  const childId=tree.frameTree.childFrames[0].frame.id,frameStart=requests.length;
  const childSession=await invoke(framing,childId);
  await framing.waitForTimeout(100);assert.equal(requests.length,frameStart);
  assert.equal(await framing.frames()[1].evaluate(()=>window.__CTI_COURSERA_COURSE_DATA_PROBE),undefined);
  assert.equal(guardDialogs.length,4);assert(guardDialogs.slice(1).every(message=>message.includes('Open the Coursera authoring course in the main tab')));
  assert.deepEqual(guardErrors,[]);
  await childSession.detach();await treeSession.detach();assert.deepEqual(errors,[]);
  if(!bookmarkExecuted)console.warn('::warning::Managed native Chromium blocks javascript bookmark navigation. Explicit local debugger reader check passed; bookmark launch remains unverified here. Browser policy was not modified.');
  console.log(JSON.stringify({status:bookmarkExecuted?'PASS':'PARTIAL',
    mode:bookmarkExecuted?'Maintained React bookmark href via native browser javascript navigation':'Maintained emitted bookmark source via explicit debugger reader check only',
    bookmarkExecuted,readerVerified:true,policyCanaryVerified,
    setupClipboardAndFallback:true,ctiClickReadsNothing:true,strictNonceCsp:true,authenticatedHttpOnlyGets:6,
    rootsBeforeBoundSamples:true,maximumOverlappingRequests:2,explicitAtomSourceBindings:true,
    unknownSchemaRetained:true,credentialFieldsExcluded:true,localDiagnosticDownloads:1,
    universalCourseBinding:true,foreignAndSubframeAndActiveExtractorGuards:true,
    forbiddenAndInvalidAndStreamedOversizeFailClosed:true,
    scope:'Synthetic schema discovery only; not a native saved-bookmark or full-course capture or live Coursera completion claim.'}));
}catch(error){
  console.error(JSON.stringify({errors,browserMessages,requests:requests.map(request=>({path:request.path,method:request.method}))}));
  console.error('::error::Coursera bookmark browser check failed: '+error.message);throw error;
}finally{
  await browser?.close();await vite?.close();
  await new Promise(resolve=>server.close(resolve));fs.rmSync(scratch,{recursive:true,force:true});
}
