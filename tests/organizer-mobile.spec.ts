import { test, expect, type Page } from '@playwright/test'
import { loadEnvConfig } from '@next/env'
import postgres from 'postgres'
import { randomBytes } from 'node:crypto'
import { createTestAccount, createTestGathering, type TestAccount, type TestGathering } from './helpers/gathering'

loadEnvConfig(process.cwd(), true)
const base = process.env.TEST_BASE_URL || 'http://localhost:3001'
const databaseUrl = process.env.DATABASE_URL || ''
const local = (() => { try { return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(databaseUrl).hostname) } catch { return false } })()

// Scrollable day strips and calendar grids are intentional. Buttons must still fit their
// own boxes, and non-scrolling controls must stay inside their containing cards.
async function check(page: Page, where: string) {
  const issues = await page.evaluate((width) => {
    const issues: string[] = []
    if (window.innerWidth !== width) issues.push(`layout viewport widened to ${window.innerWidth} from ${width}`)
    if (document.documentElement.scrollWidth > window.innerWidth + 1) issues.push(`document width ${document.documentElement.scrollWidth} > ${window.innerWidth}`)
    for (const el of document.querySelectorAll<HTMLElement>('#workspace-main button, #workspace-main a, #workspace-main input, #workspace-main select, [role="dialog"] button, [role="dialog"] input')) {
      const r = el.getBoundingClientRect()
      if (!r.width || !r.height || el.closest('[aria-hidden="true"]')) continue
      let ancestor = el.parentElement
      let scrollable = false
      while (ancestor && ancestor.id !== 'workspace-main') {
        if (['auto', 'scroll'].includes(getComputedStyle(ancestor).overflowX)) { scrollable = true; break }
        const box = ancestor.getBoundingClientRect()
        if ((getComputedStyle(ancestor).overflowX === 'hidden' || (ancestor.classList.contains('border') && ancestor.classList.contains('rounded-2xl'))) && (r.right > box.right + 1 || r.left < box.left - 1)) issues.push(`clipped: ${el.textContent?.trim().slice(0, 70) || el.getAttribute('aria-label')} by ${ancestor.tagName}`)
        ancestor = ancestor.parentElement
      }
      if (!scrollable && (r.right > window.innerWidth + 1 || r.left < -1)) issues.push(`offscreen: ${el.textContent?.trim().slice(0, 70) || el.getAttribute('aria-label')}`)
      if (el.tagName === 'BUTTON' && el.scrollWidth > el.clientWidth + 1) issues.push(`label overflow: ${el.textContent?.trim().slice(0, 70)}`)
    }
    return [...new Set(issues)]
  }, page.viewportSize()!.width)
  expect.soft(issues, where).toEqual([])
}

test.describe('organizer responsive controls', () => {
  test.skip(!local || !process.env.PDS_URL, 'requires the local stack')
  // These cases only read the fixture or open unsaved forms; run every width after a failure.
  let raw: postgres.Sql
  let gathering: TestGathering
  let organizer: TestAccount
  test.beforeAll(async () => {
    raw = postgres(databaseUrl, { max: 2, onnotice: () => {} })
    gathering = await createTestGathering(raw, { tag: 'orgmobile', status: 'voting_open', withProgram: true })
    organizer = await createTestAccount('orgmobile', { sql: raw })
    await raw`insert into event_members (event_id, user_id, role) values (${gathering.id}, ${organizer.id}, 'owner') on conflict (event_id, user_id) do update set role = 'owner'`
    await raw`update profiles set onboarding_completed = true where id = ${organizer.id}`
    await raw`insert into vote_rounds (event_id, mechanism, credits, opens_at, closes_at, ballot_key)
      values (${gathering.id}, 'quadratic', 100, now() - interval '1 hour', now() + interval '1 day', ${randomBytes(32)})`
    await raw`insert into ticket_tiers (event_id, name, description, price_cents)
      values (${gathering.id}, 'Community supporter weekend admission', 'Full access to sessions and shared meals.', 2500)`
    await raw`insert into sessions (event_id, title, description, format, duration, host_id, status, is_votable) values (${gathering.id}, 'Building community across neighborhoods', 'A practical workshop for gathering organizers.', 'workshop', 60, ${organizer.id}, 'approved', true)`
  })
  test.afterAll(async () => {
    await gathering?.cleanup()
    await organizer?.cleanup()
    await raw?.end({ timeout: 5 })
  })

  for (const width of [320, 390, 768, 1280]) {
    test(`workspace controls fit at ${width}px`, async ({ browser }) => {
      test.setTimeout(600_000)
      const context = await browser.newContext({ viewport: { width, height: 844 }, isMobile: width < 768, hasTouch: width < 768 })
      const [name, ...value] = organizer.cookie.split('=')
      await context.addCookies([{ name, value: value.join('='), url: base }])
      const page = await context.newPage()
      page.setDefaultTimeout(20_000)
      // Next dev may recompile a route during the full suite; interactions still fail fast.
      page.setDefaultNavigationTimeout(60_000)
      try {
        for (const route of ['', 'sessions/new', 'setup', 'schedule', 'tracks', 'members', 'communications', 'checkin', 'moderation', 'settings', 'tickets', 'revenue', 'analytics', 'knowledge', 'atproto']) {
          await page.goto(`${base}/e/${gathering.slug}/admin/${route}`)
          await expect(page.locator('#workspace-main h1')).toBeVisible({ timeout: 60_000 })
          await page.waitForLoadState('networkidle')
          if (process.env.ORGANIZER_SHOTS) await page.screenshot({ path: `/tmp/organizer-${route.replaceAll('/', '-') || 'overview'}-${width}.png`, fullPage: true })
          await check(page, `${route || 'overview'} at ${width}px`)
        }

        // The crowded states are more revealing than empty pages: open each editor without
        // sending invitations, publishing a schedule, or touching a seeded gathering.
        const open = async (route: string) => {
          await page.goto(`${base}/e/${gathering.slug}/admin/${route}`)
          await expect(page.locator('#workspace-main h1')).toBeVisible({ timeout: 60_000 })
          await page.waitForLoadState('networkidle')
        }
        const inspect = async (name: string) => {
          await check(page, `${name} at ${width}px`)
          if (process.env.ORGANIZER_SHOTS) await page.screenshot({ path: `/tmp/organizer-${name}-${width}.png`, fullPage: true })
        }
        await open('')
        const title = page.getByRole('heading', { name: 'Building community across neighborhoods' })
        if (width < 640) {
          const box = await title.boundingBox()
          expect(box!.width).toBeGreaterThan(width * 0.55)
        }
        await page.getByRole('checkbox', { name: 'Select Building community across neighborhoods', exact: true }).click()
        const toolbar = page.getByRole('toolbar', { name: 'Selected sessions' })
        await expect(toolbar).toBeVisible()
        const controls = await toolbar.locator('button').evaluateAll(buttons => buttons.map(button => {
          const r = button.getBoundingClientRect()
          return r.left >= 0 && r.right <= window.innerWidth && r.width >= 40 && r.height >= 40
        }))
        expect.soft(controls.every(Boolean), 'every bulk action has a visible touch target').toBe(true)
        await inspect('selected-sessions')
        await toolbar.getByRole('button', { name: 'Reject', exact: true }).click()
        await expect(page.getByRole('dialog')).toBeVisible()
        await inspect('reject-dialog')
        await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click()

        await open('setup')
        await page.getByRole('button', { name: 'Generate slots', exact: true }).first().click()
        await page.getByRole('button', { name: 'Save as template' }).click()
        await page.getByRole('switch', { name: 'Same times every day' }).click()
        await inspect('slot-template-form')
        await open('setup')
        await page.getByRole('button', { name: 'Add room', exact: true }).first().click()
        await inspect('room-form')

        await open('schedule')
        if (width < 1024) {
          await expect(page.getByRole('button', { name: 'Close unscheduled sessions' })).toBeHidden()
          await page.getByRole('button', { name: /^Sessions/ }).click()
        }
        await expect(page.getByRole('button', { name: 'Close unscheduled sessions' })).toBeVisible()
        await inspect('unscheduled-panel')
        await page.getByRole('button', { name: 'Place…', exact: true }).click()
        if (width < 1024) await expect(page.getByRole('button', { name: 'Close unscheduled sessions' })).toBeHidden()
        await inspect('schedule-placement')
        await page.getByRole('button', { name: 'Publish', exact: true }).click()
        await expect(page.getByRole('dialog')).toBeVisible()
        await inspect('publish-dialog')
        await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click()

        await open('members')
        await page.getByRole('button', { name: 'Invite people', exact: true }).first().click()
        await inspect('invite-form')
        await open('tickets')
        await page.getByRole('button', { name: 'Add ticket type' }).click()
        await inspect('ticket-form')
        await open('settings')
        await page.getByTestId('round-pre').getByRole('button', { name: 'Close now' }).click()
        await inspect('round-confirmation')
        if (process.env.ORGANIZER_SHOTS) for (const section of ['participation', 'voting', 'lifecycle', 'branding']) {
          await page.locator(`#${section}`).screenshot({ path: `/tmp/organizer-settings-${section}-${width}.png` })
        }
      } finally { await context.close() }
    })
  }
})
