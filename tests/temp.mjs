import fs from 'node:fs';
import path from 'node:path';
import {after} from 'node:test';

export function scratchDirectory(parent,prefix='scratch-'){
  const base=path.resolve(parent);
  const directory=fs.mkdtempSync(path.join(base,prefix));
  after(()=>{
    const relative=path.relative(base,path.resolve(directory));
    if(relative.startsWith('..')||path.isAbsolute(relative)||!relative.startsWith('scratch-'))throw Error('Refusing unsafe scratch cleanup');
    fs.rmSync(directory,{recursive:true,force:true});
  });
  return directory;
}
