'use client'

import * as React from 'react'
import Link from 'next/link'
import { Send, Check, ArrowUpRight, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { apiFetch } from '@/lib/api/client'
import { SectionCard } from './SectionCard'

interface State {
  secrets_configured: boolean; announcements_available: boolean; ai_configured: boolean; ai_model: string | null; questions_today: number
  bot: { username: string; ready: boolean; chat_id: string | null; chat_title: string | null; announcements: boolean; ask_enabled: boolean; group_answers: boolean; daily_limit: number;
    pending_chat: { id: string; title: string; type: string } | null } | null
  recent: { id: string; kind: string; status: string; error: string | null; created_at: string }[]
}

export function TelegramBotSection({ slug }: { slug: string }) {
  const endpoint=`/api/v1/events/${encodeURIComponent(slug)}/admin/telegram`
  const [state,setState]=React.useState<State | null>(null)
  const [token,setToken]=React.useState('')
  const [pair,setPair]=React.useState<{ group_url:string; command:string } | null>(null)
  const [busy,setBusy]=React.useState(false)
  const [error,setError]=React.useState('')
  const [message,setMessage]=React.useState('')
  const [disconnect,setDisconnect]=React.useState(false)
  const [retry,setRetry]=React.useState<string | null>(null)
  const [form,setForm]=React.useState({ announcements:false,ask_enabled:false,group_answers:true,daily_limit:100 })
  const install=React.useCallback((data:State) => {
    setState(data)
    if (data.bot) setForm({ announcements:data.bot.announcements,ask_enabled:data.bot.ask_enabled,group_answers:data.bot.group_answers,daily_limit:data.bot.daily_limit })
  },[])
  const refresh=React.useCallback(async () => {
    setBusy(true);setError('')
    try { install(await apiFetch<State>(endpoint)) } catch(e) { setError(e instanceof Error ? e.message:'Could not load Telegram') } finally { setBusy(false) }
  },[endpoint,install])
  React.useEffect(() => { void refresh() },[refresh])
  async function act(action:string, extra:Record<string,unknown>={}) {
    setBusy(true);setError('');setMessage('')
    try {
      if (action==='pair') setPair(await apiFetch(endpoint,{ method:'POST',json:{ action,...extra } }))
      else {
        install(await apiFetch<State>(endpoint,{ method:'POST',json:{ action,...extra } }))
        setMessage(action==='connect' ? 'Bot connected. Choose its chat next.' : action==='save' ? 'Telegram settings saved.' : action==='confirm' ? 'Chat confirmed. Choose what your bot shares below.' : action==='disconnect' ? 'Bot disconnected.' : 'Delivery queued.')
        setToken('');setDisconnect(false);setRetry(null)
        if (['confirm','disconnect'].includes(action)) setPair(null)
      }
    } catch(e) { setError(e instanceof Error ? e.message:'Could not update Telegram') } finally { setBusy(false) }
  }
  const bot=state?.bot
  return <SectionCard id="telegram" title="Telegram" description="Bring your gathering into the chat. One bot for announcements, with an optional event guide.">
    {error && <p role="alert" className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
    {message && <p role="status" className="text-sm text-primary">{message}</p>}
    {!state ? <p className="text-sm text-muted-foreground">{busy ? 'Loading Telegram…':'Telegram settings are unavailable.'}</p> : <>
      <ol aria-label="Telegram setup" className="grid grid-cols-3 gap-2 text-xs sm:text-sm">
        {['Connect bot','Choose chat','Make it yours'].map((label,i) => <li key={label} className={`flex items-center gap-2 rounded-xl border p-2 sm:p-3 ${i===0 && bot || i===1 && bot?.chat_id ? 'border-primary/30 bg-primary/5':'bg-muted/30'}`}><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-background font-medium">{i===0 && bot || i===1 && bot?.chat_id ? <Check className="h-3.5 w-3.5"/>:i+1}</span><span>{label}</span></li>)}
      </ol>
      {!bot || !bot.ready ? <form className="space-y-4" onSubmit={e => { e.preventDefault();void act('connect',{ token }) }}>
        <p className="text-sm text-muted-foreground">Open <a href="https://t.me/BotFather" target="_blank" rel="noopener noreferrer" className="font-medium text-foreground underline">BotFather</a>, send <code>/newbot</code>, and give your gathering’s bot a name. Paste its token here. Use a dedicated bot that isn’t connected to another service.</p>
        <label className="block space-y-2 text-sm font-medium">Bot token<Input type="password" autoComplete="off" value={token} onChange={e=>setToken(e.target.value)} placeholder="Paste the token from BotFather" disabled={!state.secrets_configured || busy}/></label>
        <p className="text-xs text-muted-foreground">Encrypted on the server. Never published to ATProto or shown again.</p>
        {!state.secrets_configured && <p role="alert" className="text-sm text-destructive">Secret storage needs to be configured by the platform operator.</p>}
        <Button disabled={busy || !token.trim() || !state.secrets_configured} type="submit"><Send className="mr-2 h-4 w-4"/>Connect bot</Button>
      </form> : <>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-muted/40 p-4">
          <div className="min-w-0"><p className="break-all font-medium">@{bot.username}</p><p className="text-sm text-muted-foreground">{bot.chat_title || 'No chat selected yet'}</p></div>
          <Button variant="outline" size="sm" disabled={busy} onClick={()=>void refresh()}><RefreshCw className="mr-2 h-3.5 w-3.5"/>Check connection</Button>
        </div>
        <details className="text-sm"><summary className="cursor-pointer text-muted-foreground">Replace bot token</summary><form className="mt-3 space-y-3" onSubmit={e=>{e.preventDefault();void act('connect',{token})}}><p className="text-muted-foreground">Regenerated the token in BotFather? Update it here to keep this bot’s chat and participant connections.</p><label className="block space-y-2 font-medium">New bot token<Input type="password" autoComplete="off" value={token} onChange={e=>setToken(e.target.value)}/></label><Button variant="outline" type="submit" disabled={busy || !token.trim()}>Update token</Button></form></details>
        {!pair && <Button variant="outline" disabled={busy} onClick={()=>void act('pair')}>{bot.chat_id ? 'Change chat':'Choose a chat'}</Button>}
        {pair && <div className="space-y-3 rounded-xl border p-4">
          <Button asChild><a href={pair.group_url} target="_blank" rel="noopener noreferrer">Add to group<ArrowUpRight className="ml-2 h-4 w-4"/></a></Button>
          <p className="text-sm text-muted-foreground">Choose your group, then return here and check the connection. For a channel, add the bot as an admin and post this command. In a forum, post it inside the topic you want to use. The code expires in 10 minutes.</p>
          <code className="block select-all break-all rounded-lg bg-muted p-3 text-xs">{pair.command}</code>
          <Button variant="ghost" size="sm" disabled={busy} onClick={()=>void act('pair')}>Get a new pairing code</Button>
        </div>}
        {bot.pending_chat && <div className="space-y-3 rounded-xl border border-primary/40 bg-primary/5 p-4">
          <p className="font-medium">Use {bot.pending_chat.title}?</p><p className="text-sm text-muted-foreground">This is where announcements and public answers will appear.</p>
          <Button disabled={busy} onClick={()=>void act('confirm',{ chat_id:bot.pending_chat!.id })}>Confirm this chat</Button>
        </div>}
        {bot.chat_id && <form className="space-y-5" onSubmit={e=>{e.preventDefault();void act('save',form)}}>
          <label className="flex items-start gap-3 rounded-xl border p-4"><input type="checkbox" className="mt-1 h-4 w-4 accent-primary" checked={form.announcements} onChange={e=>setForm({...form,announcements:e.target.checked})}/><span><span className="block font-medium">Mirror Bluesky announcements</span><span className="text-sm text-muted-foreground">New phase changes and published schedule updates. Earlier posts won’t be replayed.</span></span></label>
          {!state.announcements_available && <p className="text-sm text-muted-foreground">Announcements wait until the gathering is public, published, and <a href="#feed-network" className="underline">Bluesky activity posting</a> is enabled.</p>}
          <label className="flex items-start gap-3 rounded-xl border p-4"><input type="checkbox" className="mt-1 h-4 w-4 accent-primary" checked={form.ask_enabled} disabled={!state.ai_configured && !form.ask_enabled} onChange={e=>setForm({...form,ask_enabled:e.target.checked})}/><span><span className="block font-medium">Answer event questions</span><span className="text-sm text-muted-foreground">Uses this gathering’s AI key{state.ai_model ? ` (${state.ai_model})`:''}. Participants can ask <code className="break-all">/ask@{bot.username}</code> in the chat.</span></span></label>
          <p className="text-sm text-muted-foreground"><Link href={`/e/${slug}/admin/knowledge`} className="underline">{state.ai_configured ? 'Manage the AI key and transcripts':'Add the gathering’s AI key'}</Link>. Questions and relevant sources are sent to that provider. Telegram also receives the replies.</p>
          {form.ask_enabled && <div className="space-y-4 rounded-xl bg-muted/30 p-4">
            <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1 h-4 w-4 accent-primary" checked={form.group_answers} onChange={e=>setForm({...form,group_answers:e.target.checked})}/><span>Answer public event questions in the group. Transcript answers and private gathering answers always go to linked participants privately.</span></label>
            <label className="block max-w-xs space-y-2 text-sm font-medium">Daily question limit<Input type="number" min={1} max={1000} required value={form.daily_limit} onChange={e=>setForm({...form,daily_limit:Number(e.target.value)})}/></label>
            <p className="text-xs text-muted-foreground">{state.questions_today} requests today · resets at midnight UTC. This limits questions, not provider spending; set a spending limit with your provider too.</p>
            <p className="text-sm text-muted-foreground">Share <Link href={`/e/${slug}/telegram`} className="underline">Connect Telegram</Link> so members can link their account. Only member-visible transcripts are used, even for organizers. For bare @mentions, the bot must receive those messages; <code className="break-all">/ask@{bot.username}</code> works with Telegram’s default privacy mode.</p>
          </div>}
          <Button type="submit" disabled={busy}>Save Telegram settings</Button>
        </form>}
      </>}
      {state.recent.length>0 && <details className="rounded-xl border p-4"><summary className="cursor-pointer text-sm font-medium">Recent announcements</summary><ul className="mt-4 divide-y">{state.recent.map(j=><li key={j.id} className="space-y-2 py-3 text-sm"><div className="flex flex-wrap justify-between gap-2"><span>{j.kind==='retract' ? 'Remove post':'Announcement'} · {new Date(j.created_at).toLocaleDateString()}</span><span className="font-medium capitalize">{j.status}</span></div>{j.error && <p className="text-muted-foreground">{j.error}</p>}{['failed','uncertain'].includes(j.status) && (retry===j.id ? <div className="space-y-2"><p>Check Telegram first. Retrying an unconfirmed delivery could create a duplicate.</p><Button size="sm" disabled={busy} onClick={()=>void act('retry',{job_id:j.id,confirmed:true})}>I checked — retry</Button></div>:<Button variant="outline" size="sm" onClick={()=>setRetry(j.id)}>Retry delivery</Button>)}</li>)}</ul></details>}
      {bot && <div className="border-t pt-4">{disconnect ? <div className="space-y-3"><p className="text-sm">Stop this bot and remove its stored token and participant links? Existing Telegram posts stay in the chat.</p><div className="flex flex-wrap gap-2"><Button variant="destructive" disabled={busy} onClick={()=>void act('disconnect')}>Disconnect bot</Button><Button variant="outline" onClick={()=>setDisconnect(false)}>Cancel</Button></div></div>:<Button variant="ghost" size="sm" onClick={()=>setDisconnect(true)}>Disconnect bot</Button>}</div>}
    </>}
  </SectionCard>
}
