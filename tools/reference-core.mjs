import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const sha256=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
export function resolveInside(root,file){
  if(typeof file!=='string'||!file)throw Error('Missing library path');
  const base=path.resolve(root),resolved=path.resolve(base,file),relative=path.relative(base,resolved);
  if(relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))throw Error('Path would escape library');
  if(fs.existsSync(resolved)){
    const actual=path.relative(fs.realpathSync(base),fs.realpathSync(resolved));
    if(actual==='..'||actual.startsWith('..'+path.sep)||path.isAbsolute(actual))throw Error('Symlink would escape library');
  }
  return resolved;
}
export function checkEligibility(w){
  if(!Number.isFinite(w.bookmark_count)||w.bookmark_count<=8000)throw Error('Official numeric bookmark_count must be greater than 8000');
  if(w.restrict!==0||w.x_restrict!==0)throw Error('Expected a publicly available unrestricted work');
  if(w.ai_type===2)throw Error('Work is marked as AI-generated');
}
export function verifyCatalog(catalog,root,{checkDiversity=true}={}){
  const errors=[],seen=new Set(),groups=new Map();
  for(const w of catalog.works??[]){
    try{
      checkEligibility(w);
      if(seen.has(w.id))throw Error('Duplicate artwork');seen.add(w.id);
      if(w.visual_review?.status!=='inspected'||!w.observation||!w.principle||!w.transfer||!w.avoid)throw Error('Missing actual visual analysis');
      const evidence=JSON.parse(fs.readFileSync(resolveInside(root,w.evidence_file),'utf8'));
      const imageEvidence=JSON.parse(fs.readFileSync(resolveInside(root,w.image_evidence_file),'utf8'));
      for(const key of ['id','title','artist','artist_id','bookmark_count','width','height','page_count','restrict','x_restrict','ai_type'])if(w[key]!==evidence.fields[key])throw Error('Metadata differs from evidence: '+key);
      if(w.source_url!==evidence.source_url||w.bookmarks_observed_at!==evidence.retrieved_at)throw Error('Source/date differs from evidence');
      if(imageEvidence.is_unmodified_download!==true||imageEvidence.file!==w.file||imageEvidence.sha256!==w.sha256)throw Error('Invalid original-image provenance');
      if(imageEvidence.source_url!==w.source_url||imageEvidence.http_status!==200||!imageEvidence.image_url.startsWith('https://i.pximg.net/'))throw Error('Invalid official image source');
      for(const file of [w.file,w.category_file]){
        const bytes=fs.readFileSync(resolveInside(root,file));
        if(sha256(bytes)!==w.sha256||bytes.length!==imageEvidence.bytes)throw Error('Changed image bytes: '+file);
      }
      const group=groups.get(w.pool)??[];group.push(w);groups.set(w.pool,group);
    }catch(error){errors.push({id:w.id,error:error.message});}
  }
  if(!(catalog.works?.length))errors.push({error:'Empty library'});
  if(catalog.target_per_pool!==undefined)for(const pool of ['composition','color','lighting','rendering','narrative']){
    const group=groups.get(pool)??[];
    if(group.length!==catalog.target_per_pool)errors.push({pool,error:'Expected exactly '+catalog.target_per_pool+' works in this pool'});
    if(new Set(group.map(w=>w.artist_id)).size<8)errors.push({pool,error:'Expansion requires at least eight artists'});
    const authorCounts=new Map();for(const w of group)authorCounts.set(w.artist_id,(authorCounts.get(w.artist_id)??0)+1);
    if([...authorCounts.values()].some(n=>n>3))errors.push({pool,error:'Expansion allows at most three works per artist in a pool'});
  }
  if(checkDiversity)for(const pool of ['composition','color','lighting','rendering','narrative']){
    const group=groups.get(pool)??[];
    if(new Set(group.map(w=>w.function_key)).size<3||new Set(group.map(w=>w.artist_id)).size<3)errors.push({pool,error:'Need at least three distinct study functions and artists; no aesthetic score implied'});
  }
  return {status:errors.length?'FAIL':'PASS',checked:catalog.works?.length??0,errors};
}
function shuffle(items,seed){
  // Hash ordering is stable across Node versions, does not claim model seed control.
  return [...items].sort((a,b)=>sha256(seed+'\0'+a.id).localeCompare(sha256(seed+'\0'+b.id))||a.id.localeCompare(b.id));
}
export function sampleReferences(catalog,options){
  const {seed,roles=['composition','color','lighting'],mood='any',format='any',grammar='cel'}=options;
  const validRoles=['composition','color','lighting','rendering','narrative'];
  if(typeof seed!=='string'||!seed.length||seed.length>256)throw Error('A seed of 1–256 characters is required');
  if(!Array.isArray(roles)||roles.length<1||roles.length>3)throw Error('Choose one to three reference roles');
  if(new Set(roles).size!==roles.length||roles.some(r=>!validRoles.includes(r)))throw Error('Reference roles must be valid and unique');
  if(!['any','calm','dramatic','energetic','wonder','melancholic'].includes(mood))throw Error('Unknown mood');
  if(!['any','portrait','landscape','square'].includes(format))throw Error('Unknown format');
  if(!['cel','graphic','painterly'].includes(grammar))throw Error('Unknown grammar');
  const candidates=roles.map(role=>shuffle((catalog.works??[]).filter(w=>{
    try{checkEligibility(w);}catch{return false;}
    return w.pool===role&&w.visual_review?.status==='inspected'&&(mood==='any'||w.moods.includes(mood))&&
      (role!=='composition'||format==='any'||w.format===format)&&
      (!['lighting','rendering'].includes(role)||w.renderings.includes(grammar));
  }),seed+'\0'+role));
  if(candidates.some(c=>!c.length))throw Error('No candidate meets filters; broaden an explicit constraint, never silently fall back');
  function search(i,chosen){
    if(i===roles.length)return chosen;
    for(const w of candidates[i]){
      if(chosen.some(p=>p.id===w.id||p.artist_id===w.artist_id||p.function_key===w.function_key))continue;
      const conflicting=chosen.some(p=>['color','lighting'].includes(p.pool)&&['color','lighting'].includes(w.pool)&&!p.values.some(v=>w.values.includes(v)));
      if(conflicting)continue;
      const found=search(i+1,[...chosen,w]);if(found)return found;
    }
    return null;
  }
  const selected=search(0,[]);
  if(!selected)throw Error('No compatible distinct-artist set; filters are heuristics, not image quality guarantees');
  return selected;
}
export function auditPlan(plan,root){
  const errors=[];
  try{
    const bytes=fs.readFileSync(path.join(root,'catalog.json')),catalog=JSON.parse(bytes);
    if(sha256(bytes)!==plan.catalog_sha256)throw Error('Reference plan is stale: catalogue hash changed');
    if(!Array.isArray(plan.references)||plan.references.length<1||plan.references.length>3)throw Error('Missing or excessive planned references');
    const expected=sampleReferences(catalog,plan.options).map(w=>w.id);
    if(JSON.stringify(expected)!==JSON.stringify(plan.references.map(r=>r.id)))throw Error('Plan differs from recorded selection options');
    for(const r of plan.references){
      const w=catalog.works.find(x=>x.id===r.id);
      if(!w||w.pool!==r.role||w.file!==r.file||w.sha256!==r.sha256)throw Error('Missing or changed reference version: '+r.id);
      if(r.absolute_path!==undefined&&path.resolve(r.absolute_path)!==resolveInside(root,r.file))throw Error('Reference absolute path is stale after relocation: '+r.id);
      if(sha256(fs.readFileSync(resolveInside(root,r.file)))!==r.sha256)throw Error('Reference image hash changed: '+r.id);
    }
    const verification=verifyCatalog(catalog,root);
    if(verification.status!=='PASS')errors.push(...verification.errors);
  }catch(error){errors.push({error:error.message});}
  return {status:errors.length?'FAIL':'PASS',errors};
}
