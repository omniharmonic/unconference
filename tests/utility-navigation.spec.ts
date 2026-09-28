import { test, expect } from '@playwright/test'
import postgres from 'postgres'
import { createTestAccount, createTestGathering, type TestAccount, type TestGathering } from './helpers/gathering'

const base = 'http://localhost:3001'
const local = /^postgres(?:ql)?:\/\/[^/]+@(localhost|127\.0\.0\.1):/.test(process.env.DATABASE_URL || '')
let db: postgres.Sql
let account: TestAccount
let gathering: TestGathering
let sessionId: string

test.describe.configure({ mode: 'serial' })
test.beforeAll(async () => {
  test.skip(!local, 'Requires the local database and mock PLC')
  db = postgres(process.env.DATABASE_MIGRATION_URL || process.env.DATABASE_URL!, { max: 2, onnotice: () => {} })
  account = await createTestAccount('utility', { sql: db })
  gathering = await createTestGathering(db, { tag: 'utility', name: 'A shared neighborhood', status: 'proposals_open' })
  await db`insert into event_members (event_id,user_id,role) values (${gathering.id},${account.id},'attendee')`
  await db`insert into profiles (id,email,display_name,onboarding_completed) values (${account.id},${account.email},'Utility participant',true) on conflict (id) do update set onboarding_completed=true`
  const [session] = await db`select id from at_sessions where user_id=${account.id}`
  sessionId = session.id
})
test.afterAll(async () => { await gathering?.cleanup(); await account?.cleanup(); await db?.end({timeout:5}) })

test('active sessions renew both server and browser expiry; cross-site requests cannot renew', async ({request}) => {
  await db`update at_sessions set expires_at=now()+interval '1 hour' where id=${sessionId}`
  const denied = await request.post(`${base}/api/auth/renew`, {headers:{cookie:account.cookie,origin:'https://evil.example'}})
  expect(denied.status()).toBe(403)
  const response = await request.post(`${base}/api/auth/renew`, {headers:{cookie:account.cookie,origin:base}})
  expect(response.status()).toBe(204)
  expect(response.headers()['cache-control']).toContain('no-store')
  const cookie=response.headers()['set-cookie']
  expect(cookie).toContain('HttpOnly')
  expect(cookie).toContain('SameSite=Lax')
  expect(Number(cookie.match(/Max-Age=(\d+)/)?.[1])).toBeGreaterThan(89*86400)
  const [row]=await db`select expires_at from at_sessions where id=${sessionId}`
  expect(new Date(row.expires_at).getTime()-Date.now()).toBeGreaterThan(89*86400_000)
  await request.post(`${base}/api/auth/renew`, {headers:{cookie:account.cookie,origin:base}})
  const [again]=await db`select expires_at from at_sessions where id=${sessionId}`
  expect(again.expires_at).toEqual(row.expires_at)
})

for (const width of [390,1440]) test(`signed-in home prioritizes joined gatherings and dashboard navigation at ${width}px`,async({browser})=>{
  const context=await browser.newContext({viewport:{width,height:900}})
  const [name,...value]=account.cookie.split('=')
  await context.addCookies([{name,value:value.join('='),url:base}])
  const page=await context.newPage()
  try {
    await page.goto(base)
    await expect(page.locator('main').getByRole('heading').first()).toHaveText('My gatherings')
    const my=page.locator('#my-gatherings')
    const link=my.getByRole('link',{name:gathering.name,exact:true})
    await expect(link).toHaveAttribute('href',`/e/${gathering.slug}/dashboard`)
    await expect(my.getByRole('link',{name:'Organizer workspace'})).toHaveCount(0)
    await link.click()
    await expect(page).toHaveURL(`${base}/e/${gathering.slug}/dashboard`)
    await expect(page.getByTestId('workspace-context')).toHaveCount(0)
    if (width === 390) {
      await page.getByTestId('mobile-tab-bar').locator('button').click()
      await page.getByTestId('more-sheet').getByRole('link', {name:'My gatherings',exact:true}).click()
      await expect(page.locator('#my-gatherings-heading')).toBeVisible()
    }
    await page.goto(`${base}/e/${gathering.slug}`)
    await expect(page).toHaveURL(`${base}/e/${gathering.slug}/dashboard`)
    await page.goto(`${base}/e/${gathering.slug}?view=about`)
    await expect(page.getByRole('heading',{name:gathering.name,exact:true})).toBeVisible()
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true)
    await page.screenshot({path:`/tmp/unconference-utility-about-${width}.png`,fullPage:true})
    await page.goto(base)
    await page.screenshot({path:`/tmp/unconference-utility-home-${width}.png`,fullPage:true})
  } finally {await context.close()}
})

test('anonymous visitors keep the promotional page',async({page})=>{
  await page.goto(`${base}/e/${gathering.slug}`)
  await expect(page).toHaveURL(`${base}/e/${gathering.slug}`)
  await expect(page.getByRole('heading',{name:gathering.name,exact:true})).toBeVisible()
  await page.goto(base)
  await expect(page.locator('#my-gatherings')).toHaveCount(0)
  await expect(page.locator('main h1')).toBeVisible()
})

test('expired and revoked sessions cannot be renewed',async({request})=>{
  await db`update at_sessions set expires_at=now()-interval '1 second' where id=${sessionId}`
  const response=await request.post(`${base}/api/auth/renew`,{headers:{cookie:account.cookie,origin:base}})
  expect(response.status()).toBe(401)
  expect(response.headers()['set-cookie']).toBeUndefined()
  expect(await db`select id from at_sessions where id=${sessionId}`).toHaveLength(0)
  expect((await request.post(`${base}/api/auth/renew`,{headers:{cookie:account.cookie,origin:base}})).status()).toBe(401)
})
