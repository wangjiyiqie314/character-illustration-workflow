import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {sampleReferences, checkEligibility, resolveInside, verifyCatalog, auditPlan, sha256} from '../tools/reference-core.mjs';

const entry=(id,pool,artist_id=id,extra={})=>({id,pool,artist_id,bookmark_count:9000,restrict:0,x_restrict:0,ai_type:0,
  function_key:pool+id,moods:['calm'],values:['high-key'],renderings:['cel'],format:'portrait',
  visual_review:{status:'inspected',reviewer:'agent'},...extra});
const fixture={schema_version:1,works:[entry('1','composition'),entry('2','composition'),entry('3','color'),entry('4','color'),entry('5','lighting'),entry('6','lighting')]};

test('bookmarkCount threshold is strict, numeric and distinct from likes or tags',()=>{
  for(const count of [8000,'9000',null,NaN]) assert.throws(()=>checkEligibility({...entry('1','color'),bookmark_count:count}),/bookmark/);
  assert.doesNotThrow(()=>checkEligibility(entry('1','color')));
  assert.throws(()=>checkEligibility({...entry('1','color'),bookmark_count:20,like_count:10000,tags:['10000users入り']}));
  assert.throws(()=>checkEligibility({...entry('1','color'),ai_type:2}),/marked/);
});
test('seeded selection is reproducible, distinct, constrained and bounded',()=>{
  const opts={seed:'postal-study',mood:'calm',format:'portrait',grammar:'cel',roles:['composition','color','lighting']};
  const a=sampleReferences(fixture,opts),b=sampleReferences(fixture,opts);
  assert.deepEqual(a,b);assert.equal(new Set(a.map(x=>x.artist_id)).size,3);
  assert.deepEqual(a.map(x=>x.pool),opts.roles);
  assert.throws(()=>sampleReferences(fixture,{...opts,roles:['color','color']}),/unique/);
  assert.throws(()=>sampleReferences(fixture,{...opts,roles:['composition','color','lighting','rendering']}),/three/);
  assert.throws(()=>sampleReferences(fixture,{...opts,mood:'unknown'}),/mood/);
});
test('reject conflicting light values, uninspected images and duplicate artists',()=>{
  const opts={seed:'x',roles:['color','lighting'],mood:'calm',grammar:'cel'};
  assert.throws(()=>sampleReferences({works:[entry('1','color'),entry('2','lighting','2',{values:['low-key']})]},opts),/compatible/);
  assert.throws(()=>sampleReferences({works:[entry('1','color','same'),entry('2','lighting','same')]},opts),/compatible/);
  assert.throws(()=>sampleReferences({works:[entry('1','color','1',{visual_review:{status:'uninspected'}}),entry('2','lighting')]},opts),/candidate/);
});
test('target format constrains composition; incompatible grammar does not silently fall back',()=>{
  const c={works:[entry('1','composition','1',{format:'landscape'}),entry('2','rendering','2',{renderings:['graphic']})]};
  assert.throws(()=>sampleReferences(c,{seed:'x',roles:['composition'],format:'portrait'}),/candidate/);
  assert.throws(()=>sampleReferences(c,{seed:'x',roles:['rendering'],grammar:'cel'}),/candidate/);
});
test('library paths cannot escape and catalogue cannot claim success for missing image',()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'pixiv-reference-test-'));
  try{
    assert.throws(()=>resolveInside(temp,'../outside.png'),/escape/);
    assert.throws(()=>resolveInside(temp,path.resolve(temp,'..','outside.png')),/escape/);
    const result=verifyCatalog({works:[{...entry('1','color'),file:'originals/missing.png',category_file:'02/missing.png',evidence_file:'evidence/1.json',image_evidence_file:'evidence/1-image.json',sha256:'a'}]},temp,{checkDiversity:false});
    assert.equal(result.status,'FAIL');assert.ok(result.errors.length);
  }finally{fs.rmSync(temp,{recursive:true,force:true});}
});
test('reference plan rejects catalogue changes',()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'pixiv-reference-plan-test-'));
  try{
    const catalogueBytes=Buffer.from(JSON.stringify(fixture));fs.writeFileSync(path.join(temp,'catalog.json'),catalogueBytes);
    const stale={catalog_sha256:'outdated',references:[]};
    assert.equal(auditPlan(stale,temp).status,'FAIL');
  }finally{fs.rmSync(temp,{recursive:true,force:true});}
});
test('valid provenance passes; image drift, missing files and forged counts fail',()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'pixiv-reference-provenance-test-'));
  const works=[];
  try{
    fs.mkdirSync(path.join(temp,'originals'));fs.mkdirSync(path.join(temp,'categories'));fs.mkdirSync(path.join(temp,'evidence'));
    let n=0;
    for(const pool of ['composition','color','lighting','rendering','narrative'])for(let i=0;i<3;i++){
      const id=String(++n),bytes=Buffer.from('test-reference-'+id),file='originals/'+id+'.png',category_file='categories/'+id+'.png';
      const w={...entry(id,pool),title:'title'+id,artist:'artist'+id,width:10,height:10,page_count:1,
        observation:'observed',principle:'principle',transfer:'transfer',avoid:'exclude',file,category_file,
        evidence_file:'evidence/'+id+'.json',image_evidence_file:'evidence/'+id+'-image.json',sha256:sha256(bytes),
        source_url:'https://www.pixiv.net/artworks/'+id,bookmarks_observed_at:'2026-10-13T00:00:00Z'};
      for(const f of [file,category_file])fs.writeFileSync(path.join(temp,f),bytes);
      fs.writeFileSync(path.join(temp,w.evidence_file),JSON.stringify({fields:w,source_url:w.source_url,retrieved_at:w.bookmarks_observed_at}));
      fs.writeFileSync(path.join(temp,w.image_evidence_file),JSON.stringify({file,sha256:w.sha256,bytes:bytes.length,is_unmodified_download:true,http_status:200,image_url:'https://i.pximg.net/example.png',source_url:w.source_url}));
      works.push(w);
    }
    const c={works};assert.equal(verifyCatalog(c,temp).status,'PASS');
    assert.ok(verifyCatalog({...c,target_per_pool:20},temp).errors.some(e=>e.error.includes('exactly 20')));
    const catalogBytes=Buffer.from(JSON.stringify(c));fs.writeFileSync(path.join(temp,'catalog.json'),catalogBytes);
    const options={seed:'x',roles:['color','lighting'],mood:'calm',grammar:'cel'};
    const plan={catalog_sha256:sha256(catalogBytes),options,references:sampleReferences(c,options).map(w=>({id:w.id,role:w.pool,file:w.file,sha256:w.sha256}))};
    assert.equal(auditPlan(plan,temp).status,'PASS');
    const relocated={...plan,references:plan.references.map(r=>({...r,absolute_path:path.join(temp,'wrong-location',r.id)}))};
    assert.ok(auditPlan(relocated,temp).errors.some(e=>e.error.includes('stale after relocation')));
    const target=plan.references[0];fs.writeFileSync(path.join(temp,target.file),'altered');
    assert.ok(auditPlan(plan,temp).errors.some(e=>e.error.includes('hash changed')));
    assert.ok(verifyCatalog(c,temp).errors.some(e=>e.error.includes('Changed image bytes')));
    fs.unlinkSync(path.join(temp,plan.references[1].file));assert.equal(auditPlan(plan,temp).status,'FAIL');
    const forged={works:c.works.map(w=>({...w,bookmark_count:100000}))};
    assert.ok(verifyCatalog(forged,temp).errors.some(e=>e.error.includes('bookmark_count')));
  }finally{fs.rmSync(temp,{recursive:true,force:true});}
});
