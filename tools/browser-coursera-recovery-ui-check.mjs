import assert from 'node:assert/strict';
import path from 'node:path';
import {createServer} from 'vite';
import {chromium} from 'playwright';

// Import the maintained React component and runtime through Vite. Only this
// fixture supplies the accelerated supervisor clock and synthetic popup HTML;
// no production hook or extraction/certification substitute is installed.
const courseId='Recovery_ui_fixture_123';
const shell=`https://www.coursera.org/teach/synthetic/${courseId}/content/edit`;
const fixturePath='/__cti_coursera_recovery_ui__.html';
let vite,browser;
const errors=[];
try{
  vite=await createServer({
    configFile:path.resolve('vite.config.ts'),
    server:{host:'127.0.0.1',port:0,strictPort:false},
    optimizeDeps:{entries:[path.resolve('web/LocalCourseraExtraction.tsx')],
      include:['react','react-dom/client','react/jsx-dev-runtime','@noble/hashes/sha2.js']},
    plugins:[{
      name:'cti-coursera-recovery-ui-fixture',
      configureServer(server){
        server.middlewares.use(async(request,response,next)=>{
          if(request.url?.split('?')[0]!==fixturePath)return next();
          try{
            const html=await server.transformIndexHtml(fixturePath,`<!doctype html><html><head>
              <title>CTI managed recovery UI fixture</title></head><body><div id="root"></div>
              <script type="module">
              import React from 'react';
              import {createRoot} from 'react-dom/client';
              import LocalCourseraExtraction from '/LocalCourseraExtraction.tsx';
              import {getCourseraManagedRuntime} from '/@fs/${path.resolve('src/domain/coursera-managed-runtime.ts')}';
              const intervals=new Map();let sequence=1000000,clock=Date.now();
              Date.now=()=>clock;
              window.setInterval=(callback,delay,...args)=>{
                const id=++sequence;intervals.set(id,()=>callback(...args));return id;
              };
              window.clearInterval=id=>intervals.delete(id);
              window.advanceSupervisorClock=milliseconds=>{
                clock+=milliseconds;for(const callback of [...intervals.values()])callback();
              };
              window.recoveryRuntime=getCourseraManagedRuntime(window);
              createRoot(document.getElementById('root')).render(React.createElement(LocalCourseraExtraction,{initialUrl:${JSON.stringify(shell)}}));
              </script></body></html>`);
            response.setHeader('Content-Type','text/html; charset=utf-8');response.end(html);
          }catch(error){next(error);}
        });
      },
    }],
  });
  await vite.listen();
  const address=vite.httpServer.address();
  const hostOrigin=`http://127.0.0.1:${address.port}`;
  browser=await chromium.launch({headless:true,
    ...(process.env.CTI_CHROMIUM_PATH?{executablePath:process.env.CTI_CHROMIUM_PATH}:{channel:'chromium'}),
    args:['--no-sandbox','--disable-dev-shm-usage'],
  });
  const context=await browser.newContext({ignoreHTTPSErrors:true});
  await context.grantPermissions(['clipboard-read','clipboard-write'],{origin:hostOrigin});
  await context.route('https://www.coursera.org/**',route=>route.fulfill({
    status:200,contentType:'text/html',body:'<!doctype html><title>Coursera recovery fixture</title><p>Normal authoring outline fixture. No registered extractor.</p>',
  }));
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  await page.goto(hostOrigin+fixturePath);
  const managed=page.locator('.managed-local-capture');
  await page.getByRole('heading',{name:'Managed capture in local Chrome',exact:true}).waitFor();
  await managed.getByRole('checkbox',{name:'Fresh full-course managed run'}).check();

  async function commandConfig(){
    await page.waitForFunction(()=>Boolean(window.recoveryRuntime.snapshot().command));
    const command=await page.evaluate(()=>window.recoveryRuntime.snapshot().command);
    const parsed=JSON.parse(command);
    assert.equal(parsed.cmd,'Page.addScriptToEvaluateOnNewDocument');
    const config=JSON.parse(parsed.args.source.match(/window\.__CTI_AUTOMATIC_LOCAL_CONFIG__=(\{[^\n]*?\});\n/)[1]);
    assert.equal(config.courseId,courseId);assert.equal(config.shellUrl,shell);
    return {command,config};
  }
  async function send(child,config,event,extra={}){
    await child.evaluate(({hostOrigin,receipt})=>window.opener.postMessage(receipt,hostOrigin),{
      hostOrigin,receipt:{kind:'CTI_LOCAL_CAPTURE_STATUS_V1',token:config.token,courseId,event,
        visibility:'visible',...extra},
    });
  }
  async function state(){return page.evaluate(()=>window.recoveryRuntime.snapshot().status);}

  const opening=page.waitForEvent('popup');
  await managed.getByRole('button',{name:'Open managed Coursera tab',exact:true}).click();
  const first=await opening;await first.waitForLoadState();
  const initial=await commandConfig();assert.equal(initial.config.freshRun,true);
  await send(first,initial.config,'READY');
  await page.waitForFunction(()=>window.recoveryRuntime.snapshot().status.state==='RUNNING');
  await send(first,initial.config,'PROGRESS',{completeItems:83,savedQuestionsTotal:1428,
    phase:'Capturing course items',count:'83/185 items complete · 1428 question observations saved'});
  await managed.getByRole('status').getByText(/83\/185 items complete/).waitFor();

  const recoveryNavigation=first.waitForEvent('framenavigated',frame=>frame===first.mainFrame());
  await page.evaluate(()=>window.advanceSupervisorClock(45001));
  await recoveryNavigation;await first.waitForLoadState();
  assert.equal((await state()).state,'RECOVERING');
  assert.equal(await first.evaluate(()=>window.__CTI_ITEM_FIDELITY_RUN_LOCK),undefined);
  await page.evaluate(()=>window.advanceSupervisorClock(60001));
  await managed.getByRole('status').getByText('Extractor did not reconnect',{exact:true}).waitFor();
  const stopped=await state();assert.equal(stopped.state,'STOPPED');
  assert.equal(stopped.completeItems,83);assert.equal(stopped.savedQuestions,1428);assert.equal(stopped.recoveries,1);
  assert.match(await managed.innerText(),/Main \(the Coursera URL\)/);
  assert.match(await managed.innerText(),/Tab \(\) cannot run the Page command/);
  const firstAction=managed.locator('.action-links > button').first();
  assert.equal((await firstAction.innerText()).trim(),'Resume saved managed run');
  assert.notEqual(await firstAction.getAttribute('class'),'secondary','Saved resume must be the primary recovery action');

  // Keep the old WindowProxy only in the fixture to inject a stale receipt
  // after replacement. New producers communicate through real postMessage.
  await page.evaluate(()=>window.oldRecoveryChild=window.recoveryRuntime.snapshot().child);
  const replacing=page.waitForEvent('popup'),closing=first.waitForEvent('close');
  await firstAction.click();
  const replacement=await replacing;await closing;await replacement.waitForLoadState();
  const resumed=await commandConfig();assert.notEqual(resumed.config.token,initial.config.token);
  assert.equal(resumed.config.resumeExisting,true);assert.equal(resumed.config.freshRun,undefined);
  assert.equal(await managed.getByRole('checkbox',{name:'Fresh full-course managed run'}).isChecked(),false);
  const waiting=await state();assert.equal(waiting.state,'WAITING');
  assert.equal(waiting.completeItems,83);assert.equal(waiting.savedQuestions,1428);
  await page.evaluate(({courseId,token})=>window.dispatchEvent(new MessageEvent('message',{
    origin:'https://www.coursera.org',source:window.oldRecoveryChild,
    data:{kind:'CTI_LOCAL_CAPTURE_STATUS_V1',token,courseId,event:'READY',completeItems:185,savedQuestionsTotal:9999},
  })),{courseId,token:resumed.config.token});
  assert.equal((await state()).state,'WAITING','The closed old producer must not acknowledge the replacement');
  assert.equal((await state()).savedQuestions,1428);
  await managed.getByRole('button',{name:'Copy managed capture command',exact:true}).click();
  await page.getByText(/Managed command copied\. In the Coursera tab opened by CTI, select Main/).waitFor();
  const copied=await page.evaluate(()=>navigator.clipboard.readText());assert.equal(copied,resumed.command);
  await send(replacement,resumed.config,'READY',{recoveries:1});
  await page.waitForFunction(()=>window.recoveryRuntime.snapshot().status.state==='RUNNING');
  const connected=await state();assert.equal(connected.completeItems,83);assert.equal(connected.savedQuestions,1428);
  await managed.getByRole('button',{name:'Stop managed run',exact:true}).click();
  assert.equal((await state()).state,'STOPPED');assert.deepEqual(errors,[]);
  console.log(JSON.stringify({status:'PASS',mode:'Actual React managed capture recovery UI and maintained runtime',
    completeItems:83,savedQuestions:1428,oldStoppedChildClosed:true,resumePrimary:true,
    freshRunAbsent:true,mainTargetInstructions:true,clipboardCurrentCommand:true,oldChildReceiptIgnored:true,
    scope:'Native cross-origin popup and postMessage; fixture clock accelerated; no extraction or live course completion claim.'}));
}catch(error){
  console.error('::error::Coursera recovery UI check failed: '+error.message);throw error;
}finally{
  await browser?.close();await vite?.close();
}
