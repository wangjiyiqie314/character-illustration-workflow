import {scratchDirectory} from './temp.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {renderV2Gallery,renderV3Gallery} from '../tools/gallery-v2.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
function fixture(direct=true){
  const stages=direct?['composition','direct','lineart','flat','lighting','refine']:['pose','refine'];
  return {asset_id:'NEW_CHARACTER',display_title:'独立角色 <试验>',mode:'review',status:'in_progress',repair_limit:1,
    stage_order:stages,stages:Object.fromEntries(stages.map(s=>[s,{candidates:[s],selection:{id:s,stale:false,reason:'fixture'}}])),
    artifacts:Object.fromEntries(stages.map(s=>[s,{id:s,stage:s,file:`images/${s}.png`,label:s,prompt:'Synthetic fixture',prompt_file:`prompts/${s}.txt`,width:2,height:2,references:[]}]))};
}
test('direct-first gallery identifies the actual character and extra stage',()=>{
  const html=renderV3Gallery(fixture());
  assert.match(html,/<title>独立角色 &lt;试验&gt;/);
  assert.match(html,/<section id="composition">/);
  assert.doesNotMatch(html,/邮差少女|POSTAL GIRL|前两轮资料/);
});
test('from-scratch gallery does not invent imported comparison images',()=>{
  const state=fixture(false);const html=renderV2Gallery(state);
  assert.match(html,/<title>独立角色 &lt;试验&gt;/);
  assert.doesNotMatch(html,/comparisons\/V1_|邮差少女/);
});
test('CLI initializes a new recipe without inheriting historical identity or approval',()=>{
  const scratch=scratchDirectory(path.join(root,'tests'),'scratch-release-');
  const recipe=path.join(scratch,'recipe.json');
  fs.writeFileSync(recipe,JSON.stringify({schema_version:2,display_title:'独立角色',stage_order:['pose'],planned_images:1,repair_limit:0,candidates:[{id:'POSE',stage:'pose',kind:'image',prompt:'Synthetic test',reference_specs:[]}]}));
  const run=path.join(scratch,'run');
  const result=spawnSync(process.execPath,['tools/deliver.mjs','--run',run,'init','--recipe',recipe],{cwd:root,encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  const state=JSON.parse(fs.readFileSync(path.join(run,'project.json'),'utf8'));
  assert.deepEqual(state.attributes,[]);
  assert.equal(state.display_title,'独立角色');
  assert.equal(state.user_v1_assessment,null);
  assert.equal(state.authorization,null);
  assert.equal(state.mode,'review');
});
