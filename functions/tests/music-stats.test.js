import assert from 'node:assert/strict'
import test from 'node:test'
import { musicSummary } from '../../lib/musicStats.js'
import { onRequest } from '../api/stats/music.js'
const period = { plays: 1, listenedMs: 40000, artists: [{ name:'Artist',artist:'',plays:1,listenedMs:40000 }], albums:[],tracks:[] }
const summary = { through:'2026-01-01', ranges:{'7':period,'30':period,all:period},daily:[{day:'2026-01-01',plays:1,listenedMs:40000}] }
function database(){let row;return{prepare(sql){let args;return{bind(...value){args=value;return this},async run(){if(sql.startsWith('INSERT')&&(!row||args[0]>row.through))row={through:args[0],payload:args[1],received_at:args[2]}},async first(){return row}}}}}
function bucket(){let value;return{async put(key,body){value=body},async get(){return value?{size:value.length,text:async()=>value}:null}}}
const request=(method,body,token)=>new Request('https://leodeng.dev/api/stats/music',{method,headers:token?{Authorization:`Bearer ${token}`}:{},...(body?{body:JSON.stringify(body)}:{})})
test('summary ingest fails closed, strips private fields, and publishes a singleton daily snapshot',async()=>{
 const env={HOMELAB_DB:database(),HOMELAB_TOKEN:'secret',MEDIA:bucket()}
 assert.equal((await onRequest({env,request:request('POST',summary)})).status,401)
 assert.equal((await onRequest({env,request:request('POST',summary,'wrong')})).status,401)
 assert.equal((await onRequest({env:{HOMELAB_DB:env.HOMELAB_DB},request:request('POST',summary,'secret')})).status,503)
 assert.equal((await onRequest({env,request:request('POST',{...summary,rawEvents:['private-id']},'secret')})).status,200)
 const got=await(await onRequest({env,request:request('GET')})).json()
 assert.equal(got.state,'ready');assert.equal(got.ranges.all.plays,1);assert.doesNotMatch(JSON.stringify(got),/private-id|rawEvents|secret/)
 await onRequest({env,request:request('POST',{...summary,ranges:{...summary.ranges,all:{...period,plays:999}}},'secret')})
 assert.equal((await(await onRequest({env,request:request('GET')})).json()).ranges.all.plays,999,'live updates appear immediately')
 env.MEDIA.get=async()=>{throw new Error('R2 offline')}
 assert.equal((await(await onRequest({env,request:request('GET')})).json()).ranges.all.plays,1,'daily D1 fallback remains unchanged')
})
test('invalid summaries and oversized requests are rejected',async()=>{
 assert.throws(()=>musicSummary({...summary,daily:[...summary.daily,...summary.daily]}))
 assert.throws(()=>musicSummary({...summary,ranges:{...summary.ranges,all:{...period,plays:-1}}}))
 const env={HOMELAB_DB:database(),HOMELAB_TOKEN:'secret',MEDIA:bucket()}
 assert.equal((await onRequest({env,request:request('POST',{extra:'x'.repeat(200001)},'secret')})).status,413)
 assert.equal((await onRequest({env,request:request('POST',{...summary,through:'2999-01-01'},'secret')})).status,400)
})

test('today is included live while D1 receives only completed-day archive',async()=>{
 const env={HOMELAB_DB:database(),HOMELAB_TOKEN:'secret',MEDIA:bucket()}
 const today=new Date().toISOString().slice(0,10)
 const live={...summary,through:today,archive:summary}
 assert.equal((await onRequest({env,request:request('POST',live,'secret')})).status,200)
 const got=await(await onRequest({env,request:request('GET')})).json()
 assert.equal(got.through,today);assert.equal(got.live,true);assert.equal(got.ranges.all.plays,1)
 env.MEDIA.get=async()=>null
 const fallback=await(await onRequest({env,request:request('GET')})).json()
 assert.equal(fallback.through,summary.through);assert.equal(fallback.live,false)
})
