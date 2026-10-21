import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const errors=[];
for(const dir of ['tools','tests']){
  for(const name of fs.readdirSync(path.join(root,dir)).filter(name=>name.endsWith('.mjs'))){
    const result=spawnSync(process.execPath,['--check',path.join(root,dir,name)],{encoding:'utf8'});
    if(result.status!==0)errors.push(`${dir}/${name}: syntax check failed`);
  }
}
const demo=path.join(root,'examples/noble-lady');
const manifest=JSON.parse(fs.readFileSync(path.join(demo,'manifest.json'),'utf8'));
for(const image of manifest.images){
  const file=path.resolve(demo,image.file);
  if(!file.startsWith(demo+path.sep)){errors.push('Example image escapes its directory');continue;}
  if(!fs.existsSync(file)){errors.push(`${image.id}: missing image`);continue;}
  if(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')!==image.sha256)errors.push(`${image.id}: hash mismatch`);
}
const html=fs.readFileSync(path.join(demo,'index.html'),'utf8');
for(const match of html.matchAll(/(?:src|href)="([^"]+)"/g)){
  const link=match[1];if(/^(https?:|#|data:)/.test(link))continue;
  if(!fs.existsSync(path.resolve(demo,link)))errors.push(`Example link missing: ${link}`);
}
console.log(JSON.stringify({status:errors.length?'FAIL':'PASS',images:manifest.images.length,errors},null,2));
if(errors.length)process.exitCode=1;
