export async function safeEqual(left,right) {
  if (!left || !right) return false
  const digest = text => crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))
  const [a,b] = await Promise.all([digest(left),digest(right)])
  const x=new Uint8Array(a),y=new Uint8Array(b)
  let difference=0
  for(let i=0;i<x.length;i++) difference|=x[i]^y[i]
  return difference===0
}
export async function readBoundedJson(request,limit) {
  const reader=request.body?.getReader()
  if (!reader) throw Object.assign(new Error('Missing JSON body.'),{status:400})
  const chunks=[];let size=0
  while (true) {
    const {done,value}=await reader.read()
    if(done) break
    size+=value.length
    if(size>limit) {await reader.cancel();throw Object.assign(new Error('Content is too large.'),{status:413})}
    chunks.push(value)
  }
  const bytes=new Uint8Array(size);let offset=0
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}
  try {const data=JSON.parse(new TextDecoder().decode(bytes));if(!data||typeof data!=='object'||Array.isArray(data)) throw new Error();return data} catch {throw Object.assign(new Error('Invalid JSON.'),{status:400})}
}
