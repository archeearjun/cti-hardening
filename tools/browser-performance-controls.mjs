import assert from 'node:assert/strict';
// Inspect actual closed-shadow controls via CDP; no application test-only API.
export async function clickPerformanceControl(page, label) {
 const session=await page.context().newCDPSession(page);
 try {
  const {root}=await session.send('DOM.getDocument',{depth:-1,pierce:true});
  const text=n=>(n.nodeValue||'')+(n.children||[]).map(text).join('');
  let found;const walk=n=>{if(n.nodeName==='BUTTON'&&text(n)===label)found=n;
   if(n.nodeName==='LABEL'&&text(n).includes(label))found=(n.children||[]).find(c=>c.nodeName==='INPUT');
   for(const c of [...(n.children||[]),...(n.shadowRoots||[])])walk(c);};walk(root);assert(found,`Diagnostic control exists: ${label}`);
  const {object}=await session.send('DOM.resolveNode',{nodeId:found.nodeId});
  await session.send('Runtime.callFunctionOn',{objectId:object.objectId,functionDeclaration:'function(){ this.click(); }',userGesture:true});
 } finally {await session.detach();}
}
