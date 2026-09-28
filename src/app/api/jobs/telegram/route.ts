import { verifyCron, json } from '@/lib/voting/http'
import { runTelegramJobs } from '@/lib/telegram/jobs'
export const runtime = 'nodejs'
export async function POST(request: Request) {
  const bad = verifyCron(request, 'telegram')
  if (bad) return bad
  return json(await runTelegramJobs())
}
export const GET = POST
