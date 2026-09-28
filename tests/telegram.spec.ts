import { test, expect } from '@playwright/test'
import postgres from 'postgres'
import { createTestAccount, createTestGathering, withServerOnlyShim, TEST_BASE_URL, type TestAccount, type TestGathering } from './helpers/gathering'
import type { TelegramApi } from '../src/lib/telegram/api'
import type { TelegramUpdate, TelegramJob } from '../src/lib/telegram/types'

const base=TEST_BASE_URL
let raw: postgres.Sql, gathering: TestGathering, owner: TestAccount, member: TestAccount
let settings: typeof import('../src/lib/telegram/settings'), inbound: typeof import('../src/lib/telegram/inbound'), jobs: typeof import('../src/lib/telegram/jobs'), answers: typeof import('../src/lib/telegram/answer'), errors: typeof import('../src/lib/telegram/api'), aead: typeof import('../src/lib/secrets/aead')
const hits: { method:string; body:Record<string,unknown> }[]=[]
const token='12345678:abcdefghijklmnopqrstuvwxyz123456'
let updateId=1, nextMessage=500, hook='', secret='', fail:'rate'|'uncertain'|null=null
const fake:TelegramApi=async <T>(_token:string,method:string,body:Record<string,unknown>={})=>{
  hits.push({method,body})
  if (method==='getMe') return {id:12345678,is_bot:true,username:'GatheringTestBot'} as T
  if (method==='getWebhookInfo') return {url:hook} as T
  if (method==='setWebhook') {hook=String(body.url);secret=String(body.secret_token);return true as T}
  if (method==='deleteWebhook') {hook='';return true as T}
  if (method==='getChatMember') return {status:'administrator',can_post_messages:true} as T
  if (method==='sendMessage' && fail) {
    const mode=fail;fail=null
    throw new errors.TelegramError(mode==='rate' ? 'Telegram rate limit':'Telegram did not confirm the request',mode==='rate' ? 1:0,mode==='uncertain')
  }
  return (method==='sendMessage' ? {message_id:nextMessage++}:true) as T
}
function update(text:string, privateChat=false, user=12345):TelegramUpdate {
  return {update_id:updateId++,message:{message_id:updateId,date:Math.floor(Date.now()/1000),text,chat:{id:privateChat ? user:-10099,type:privateChat ? 'private':'supergroup',title:'Test gathering chat'},from:{id:user}}}
}
const bot=async()=> (await settings.loadBot(gathering.id))!
const api=async(path:string,method='GET',person:TestAccount|null=owner,body?:unknown,origin=base)=> fetch(base+path,{method,headers:{origin,...(person ? {cookie:person.cookie}:{}),...(body ? {'content-type':'application/json'}:{})},...(body ? {body:JSON.stringify(body)}:{})})
const path=()=>`/api/v1/events/${gathering.slug}/admin/telegram`
const memberPath=()=>`/api/v1/events/${gathering.slug}/telegram`
const run=()=>jobs.runTelegramJobs({eventId:gathering.id,api:fake,limit:10})

test.describe.configure({mode:'serial',retries:0})
test.beforeAll(async()=>{
  test.skip(!/localhost|127\.0\.0\.1/.test(process.env.DATABASE_MIGRATION_URL || '') || !/localhost|127\.0\.0\.1/.test(process.env.PDS_INTERNAL_URL || process.env.PDS_URL || ''), 'Requires the isolated local stack')
  raw=postgres(process.env.DATABASE_MIGRATION_URL!,{max:2,onnotice:()=>{}})
  await withServerOnlyShim(()=>{
    settings=require('../src/lib/telegram/settings');inbound=require('../src/lib/telegram/inbound');jobs=require('../src/lib/telegram/jobs');answers=require('../src/lib/telegram/answer');errors=require('../src/lib/telegram/api');aead=require('../src/lib/secrets/aead')
  })
  gathering=await createTestGathering(raw,{tag:'telegram',status:'published',visibility:'public'})
  owner=await createTestAccount('tg-owner',{sql:raw});member=await createTestAccount('tg-member',{sql:raw})
  await raw`insert into event_members(event_id,user_id,role) values(${gathering.id},${owner.id},'owner'),(${gathering.id},${member.id},'attendee')`
  await raw`update profiles set onboarding_completed=true where id in (${owner.id},${member.id})`
  await raw`update events set feed_posts=true where id=${gathering.id}`
})
test.afterAll(async()=>{await gathering?.cleanup();await owner?.cleanup();await member?.cleanup();await raw?.end()})
test.beforeEach(async()=>{hits.length=0;fail=null})

test('requires organizer access and same-origin mutations; webhook rejects guesses',async()=>{
  expect((await api(path(),'GET',null)).status).toBe(401)
  expect((await api(path(),'GET',member)).status).toBe(403)
  expect((await api(path(),'POST',owner,{action:'pair'},'https://elsewhere.test')).status).toBe(403)
  expect((await fetch(`${base}/api/telegram/${gathering.id}`,{method:'POST',body:'{}'})).status).toBe(404)
  await raw`update events set visibility='private' where id=${gathering.id}`
  expect((await api(path(),'GET',null)).status).toBe(404)
  await raw`update events set visibility='public' where id=${gathering.id}`
})

test('connects dedicated bot, seals secrets, pairs a chat, requires confirmation and an event AI key',async()=>{
  hook='https://other.example/webhook'
  await expect(settings.connectBot(gathering.id,owner.id,token,fake)).rejects.toThrow('already connected elsewhere')
  hook=''
  await settings.connectBot(gathering.id,owner.id,token,fake)
  expect(settings.botToken(await bot())).toBe(token)
  expect(Buffer.from((await bot()).token_ciphertext).toString()).not.toContain(token)
  const state=await (await api(path())).json()
  expect(JSON.stringify(state)).not.toContain(token)
  expect(JSON.stringify(state)).not.toContain(secret)
  const pairing=await settings.issuePairing(gathering.id)
  await inbound.acceptUpdate(await bot(),update(pairing.command))
  expect((await bot()).chat_id).toBeNull()
  expect((await bot()).pending_chat?.id).toBe('-10099')
  await settings.confirmChat(gathering.id,'-10099',fake)
  expect((await bot()).chat_id).toBe('-10099')
  expect((await bot()).announcements).toBe(false)
  const switches={announcements:true,ask_enabled:true,group_answers:true,daily_limit:100}
  await expect(settings.updateBot(gathering.id,switches)).rejects.toThrow('AI key')
  await raw`insert into event_ai_settings(event_id,provider,key_ciphertext,key_last4,model) values(${gathering.id},'anthropic',${aead.seal('test-provider-key',gathering.id)},'key1','test-model')`
  await settings.updateBot(gathering.id,switches)
})

test('mirrors future posted announcements once, strips Telegram pings, and retracts deleted posts',async()=>{
  await raw`insert into feed_posts(event_id,kind,subject_key,status,text,created_at) values(${gathering.id},'gathering-published','old','posted','Old post',now()-interval '1 day')`
  const [post]=await raw`insert into feed_posts(event_id,kind,subject_key,status,text,embed) values(${gathering.id},'schedule-published','fresh','posted','Hello @somebody.bsky.social',${raw.json({external:{uri:'https://unconference.events/schedule'}})}) returning id`
  await run();await run()
  const sends=hits.filter(h=>h.method==='sendMessage')
  expect(sends).toHaveLength(1)
  expect(sends[0].body.text).toContain('somebody.bsky.social')
  expect(sends[0].body.text).not.toContain('@')
  await raw`update feed_posts set status='deleted' where id=${post.id}`
  await run();await run()
  expect(hits.filter(h=>h.method==='deleteMessage')).toHaveLength(1)
})

test('retries explicit rate limits but never replays ambiguous sends automatically',async()=>{
  const [post]=await raw`insert into feed_posts(event_id,kind,subject_key,status,text) values(${gathering.id},'schedule-digest','retry','posted','New sessions') returning id`
  fail='rate';await run()
  expect((await raw`select status from telegram_jobs where feed_post_id=${post.id}`)[0].status).toBe('queued')
  await raw`update telegram_jobs set run_after=now() where feed_post_id=${post.id}`
  fail='uncertain';await run();await run()
  expect((await raw`select status from telegram_jobs where feed_post_id=${post.id}`)[0].status).toBe('uncertain')
  expect(hits.filter(h=>h.method==='sendMessage')).toHaveLength(2)
  const connected=await bot()
  for (let i=0;i<2;i++) await raw`insert into telegram_jobs(event_id,connection_id,kind,chat_id,response_ciphertext)
    values(${gathering.id},${connected.id},'notice','-10099',${aead.seal('Queued notice',`telegram-message:${gathering.id}`)})`
  let active=0,peak=0
  const slow:TelegramApi=async <T>(key:string,method:string,body?:Record<string,unknown>)=>{
    active++;peak=Math.max(peak,active)
    await new Promise(resolve=>setTimeout(resolve,30))
    try {return await fake<T>(key,method,body)} finally {active--}
  }
  await Promise.all([jobs.runTelegramJobs({eventId:gathering.id,api:slow,limit:1}),jobs.runTelegramJobs({eventId:gathering.id,api:slow,limit:1})])
  expect(peak).toBe(1)
  await run()
})

test('links only once through a personal token; ignores ordinary chat and deduplicates directed requests',async()=>{
  const res=await api(memberPath(),'POST',member,{})
  expect(res.status).toBe(200)
  const {url}=await res.json()
  const payload=new URL(url).searchParams.get('start')!
  await inbound.acceptUpdate(await bot(),update('/start '+payload,true))
  await inbound.acceptUpdate(await bot(),update('/start '+payload,true,99999))
  const links=await raw`select * from telegram_links where event_id=${gathering.id}`
  expect(links).toHaveLength(1);expect(links[0].telegram_user_id).toBe('12345')
  await run();hits.length=0
  await inbound.acceptUpdate(await bot(),update('Ordinary group conversation'))
  await inbound.acceptUpdate(await bot(),update('/ask@AnotherBot what time?'))
  const question=update('/ask@GatheringTestBot what did we learn?')
  await inbound.acceptUpdate(await bot(),question);await inbound.acceptUpdate(await bot(),question)
  const rows=await raw`select * from telegram_jobs where event_id=${gathering.id} and kind='question'`
  expect(rows).toHaveLength(1)
  expect(Buffer.from(rows[0].question_ciphertext).toString()).not.toContain('what did we learn')
  await jobs.runTelegramJobs({eventId:gathering.id,api:fake,limit:10,answer:async()=>({text:'Private transcript answer',private:true,chunks:[]})})
  const sends=hits.filter(h=>h.method==='sendMessage')
  expect(sends[0].body.chat_id).toBe('12345')
  expect(sends[1].body.chat_id).toBe('-10099')
  expect(sends[1].body.text).not.toContain('transcript answer')
  expect((await raw`select question_ciphertext from telegram_jobs where id=${rows[0].id}`)[0].question_ciphertext).toBeNull()
})

test('retrieval uses the gathering key and member-only corpus; output with transcripts is private',async()=>{
  await raw`update events set transcripts_enabled=true,transcripts_visibility='members' where id=${gathering.id}`
  const [session]=await raw`insert into sessions(event_id,title,format,duration,host_id) values(${gathering.id},'Ecology','workshop',60,${owner.id}) returning id`
  const [tr]=await raw`insert into session_transcripts(event_id,session_id,source,format,content,char_count,consent_confirmed_at,visibility) values(${gathering.id},${session.id},'paste','txt','Shared transcript fact',22,now(),'members') returning id`
  const [chunk]=await raw`insert into transcript_chunks(transcript_id,session_id,event_id,chunk_index,text,embedding,embedding_model) values(${tr.id},${session.id},${gathering.id},0,'Shared transcript fact',${[1,0,0]}::real[],'local:Xenova/bge-small-en-v1.5') returning id`
  const [proposal]=await raw`insert into sessions(event_id,title,description,format,duration,host_id,status) values(${gathering.id},'Public proposal','Proposal description','workshop',60,${owner.id},'approved') returning id`
  const [pending]=await raw`insert into sessions(event_id,title,format,duration,host_id,status) values(${gathering.id},'Pending hidden idea','workshop',60,${owner.id},'pending') returning id`
  const requestJob={event_id:gathering.id,account_id:member.id,telegram_user_id:'12345',source_chat_id:'-10099',question_ciphertext:aead.seal('What was discussed?',`telegram-message:${gathering.id}`)} as unknown as TelegramJob
  let prompt=''
  const deps={embed:async()=>[[1,0,0]],stream:async function* (config:any,req:any) { expect(config.apiKey).toBe('test-provider-key');prompt=req.user;yield {type:'text' as const,text:'Grounded answer [1]'} }}
  const result=await answers.answerQuestion(await bot(),requestJob,deps)
  expect(prompt).toContain('Public proposal');expect(prompt).not.toContain('Pending hidden idea')
  expect(prompt).toContain('Shared transcript fact');expect(result.private).toBe(true);expect(result.chunks).toEqual([chunk.id])
  await raw`update session_transcripts set visibility='organizers' where id=${tr.id}`
  expect(await answers.sourcesReadable(gathering.id,[chunk.id])).toBe(false)
  const hidden=await answers.answerQuestion(await bot(),requestJob,deps)
  expect(prompt).not.toContain('Shared transcript fact');expect(hidden.chunks).toEqual([])
  await raw`delete from sessions where id in (${session.id},${proposal.id},${pending.id})`
})

test('revoked membership, disabled bot, and stale transcript access prevent delivery',async()=>{
  await raw`delete from telegram_budgets where event_id=${gathering.id}`
  await inbound.acceptUpdate(await bot(),update('/ask what time?'))
  await raw`delete from event_members where event_id=${gathering.id} and user_id=${member.id}`
  await jobs.runTelegramJobs({eventId:gathering.id,api:fake,answer:async()=>{throw new Error('must not generate')}})
  expect(hits.filter(h=>h.method==='sendMessage')).toHaveLength(0)
  await raw`insert into event_members(event_id,user_id,role) values(${gathering.id},${member.id},'attendee')`
  await inbound.acceptUpdate(await bot(),update('/ask what next?'))
  await jobs.runTelegramJobs({eventId:gathering.id,api:fake,answer:async()=>({text:'Restricted',private:true,chunks:['00000000-0000-0000-0000-000000000001']})})
  expect(hits.filter(h=>h.method==='sendMessage')).toHaveLength(0)
})

test('disabled integration, wrong chats and stale webhook updates do not queue questions',async()=>{
  await raw`delete from telegram_budgets where event_id=${gathering.id}`
  const wrong=update('/ask should be ignored');wrong.message!.chat.id=-888
  await inbound.acceptUpdate(await bot(),wrong)
  const stale=update('/ask old question');stale.message!.date-=3600
  await inbound.acceptUpdate(await bot(),stale)
  await settings.updateBot(gathering.id,{announcements:true,ask_enabled:false,group_answers:true,daily_limit:100})
  await inbound.acceptUpdate(await bot(),update('/ask disabled question'))
  expect(await raw`select id from telegram_jobs where event_id=${gathering.id} and status='queued'`).toHaveLength(0)
  const res=await fetch(`${base}/api/telegram/${gathering.id}`,{method:'POST',headers:{'x-telegram-bot-api-secret-token':secret,'content-type':'application/json'},body:JSON.stringify(stale)})
  expect(res.status).toBe(200)
  const forged=await fetch(`${base}/api/telegram/${gathering.id}`,{method:'POST',headers:{'x-telegram-bot-api-secret-token':'x'.repeat(32)},body:'{}'})
  expect(forged.status).toBe(404)
  await settings.updateBot(gathering.id,{announcements:true,ask_enabled:true,group_answers:true,daily_limit:100})
})

test('daily budget is atomic and gives a useful limit message without another inference',async()=>{
  await raw`delete from telegram_budgets where event_id=${gathering.id}`
  await settings.updateBot(gathering.id,{announcements:true,ask_enabled:true,group_answers:true,daily_limit:1})
  await Promise.all([inbound.acceptUpdate(await bot(),update('/ask first question',false,20001)),inbound.acceptUpdate(await bot(),update('/ask second question',false,20002))])
  let calls=0
  await jobs.runTelegramJobs({eventId:gathering.id,api:fake,limit:10,answer:async()=>{calls++;return {text:'Public answer',private:false,chunks:[]}}})
  expect(calls).toBe(1)
  expect(hits.some(h=>String(h.body.text).includes('limit has been reached'))).toBe(true)
})

test('organizer and participant Telegram cards fit mobile and desktop',async({page})=>{
  const [name,value]=owner.cookie.split('=')
  await page.context().addCookies([{name,value,url:base}])
  for (const width of [320,390,1280]) {
    await page.setViewportSize({width,height:900})
    await page.goto(`/e/${gathering.slug}/admin/settings#telegram`)
    await expect(page.getByRole('heading',{name:'Telegram',exact:true})).toBeVisible()
    await expect(page.getByRole('button',{name:'Save Telegram settings'})).toBeVisible()
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
    await page.locator('#telegram-title').scrollIntoViewIfNeeded()
    await page.screenshot({path:`/tmp/unconference-telegram-${width}.png`,fullPage:false})
  }
  await page.goto(`/e/${gathering.slug}/telegram`)
  await expect(page.getByRole('button',{name:'Connect my Telegram'})).toBeVisible()
  await page.getByRole('button',{name:'Connect my Telegram'}).click()
  await expect(page.getByRole('link',{name:'Open Telegram and press Start'})).toHaveAttribute('href',/^https:\/\/t.me\/GatheringTestBot\?start=link_/)
  await page.setViewportSize({width:320,height:800})
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
})

test('disconnect removes webhook, credentials and participant links',async()=>{
  await settings.disconnectBot(gathering.id,fake)
  expect(await settings.loadBot(gathering.id)).toBeNull()
  expect(hook).toBe('')
  expect(await raw`select 1 from telegram_links where event_id=${gathering.id}`).toHaveLength(0)
})
