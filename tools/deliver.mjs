import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {renderV2Gallery,renderV3Gallery} from './gallery-v2.mjs';

export const ORDER = ['brief', 'composition', 'lineart', 'flat', 'lighting', 'refine', 'consistency'];
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let RUN = path.join(ROOT, 'demo-postal-girl');
let FILE = path.join(RUN, 'project.json');
const utf8 = p => fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '');
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
const json = p => JSON.parse(utf8(p));
const escape = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const read = () => json(FILE);
const order = state => state.stage_order ?? ORDER;
export function validateReferences(state, artifact) {
  for (const reference of artifact.references ?? []) {
    const source=state.artifacts[reference.id];
    if(!source?.file)throw Error('Reference missing: '+reference.id);
    if(source.stale)throw Error('Reference stale: '+reference.id);
    if(!source.qa || source.qa.hard_fail.length || (state.schema_version>=2 && source.qa.structure_check?.status!=='pass'))throw Error('Reference fails QA: '+reference.id);
    if(reference.sha256!==source.sha256)throw Error('Reference hash changed: '+reference.id);
  }
}
function prepare(state,id) {
  const a=state.artifacts[id];
  if(!a||a.file||a.stale)throw Error('Prepare requires an ungenerated current candidate');
  ready(state,a.stage);
  a.references=(a.reference_specs??[]).map(spec=>{
    const sourceId=spec.id??state.stages[spec.stage]?.selection?.id;
    const source=state.artifacts[sourceId];
    if(!source?.file)throw Error('Reference missing: '+(sourceId??spec.stage));
    return {id:sourceId,role:spec.role,sha256:source.sha256,file:source.file};
  });
  validateReferences(state,a);
  for(const ref of a.references)if(hash(fs.readFileSync(path.join(RUN,ref.file)))!==ref.sha256)throw Error('Reference file/hash mismatch');
  a.parent=a.references.find(ref=>ref.role==='edit_target')?.id??a.references[0]?.id??null;
  a.prepared_at=new Date().toISOString();
  write(state,{action:'prepare',id,references:a.references,prompt_sha256:a.prompt_sha256});
  console.log(JSON.stringify({id,prompt:a.prompt,references:a.references.map(ref=>({...ref,path:path.join(RUN,ref.file)}))},null,2));
}
function write(state, event) {
  state.updated_at = new Date().toISOString();
  fs.writeFileSync(FILE, JSON.stringify(state, null, 2) + '\n');
  fs.appendFileSync(path.join(RUN, 'events.jsonl'), JSON.stringify({time:state.updated_at,...event}) + '\n');
}
export function ready(state, stage) {
  if (stage === 'baseline') return;
  const sequence=order(state);
  const i = sequence.indexOf(stage);
  if (i < 0) throw Error('Unknown stage: ' + stage);
  if (i === 0) return;
  const previous = state.stages[sequence[i-1]];
  const chosen = previous?.selection;
  if (!chosen || chosen.stale) throw Error('Previous stage has no current selection: ' + sequence[i-1]);
  const selectedArtifact=state.artifacts[chosen.id];
  if(!selectedArtifact||selectedArtifact.stale||selectedArtifact.qa?.hard_fail.length)throw Error('Previous selection no longer passes QA');
  if (state.mode === 'review' && chosen.selected_by !== 'human') throw Error('Review mode requires human selection');
  if(state.schema_version>=2)for(const earlier of sequence.slice(0,i)){
    const selection=state.stages[earlier].selection;
    const a=state.artifacts[selection?.id];
    if(!selection||selection.stale||!a||a.stale||a.qa?.hard_fail.length||a.qa?.structure_check?.status!=='pass')throw Error('Upstream selection fails QA: '+earlier);
    if(state.mode==='review'&&selection.selected_by!=='human')throw Error('Review mode requires human selection');
    validateReferences(state,a);
  }
}
export function choose(state, stage, id, reason, humanEvidence = null) {
  ready(state, stage);
  const entry = state.stages[stage];
  if (!entry || !entry.candidates.includes(id)) throw Error('Candidate does not belong to this stage');
  const artifact = state.artifacts[id];
  if (!artifact || artifact.stale) throw Error('Candidate is missing or stale');
  if (artifact.kind === 'image' && (!artifact.file || !artifact.qa || artifact.qa.hard_fail.length)) throw Error('Candidate needs a real image and reviewed QA without hard failures');
  if(state.schema_version>=2&&artifact.qa?.structure_check?.status!=='pass')throw Error('Candidate structure must pass explicit review');
  validateReferences(state,artifact);
  if (state.mode === 'review' && !humanEvidence?.trim()) throw Error('Explicit human selection evidence required');
  if (!reason?.trim()) throw Error('Selection reason required');
  const previous = entry.selection?.id;
  entry.selection = {id,reason,selected_by:state.mode === 'demo' ? 'agent_demo':'human',human_evidence:humanEvidence,stale:false,time:new Date().toISOString()};
  if (previous && previous !== id) {
    for (const later of order(state).slice(order(state).indexOf(stage)+1)) {
      const group = state.stages[later];
      if (group.selection) group.selection.stale = true;
      for (const candidate of group.candidates) state.artifacts[candidate].stale = true;
    }
  }
  if(state.schema_version>=2&&(state.anchor_stages??['pose','detail','scene','flat']).includes(stage)){
    state.anchors??={};state.anchors[stage]={id,sha256:artifact.sha256,style_version:state.style_version};
  }
  return entry.selection;
}
function init(demo = false,recipePath = path.join(ROOT,'tools','recipes.json')) {
  if (fs.existsSync(FILE)) throw Error('Run already exists; init never overwrites it');
  const recipes = json(recipePath);
  const state = {schema_version:1,asset_id:'NEW_CHARACTER',mode:demo?'demo':'review',status:'in_progress',style_version:'STYLE_001',model:'UNKNOWN_BUILTIN',tool:'built-in image_gen',planned_images:14,repair_limit:2,attributes:[],purpose:'单张角色插画',retouch:'尚未记录人工修绘',stages:{},artifacts:{}};
  if(recipes.schema_version>=2)Object.assign(state,{schema_version:2,stage_order:recipes.stage_order,asset_id:'NEW_CHARACTER',style_version:'STYLE_002',planned_images:recipes.planned_images,repair_limit:recipes.repair_limit,candidate_count:1,anchors:{},user_v1_assessment:null,authorization:demo?'Explicit demo mode; caller must verify current authorization':null});
  if(recipes.schema_version>=2){
    for(const key of ['asset_id','display_title','style_version','workflow','anchor_stages','user_assessment','attributes','purpose','retouch','user_v1_assessment'])if(recipes[key]!==undefined)state[key]=recipes[key];
    if(recipes.demo_authorization)state.authorization=demo?recipes.demo_authorization:null;
  }
  if(!Array.isArray(order(state))||new Set(order(state)).size!==order(state).length||order(state).some(s=>!/^\w+$/.test(s)))throw Error('Invalid stage order');
  for (const stage of (state.schema_version>=2?order(state):['baseline',...ORDER])) state.stages[stage] = {candidates:[],selection:null};
  fs.mkdirSync(path.join(RUN,'prompts'),{recursive:true});
  fs.mkdirSync(path.join(RUN,'images'),{recursive:true});
  fs.mkdirSync(path.join(RUN,'qa'),{recursive:true});
  for (const recipe of recipes.candidates) {
    const prompt = recipe.prompt || [recipes.common,recipe.instructions].filter(Boolean).join('\n\n');
    if(!state.stages[recipe.stage]||!/^[A-Z][A-Z0-9_]{1,40}$/.test(recipe.id)||state.artifacts[recipe.id])throw Error('Invalid candidate');
    const artifact = {...recipe,prompt,style_version:state.style_version,stale:false,file:null,qa:null};
    state.artifacts[recipe.id] = artifact;
    state.stages[recipe.stage].candidates.push(recipe.id);
    fs.writeFileSync(path.join(RUN,'prompts',recipe.id+'.txt'),prompt+'\n');
    artifact.prompt_file = 'prompts/'+recipe.id+'.txt';
    artifact.prompt_sha256 = hash(fs.readFileSync(path.join(RUN,artifact.prompt_file)));
  }
  write(state,{action:'init',authorization:demo?'Explicit demo flag; agent must verify current user authorization for this run':'Default review mode; awaiting explicit human choices'});
  if(demo && state.schema_version===1) {
    choose(state,'brief','BRIEF_A','Legacy demo selects the first example brief; not a human approval.');
    choose(state,'composition','COMP_B','Legacy demo selects the second example composition; inspect actual output separately.');
    write(state,{action:'select_text',ids:['BRIEF_A','COMP_B'],selected_by:'agent_demo'});
  }
  console.log(JSON.stringify({run:RUN,planned_images:state.planned_images}));
}
function ingest(state, id, source) {
  const artifact = state.artifacts[id];
  if (!artifact || artifact.kind !== 'image') throw Error('Unknown image candidate');
  ready(state,artifact.stage);
  if(state.schema_version>=2&&!artifact.prepared_at)throw Error('Prepare references before generation');
  validateReferences(state,artifact);
  if (artifact.file) throw Error('Already ingested; use a new candidate ID for revisions');
  const resolved = path.resolve(source);
  const data = fs.readFileSync(resolved);
  if (data.length < 24 || data.toString('hex',0,8) !== '89504e470d0a1a0a') throw Error('Expected actual PNG output');
  const target = path.join(RUN,'images',id+'.png');
  fs.copyFileSync(resolved,target,fs.constants.COPYFILE_EXCL);
  artifact.file = 'images/'+id+'.png';
  artifact.source_file = resolved;
  artifact.sha256 = hash(data);
  artifact.source_sha256 = artifact.sha256;
  artifact.width = data.readUInt32BE(16);
  artifact.height = data.readUInt32BE(20);
  artifact.bytes = data.length;
  artifact.model = 'UNKNOWN_BUILTIN';
  artifact.generation_prompt_sha256 = hash(Buffer.from(artifact.prompt,'utf8'));
  artifact.generated_at = new Date().toISOString();
  if (artifact.parent === 'selected_previous') {
    const prior = order(state)[order(state).indexOf(artifact.stage)-1];
    artifact.parent = state.stages[prior].selection.id;
  }
  write(state,{action:'ingest',id,parent:artifact.parent,references:artifact.references,sha256:artifact.sha256,source:resolved});
  console.log(JSON.stringify({id,file:target,width:artifact.width,height:artifact.height,sha256:artifact.sha256}));
}
function verify(state) {
  const errors=[];
  const actual=Object.values(state.artifacts).filter(a=>a.kind==='image'&&a.file);
  for (const a of actual) {
    const p=path.join(RUN,a.file);
    if (!fs.existsSync(p)||hash(fs.readFileSync(p))!==a.sha256) errors.push(a.id+': file/hash mismatch');
    if (!a.qa) errors.push(a.id+': no visual QA');
    if (hash(fs.readFileSync(path.join(RUN,a.prompt_file)))!==a.prompt_sha256) errors.push(a.id+': prompt/hash mismatch');
    if (a.generation_prompt_sha256 && hash(Buffer.from(a.prompt,'utf8'))!==a.generation_prompt_sha256) errors.push(a.id+': generation prompt changed');
    if (a.parent && (!state.artifacts[a.parent] || (state.artifacts[a.parent].kind==='image'&&!state.artifacts[a.parent].file))) errors.push(a.id+': missing parent');
    if(!a.stale)try{validateReferences(state,a);}catch(error){errors.push(a.id+': '+error.message);}
    if(state.schema_version>=2&&!a.prepared_at)errors.push(a.id+': inputs were not prepared');
  }
  for (const stage of order(state)) {
    const selected=state.stages[stage].selection;
    if (!selected || selected.stale) errors.push(stage+': no current selection');
    else if (state.mode==='demo'&&selected.selected_by!=='agent_demo') errors.push(stage+': false human approval');
    else if(state.artifacts[selected.id].qa?.hard_fail.length)errors.push(stage+': selected image fails current QA');
    else if(state.schema_version>=2&&state.artifacts[selected.id].qa?.structure_check?.status!=='pass')errors.push(stage+': structure review incomplete');
    else if(state.mode==='review'&&(selected.selected_by!=='human'||!selected.human_evidence?.trim()))errors.push(stage+': no human evidence');
  }
  const repairs=actual.filter(a=>a.repair_of).length;
  if(actual.length!==state.planned_images+repairs||repairs>state.repair_limit) errors.push('Image count or repair budget mismatch');
  for(const comparison of state.imported_comparisons??[]){
    const p=path.join(RUN,comparison.file);
    if(!fs.existsSync(p)||hash(fs.readFileSync(p))!==comparison.sha256||comparison.source_sha256!==comparison.sha256||comparison.used_for_generation!==false)errors.push('Imported comparison mismatch: '+comparison.id);
  }
  if(!fs.existsSync(path.join(RUN,'index.html'))) errors.push('Missing comparison page');
  if(!fs.existsSync(path.join(RUN,'REPORT.md'))) errors.push('Missing assessment and retouch report');
  const result={technical_status:errors.length?'INCOMPLETE':'PASS',actual_images:actual.length,planned_images:state.planned_images,repair_images:repairs,errors,artistic_approval:'NOT_HUMAN_APPROVED',note:'Hash/file/prompt checks do not prove aesthetic improvement or layered source availability'};
  if(state.schema_version>=2)result.imported_comparisons=(state.imported_comparisons??[]).length;
  fs.writeFileSync(path.join(RUN,'verification.json'),JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result,null,2));
  if(errors.length) process.exitCode=1;
  return result;
}
function render(state) {
  if(state.schema_version>=2){fs.writeFileSync(path.join(RUN,'index.html'),state.workflow==='direct_first'?renderV3Gallery(state):renderV2Gallery(state));console.log(path.join(RUN,'index.html'));return;}
  const section=(name,title)=>{
    const group=state.stages[name];
    return `<section id="${name}"><h2>${title}</h2><div class="grid">${group.candidates.map(id=>{
      const a=state.artifacts[id],chosen=group.selection?.id===id&&!group.selection?.stale;
      return `<article class="${chosen?'chosen':''}"><div class="cardhead"><span>${escape(id)}</span>${chosen?'<b>代理试验选择</b>':''}</div>${a.file?`<a href="${a.file}" target="_blank"><img loading="lazy" src="${a.file}" alt="${escape(a.label)}"></a>`:'<div class="pending">'+(a.kind==='text'?'文字方案':'待生成')+'</div>'}<h3>${escape(a.label)}</h3><p>${escape(a.description)}</p>${a.qa?`<p class="qa">${escape(a.qa.observations.join('；'))}</p>`:''}${chosen?`<p class="reason">选择理由：${escape(group.selection.reason)}</p>`:''}<details><summary>完整提示词 / 方案</summary><pre>${escape(a.prompt)}</pre></details>${a.file?`<p class="meta">${a.width}×${a.height} · <a href="${a.file}" download>下载原图</a> · <a href="${a.prompt_file}">提示词</a></p>`:''}</article>`;
    }).join('')}</div></section>`;
  };
  const last=state.stages.refine.selection?.id;
  const compare=last&&state.artifacts.BASELINE.file?`<section id="comparison"><h2>直接生成与分阶段结果</h2><div class="compare"><figure><img src="${state.artifacts.BASELINE.file}"><figcaption>直接生成基线</figcaption></figure><figure><img src="${state.artifacts[last].file}"><figcaption>分阶段最终候选 · ${escape(last)}</figcaption></figure></div><p>这是一次探索性比较，构图和背景复杂度可能不同，后台参数未获验证；不能据此声称流程普遍优于直接生成。</p></section>`:'';
  const html=`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(state.display_title??state.asset_id)} · 角色插画工作流</title><style>:root{color-scheme:light;--ink:#20384d;--muted:#647b8e;--blue:#316f9b}*{box-sizing:border-box}body{margin:0;background:#eff4f8;color:var(--ink);font:16px/1.7 system-ui,'Microsoft YaHei',sans-serif}header{padding:48px 6vw 32px;background:#18364d;color:white}header small{letter-spacing:.16em;color:#c0d9ea}h1{font-size:clamp(28px,4vw,48px);margin:8px 0}header p{max-width:850px;color:#dce8f0}nav{display:flex;flex-wrap:wrap;gap:10px;margin:24px 0 0}nav a{color:white;text-decoration:none;border:1px solid #7894a8;border-radius:20px;padding:5px 14px}main{max-width:1500px;margin:auto;padding:16px 4vw 64px}section{scroll-margin-top:24px;margin-top:40px}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px}article{background:white;border:1px solid #dce5ec;border-radius:14px;overflow:hidden;padding-bottom:16px;box-shadow:0 8px 25px #16395508}article.chosen{border:2px solid var(--blue)}.cardhead{display:flex;justify-content:space-between;padding:12px 16px;font-size:12px;letter-spacing:.03em}.cardhead b{background:#e3eff7;color:var(--blue);padding:0 8px;border-radius:4px}article img{display:block;width:100%;height:470px;object-fit:contain;background:#fafafa}article h3,article p,article details{margin:12px 18px}h3{font-size:18px}.qa,.meta{font-size:13px;color:var(--muted)}.reason{font-size:14px;border-left:3px solid #6d9abb;padding-left:10px}.pending{padding:22px 18px;background:#f2f6f9;color:var(--muted)}pre{white-space:pre-wrap;word-break:break-word;font:13px/1.7 inherit}summary{cursor:pointer;color:var(--blue)}a{color:var(--blue)}.compare{display:grid;grid-template-columns:1fr 1fr;gap:24px}.compare figure{margin:0;background:white;border-radius:12px;padding:16px;text-align:center}.compare img{max-width:100%;height:700px;object-fit:contain}.notice{padding:16px 22px;background:#e1edf5;border-radius:10px}footer{font-size:13px;color:var(--muted);margin-top:36px}@media(max-width:900px){.grid{grid-template-columns:1fr 1fr}article img{height:420px}.compare img{height:480px}}@media(max-width:600px){.grid{grid-template-columns:1fr}.compare{gap:10px;grid-template-columns:repeat(2,minmax(0,1fr))}.compare figure{padding:8px}.compare img{width:100%;height:auto;max-height:480px}.compare figcaption{font-size:12px}header{padding-top:28px}article img{height:500px}}</style></head><body><header><small>CHARACTER ILLUSTRATION WORKFLOW / DEMO</small><h1>${escape(state.display_title??state.asset_id)}</h1><p>${escape(state.purpose)}。按项目记录浏览各阶段候选；选择来源以项目状态为准。</p><nav>${[['comparison','最终比较'],['brief','角色'],['composition','构图'],['lineart','线稿'],['flat','平涂'],['lighting','光影'],['refine','精修'],['consistency','复用']].map(([a,b])=>`<a href="#${a}">${b}</a>`).join('')}</nav></header><main><p class="notice">当前批次：代理试验选择，尚未人工定稿。点击图片查看原图。<a href="REPORT.md">查看评估与修绘报告</a> · <a href="project.json">项目状态</a> · <a href="verification.json">技术验证</a></p>${compare}${section('brief','01 / 属性扩展')}${section('composition','02 / 提示词与构图')}${section('lineart','03 / 线稿')}${section('flat','04A / 平涂')}${section('lighting','04B / 光影')}${section('refine','05 / 风格检查与精修')}${section('consistency','06 / 不同构图复用检验')}${section('baseline','直接生成基线')}<footer>全部图片为实际生成输出，记录后台模型为 UNKNOWN_BUILTIN。未制作可编辑分层源文件；审美改善需要人工判断。记录更新时间：${escape(state.updated_at)}</footer></main></body></html>`;
  fs.writeFileSync(path.join(RUN,'index.html'),html);
  console.log(path.join(RUN,'index.html'));
}
export function main(args) {
  const runIndex=args.indexOf('--run');
  if(runIndex>=0){
    if(!args[runIndex+1])throw Error('--run requires a directory');
    RUN=path.resolve(ROOT,args[runIndex+1]);
    if(RUN===ROOT||!RUN.startsWith(ROOT+path.sep))throw Error('Run must stay inside the project workspace');
    FILE=path.join(RUN,'project.json');args=[...args.slice(0,runIndex),...args.slice(runIndex+2)];
  }
  const [command,id,...rest]=args;
  if(command==='init'){const recipeIndex=args.indexOf('--recipe');return init(args.includes('--demo'),recipeIndex>=0?path.resolve(args[recipeIndex+1]):undefined);}
  const state=read();
  if(command==='prepare')return prepare(state,id);
  if(command==='prompt') {
    const a=state.artifacts[id]; if(!a) throw Error('Unknown candidate');
    ready(state,a.stage);
    if(state.schema_version>=2&&!a.prepared_at)throw Error('Prepare inputs first');
    validateReferences(state,a);
    process.stdout.write(a.prompt);return;
  }
  if(command==='ingest') return ingest(state,id,rest[0]);
  if(command==='add') {
    const recipe=json(id);
    if(!/^[A-Z][A-Z0-9_]{1,40}$/.test(recipe.id)||state.artifacts[recipe.id]||recipe.kind!=='image'||!recipe.repair_of||!state.artifacts[recipe.repair_of]?.file||!recipe.prompt?.trim()||recipe.stage!==state.artifacts[recipe.repair_of].stage)throw Error('A repair needs a new safe ID, actual parent image in the same stage and complete prompt');
    if(Object.values(state.artifacts).filter(a=>a.repair_of).length>=state.repair_limit)throw Error('Repair budget exhausted');
    ready(state,recipe.stage);
    const a={...recipe,style_version:state.style_version,stale:false,file:null,qa:null,prompt_file:'prompts/'+recipe.id+'.txt'};
    fs.writeFileSync(path.join(RUN,a.prompt_file),a.prompt+'\n');a.prompt_sha256=hash(fs.readFileSync(path.join(RUN,a.prompt_file)));
    state.artifacts[a.id]=a;state.stages[a.stage].candidates.push(a.id);write(state,{action:'add_repair',id:a.id,repair_of:a.repair_of});return;
  }
  if(command==='set-prompt') {
    const a=state.artifacts[id];
    if(!a||a.file)throw Error('Only an ungenerated candidate prompt can be revised');
    const next=utf8(rest[0]).trim();if(!next)throw Error('Empty prompt');
    const old=a.prompt_sha256;
    const archive='prompts/'+id+'-previous-'+old.slice(0,12)+'.txt';
    if(!fs.existsSync(path.join(RUN,archive)))fs.copyFileSync(path.join(RUN,a.prompt_file),path.join(RUN,archive));
    a.prompt=next;fs.writeFileSync(path.join(RUN,a.prompt_file),next+'\n');a.prompt_sha256=hash(fs.readFileSync(path.join(RUN,a.prompt_file)));
    if(state.schema_version>=2){delete a.prepared_at;a.references=[];a.parent=null;}
    write(state,{action:'revise_prompt',id,previous_prompt:archive,previous_sha256:old,new_sha256:a.prompt_sha256});return;
  }
  if(command==='qa') {
    const a=state.artifacts[id],qa=json(rest[0]);
    if(!a?.file||!Array.isArray(qa.hard_fail)||!Array.isArray(qa.observations)||!Array.isArray(qa.manual_retouch)) throw Error('QA requires image and arrays hard_fail/observations/manual_retouch');
    if(state.schema_version>=2&&!['pass','fail','uncertain'].includes(qa.structure_check?.status))throw Error('QA needs explicit structure_check status');
    a.qa={...qa,reviewed_by:'agent',reviewed_at:new Date().toISOString()};
    fs.writeFileSync(path.join(RUN,'qa',id+'.json'),JSON.stringify(a.qa,null,2)+'\n');
    write(state,{action:'visual_qa',id,qa:a.qa});return;
  }
  if(command==='select') {
    const [candidate,reason,evidencePath]=rest;
    const selection=choose(state,id,candidate,reason,evidencePath?utf8(evidencePath):null);
    write(state,{action:'select',stage:id,...selection});console.log(JSON.stringify(selection));return;
  }
  if(command==='status') {console.log(JSON.stringify({status:state.status,images:Object.values(state.artifacts).filter(a=>a.file).length,selections:Object.fromEntries(Object.entries(state.stages).map(([k,v])=>[k,v.selection?.id??null]))},null,2));return;}
  if(command==='render') return render(state);
  if(command==='verify') return verify(state);
  if(command==='finish') {
    const result=verify(state);if(result.errors.length)return;
    state.status='trial_complete_human_review_pending';state.final_candidate=state.stages.refine.selection.id;state.human_approved=false;
    state.visual_results={aesthetic_improvement:'NOT_ESTABLISHED',manual_retouch_performed:false};
    if(state.stages.consistency)state.visual_results.cross_composition_equipment_match=state.artifacts[state.stages.consistency.selection.id].qa.equipment_match??'UNRATED';
    write(state,{action:'finish',status:state.status,final_candidate:state.final_candidate,human_approved:false});render(state);return;
  }
  if(command==='block'){state.status='incomplete_structure_or_service';write(state,{action:'stop',reason:[id,...rest].join(' ')});return render(state);}
  throw Error('Commands: init, prepare, prompt, add, set-prompt, ingest, qa, select, status, render, verify, finish, block');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {main(process.argv.slice(2));} catch(e){console.error(e.message);process.exitCode=1;}
}
