import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
const dashboard=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const {build}=createRequire(path.join(dashboard,'package.json'))('esbuild');
const bundle=await build({stdin:{contents:`import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{JsonEvidencePreview}from'./json-evidence-preview';function App(){const[id,setId]=useState('valid');return <><button onClick={()=>setId('denied')}>Denied</button><button onClick={()=>setId('invalid')}>Invalid</button><button onClick={()=>setId('valid')}>Valid</button><JsonEvidencePreview href={'/api/artifacts/'+id+'/file'}/></>};createRoot(document.getElementById('root')).render(<App/>);`,resolveDir:path.join(dashboard,'components'),loader:'tsx'},write:false,bundle:true,platform:'browser',jsx:'automatic'});
const malicious='<img src=x onerror="document.body.dataset.executed=1"><script>document.body.dataset.executed=1</script>';
const server=createServer((req,res)=>{
 if(req.url==='/'){res.setHeader('content-type','text/html');res.end('<div id="root"></div><script src="/bundle.js"></script>');}
 else if(req.url==='/bundle.js'){res.setHeader('content-type','text/javascript');res.end(bundle.outputFiles[0].text);}
 else if(req.url==='/api/artifacts/denied/file'){res.writeHead(403);res.end('Denied');}
 else if(req.url==='/api/artifacts/invalid/file'){res.end('<html>Not JSON</html>');}
 else{res.setHeader('content-type','application/json');res.setHeader('content-disposition','attachment; filename="siem.json"');res.end(JSON.stringify({value:malicious}));}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;const browser=await chromium.launch();
try{const page=await browser.newPage();await page.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());await page.goto(origin);
 await page.locator('pre').waitFor();assert.match(await page.locator('pre').innerText(),/<script>/);assert.equal(await page.locator('iframe').count(),0);assert.equal(await page.locator('pre img, pre script').count(),0);assert.equal(await page.locator('body').getAttribute('data-executed'),null);
 assert.equal(await page.getByRole('link',{name:'Download Evidence'}).getAttribute('href'),'/api/artifacts/valid/file');
 await page.getByRole('button',{name:'Denied',exact:true}).click();await page.getByRole('alert').waitFor();assert.match(await page.getByRole('alert').innerText(),/403/);assert.equal(await page.locator('pre').count(),0);
 await page.getByRole('button',{name:'Invalid',exact:true}).click();await page.getByRole('alert').waitFor();assert.equal(await page.locator('pre').count(),0);
 await page.getByRole('button',{name:'Valid',exact:true}).click();await page.locator('pre').waitFor();
 console.log('PASS: attachment JSON renders inertly, download retained, 403/invalid JSON fail visibly, item changes clear stale content');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
