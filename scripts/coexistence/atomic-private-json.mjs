/** Callers validate the private D: destination before this atomic write.
 * Windows requires a writable descriptor for FlushFileBuffers/fsync.
 */
import {writeFileSync,openSync,fsyncSync,closeSync,renameSync,unlinkSync} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
export function atomicPrivateJson(file,value){
  const folder=path.dirname(path.resolve(file));
  const temporary=path.resolve(folder,`.${path.basename(file)}.${randomUUID()}.tmp`);
  if(path.dirname(temporary)!==folder)throw new Error('invalid_checkpoint_path');
  let renamed=false;
  try{
    const fd=openSync(temporary,'wx',0o600);
    try{writeFileSync(fd,JSON.stringify(value,null,2),'utf8');fsyncSync(fd);}finally{closeSync(fd);}
    renameSync(temporary,file);renamed=true;
  }finally{
    if(!renamed){try{unlinkSync(temporary);}catch{/* Preserve the original write failure. */}}
  }
}
