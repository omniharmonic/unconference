'use client'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { apiFetch } from '@/lib/api/client'

export function TelegramConnectionCard({ slug, standalone=false }: { slug:string; standalone?:boolean }) {
  const url=`/api/v1/events/${encodeURIComponent(slug)}/telegram`
  const [state,setState]=React.useState<{ available:boolean; username:string | null; linked:boolean } | null>(null)
  const [link,setLink]=React.useState<string | null>(null)
  const [busy,setBusy]=React.useState(false)
  const [error,setError]=React.useState('')
  const refresh=React.useCallback(async()=>{
    try { setState(await apiFetch(url));setError('') } catch(e) { setError(e instanceof Error ? e.message:'Could not load Telegram') }
  },[url])
  React.useEffect(()=>{void refresh()},[refresh])
  async function connect() {
    setBusy(true);setError('')
    try { const data=await apiFetch<{url:string}>(url,{method:'POST',json:{}});setLink(data.url) }
    catch(e) { setError(e instanceof Error ? e.message:'Could not connect') } finally {setBusy(false)}
  }
  async function unlink() {
    setBusy(true);setError('')
    try { await apiFetch(url,{method:'DELETE'});setLink(null);await refresh() }
    catch(e) {setError(e instanceof Error ? e.message:'Could not disconnect')} finally {setBusy(false)}
  }
  if (!standalone && !state?.available && !state?.linked) return null
  return <Card><CardHeader><CardTitle>Ask in Telegram</CardTitle><CardDescription>Take the gathering’s event guide into your chat.</CardDescription></CardHeader><CardContent className="min-w-0 space-y-4">
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {!state ? <p className="text-sm text-muted-foreground">{error ? 'Sign in and join this gathering to connect.':'Loading…'}</p> : <>
      {!state.available && <p className="text-sm text-muted-foreground">The organizers haven’t enabled the Telegram assistant yet.</p>}
      {state.available && <><p className="break-words text-sm text-muted-foreground">Connect your account to @{state.username} for private answers from member-visible session transcripts. Your questions and relevant excerpts go to the gathering’s AI provider; replies also go through Telegram. This does not publish your Telegram identity to ATProto.</p>
      <p className="text-xs text-muted-foreground">Questions are handled individually, without chat history. Stored question text is encrypted and removed after delivery or within 24 hours. Messages already sent remain in Telegram.</p>
      {state.linked ? <div className="flex flex-wrap items-center gap-3"><span className="text-sm font-medium text-primary">Account connected</span><Button asChild><a href={`https://t.me/${state.username}`} target="_blank" rel="noopener noreferrer">Open bot</a></Button></div> : link ? <div className="space-y-3"><Button asChild className="h-auto min-h-11 max-w-full whitespace-normal text-center"><a href={link} target="_blank" rel="noopener noreferrer">Open Telegram and press Start</a></Button><p className="text-xs text-muted-foreground">This personal link expires in 10 minutes. Don’t share it.</p><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={()=>void refresh()}>Check connection</Button><Button variant="ghost" disabled={busy} onClick={()=>void connect()}>Get a new link</Button></div></div> : <Button disabled={busy} onClick={()=>void connect()}>Connect my Telegram</Button>}</>}
      {state.linked && <Button variant="ghost" size="sm" disabled={busy} onClick={()=>void unlink()}>Disconnect my Telegram</Button>}
    </>}
  </CardContent></Card>
}
