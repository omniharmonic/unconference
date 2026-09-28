import { test, expect, type Browser, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { loadEnvConfig } from '@next/env'
import postgres from 'postgres'
import { createTestAccount, createTestGathering, type TestAccount, type TestGathering } from './helpers/gathering'

/**
 * The mobile-first gathering shell (mobile shell design §2, §5.1).
 *
 * What is actually asserted here is the shape of the shell at the two sizes the design is drawn
 * for: a floating bar with five items and no hamburger on a phone, no bar and a two-group sidebar
 * on a laptop, a expanded navigation that behaves like a dialog should, a header avatar that lands on the
 * Profile tab of Account, content without a redundant page banner, and
 * enough room under the content that the bar never covers the last thing on the page.
 *
 * The gathering, the account and the session are this suite's own and are removed in afterAll;
 * no seeded row is read or written.
 */
loadEnvConfig(process.cwd(), true)

const base = process.env.TEST_BASE_URL || 'http://localhost:3001'
const databaseUrl = process.env.DATABASE_URL || ''
const isLocal = (() => {
  try {
    return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(databaseUrl).hostname)
  } catch {
    return false
  }
})()

const PHONE = { width: 390, height: 844 }
const LAPTOP = { width: 1280, height: 800 }

test.describe('mobile shell: floating bar, expanded navigation, content layout', () => {
  test.skip(!isLocal || !process.env.PDS_URL || !process.env.PDS_ADMIN_PASSWORD, 'needs the local stack: DATABASE_URL on localhost, PDS_URL, PDS_ADMIN_PASSWORD')
  test.describe.configure({ mode: 'serial' })

  let raw: postgres.Sql
  let gathering: TestGathering
  let organizer: TestAccount
  let sessionId = ''

  /** A signed-in page at one viewport, failing the test on any uncaught client error. */
  async function shell(browser: Browser, viewport: { width: number; height: number }) {
    const context = await browser.newContext({ baseURL: base, viewport })
    const [name, ...rest] = organizer.cookie.split('=')
    await context.addCookies([{ name, value: rest.join('='), url: base }])
    const page = await context.newPage()
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    return { page, errors, close: () => context.close() }
  }

  /** Waiting for the client shell to have hydrated and drawn itself. */
  async function openWorkspace(page: Page, path: string) {
    await page.goto(path, { waitUntil: 'domcontentloaded' })
    // The account button appears only after client auth.
    await expect(page.locator('button[aria-label^="Account"]').filter({ visible: true }).first()).toBeVisible({ timeout: 60_000 })
  }

  const bar = (page: Page) => page.getByTestId('mobile-tab-bar')
  /** The bar's only button. Located by CSS, not by role: an open sheet hides the rest of the
      document from the accessibility tree, which is exactly what it should do. */
  const moreButton = (page: Page) => bar(page).locator('button[aria-controls]')

  test.beforeAll(async () => {
    test.setTimeout(180_000)
    raw = postgres(databaseUrl, { max: 4, onnotice: () => {} })
    gathering = await createTestGathering(raw, { tag: 'shell', status: 'proposals_open', withProgram: true })
    organizer = await createTestAccount('shell-org', { sql: raw })
    await raw`insert into event_members (event_id, user_id, role) values (${gathering.id}, ${organizer.id}, 'owner')
              on conflict (event_id, user_id) do update set role = 'owner'`
    // Past onboarding, which otherwise covers every page in a modal.
    await raw`insert into profiles (id, email, display_name, onboarding_completed)
              values (${organizer.id}, ${organizer.email}, 'Mobile Shell', true)
              on conflict (id) do update set onboarding_completed = true, display_name = 'Mobile Shell'`
    const [row] = await raw<{ id: string }[]>`
      insert into sessions (event_id, title, description, format, duration, host_id, status, is_votable)
      values (${gathering.id}, ${`Shell session ${gathering.slug}`}, 'A session to open from the list.', 'talk', 60,
              ${organizer.id}, 'approved', true)
      returning id
    `
    sessionId = row!.id
  })

  test.afterAll(async () => {
    await gathering?.cleanup().catch(() => undefined)
    await organizer?.cleanup().catch(() => undefined)
    await raw?.end({ timeout: 5 })
  })


  // ── the bar, at both sizes ────────────────────────────────────────────────────────────────

  test('a phone gets a five-item floating bar and no hamburger', async ({ browser }) => {
    const { page, errors, close } = await shell(browser, PHONE)
    try {
      await openWorkspace(page, `/e/${gathering.slug}/sessions`)

      await expect(bar(page)).toBeVisible()
      const items = bar(page).locator('a, button').filter({ visible: true })
      await expect(items).toHaveCount(5)
      expect((await items.allInnerTexts()).map((t) => t.trim())).toEqual(['Home', 'Sessions', 'Schedule', 'Map', 'More'])

      // Sessions is the page we are on, and says so.
      await expect(bar(page).getByRole('link', { name: 'Sessions' })).toHaveAttribute('aria-current', 'page')
      await expect(bar(page).getByRole('link', { name: 'Home' })).not.toHaveAttribute('aria-current', 'page')

      // The drawer and its hamburger are gone: the avatar and the expanded navigation replaced them.
      await expect(page.getByRole('button', { name: /event navigation/i })).toHaveCount(0)

      // Every target in the bar is at least 44px tall.
      const heights = await items.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height))
      for (const h of heights) expect(h).toBeGreaterThanOrEqual(44)

      // The bar floats: inset from both edges, never full-bleed.
      const box = await bar(page).boundingBox()
      expect(box!.x).toBeGreaterThanOrEqual(8)
      expect(box!.x + box!.width).toBeLessThanOrEqual(PHONE.width - 8)

      expect(errors).toEqual([])
    } finally {
      await close()
    }
  })

  test('Schedule is one tab, lit for the program and for my schedule alike', async ({ browser }) => {
    const { page, close } = await shell(browser, PHONE)
    try {
      await openWorkspace(page, `/e/${gathering.slug}/schedule`)
      const tab = bar(page).getByRole('link', { name: 'Schedule' })
      await expect(tab).toHaveAttribute('href', `/e/${gathering.slug}/schedule`)
      await expect(tab).toHaveAttribute('aria-current', 'page')

      await openWorkspace(page, `/e/${gathering.slug}/my-schedule`)
      await expect(bar(page).getByRole('link', { name: 'Schedule' })).toHaveAttribute('aria-current', 'page')
    } finally {
      await close()
    }
  })

  test('a laptop gets no bar, and a sidebar in two groups', async ({ browser }) => {
    const { page, errors, close } = await shell(browser, LAPTOP)
    try {
      await openWorkspace(page, `/e/${gathering.slug}/sessions`)

      await expect(bar(page)).toBeHidden()

      const nav = page.locator('nav[aria-label="Event navigation"]')
      await expect(nav).toBeVisible()
      const labels = (await nav.getByRole('link').allInnerTexts()).map((t) => t.trim())
      expect(labels).toEqual([
        'Home',
        'Sessions',
        'Schedule',
        'Map',
        'People',
        'My votes',
        'Ask',
        'Propose a session',
        'Organizer workspace',
      ])

      // The four destinations first, then a rule, then the ones a tap deeper (design §1).
      const groups = nav.locator(':scope > div')
      await expect(groups).toHaveCount(4) // two nav groups, the Propose button, Organizer workspace
      await expect(groups.nth(1)).toHaveClass(/border-t/)

      expect(errors).toEqual([])
    } finally {
      await close()
    }
  })

  // ── the expanded navigation ────────────────────────────────────────────────────────────────────────

  test('the expanded navigation holds what the bar does not, keeps the page available, and closes on Escape', async ({ browser }) => {
    const { page, errors, close } = await shell(browser, PHONE)
    try {
      await openWorkspace(page, `/e/${gathering.slug}/sessions`)
      const more = moreButton(page)
      await expect(more).toHaveAttribute('aria-expanded', 'false')
      await more.click()

      const sheet = page.getByTestId('more-navigation')
      await expect(sheet).toBeVisible()
      await expect(more).toHaveAttribute('aria-expanded', 'true')

      // Proposals are open, the viewer is an owner and can read this gathering's transcripts,
      // so the full set is here.
      const rows = sheet.locator('a, button')
      expect((await rows.allInnerTexts()).map((t) => t.trim())).toEqual([
        'People',
        'My votes',
        'Ask',
        'My gatherings',
        'Sign out',
      ])

      // It is a disclosure, so the page and main tabs remain usable.
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await expect(page.getByRole('link', { name: 'Organizer workspace', exact: true })).toBeVisible()
      await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined))))
      const firstRow = await bar(page).getByRole('link', { name: 'Sessions', exact: true }).boundingBox()
      const secondRow = await sheet.getByRole('link', { name: 'People', exact: true }).boundingBox()
      expect(secondRow!.y + secondRow!.height).toBeLessThanOrEqual(firstRow!.y)
      for (const row of await rows.all()) expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(44)
      await page.screenshot({ path: '/tmp/unconference-expanded-pill-390.png' })

      await page.keyboard.press('Escape')
      await expect(sheet).toHaveAttribute('aria-hidden', 'true')
      await expect(more).toHaveAttribute('aria-expanded', 'false')
      expect(errors).toEqual([])
    } finally {
      await close()
    }
  })

  test('the expanded navigation closes on a route change', async ({ browser }) => {
    const { page, close } = await shell(browser, PHONE)
    try {
      await openWorkspace(page, `/e/${gathering.slug}/sessions`)
      await moreButton(page).click()
      const sheet = page.getByTestId('more-navigation')
      await expect(sheet).toBeVisible()

      await sheet.getByRole('link', { name: 'My votes' }).click()
      await expect(page).toHaveURL(new RegExp(`/e/${gathering.slug}/my-votes`), { timeout: 60_000 })
      await expect(sheet).toHaveAttribute('aria-hidden', 'true')

      // And on a route change the sheet itself did not start: going back closes it too.
      await moreButton(page).click()
      await expect(page.getByTestId('more-navigation')).toBeVisible()
      await page.goBack()
      await expect(page).toHaveURL(new RegExp(`/e/${gathering.slug}/sessions`))
      await expect(page.getByTestId('more-navigation')).toHaveAttribute('aria-hidden', 'true')
    } finally {
      await close()
    }
  })

  test('a backdrop click closes the expanded navigation', async ({ browser }) => {
    const { page, close } = await shell(browser, PHONE)
    try {
      await openWorkspace(page, `/e/${gathering.slug}/sessions`)
      await moreButton(page).click()
      const sheet = page.getByTestId('more-navigation')
      await expect(sheet).toBeVisible()
      await page.mouse.click(PHONE.width / 2, 40)
      await expect(sheet).toHaveAttribute('aria-hidden', 'true')
    } finally {
      await close()
    }
  })

  // ── the header avatar ─────────────────────────────────────────────────────────────────────

  test('the header avatar opens Account on its Profile tab', async ({ browser }) => {
    const { page, errors, close } = await shell(browser, PHONE)
    try {
      await openWorkspace(page, `/e/${gathering.slug}/sessions`)
      const avatar = page.getByRole('button', { name: /^Account, / })
      await expect(avatar).toBeVisible()
      expect((await avatar.boundingBox())!.height).toBeGreaterThanOrEqual(44)
      await avatar.click()

      const account = page.getByRole('dialog')
      await expect(account.getByRole('heading', { name: 'Account' })).toBeVisible()
      await expect(account.getByRole('tab', { name: 'Profile' })).toHaveAttribute('aria-selected', 'true')
      expect(errors).toEqual([])
    } finally {
      await close()
    }
  })

  test('the Account card on Settings opens the modal from the page it is already on', async ({ browser }) => {
    const { page, errors, close } = await shell(browser, PHONE)
    try {
      await openWorkspace(page, `/e/${gathering.slug}/settings`)
      // `?settings=1` here points at this very page, so the card is a button on the shell's own
      // Account modal rather than a link that navigates nowhere.
      const card = page.getByRole('button', { name: /^Account Your profile/ })
      await expect(card).toBeVisible()

      // The card is a button, so the tap needs React to have hydrated; against `next dev` a cold
      // route can still be hydrating when the markup is already there. Retry the tap rather than
      // race it.
      const account = page.getByRole('dialog')
      await expect(async () => {
        await card.click()
        await expect(account.getByRole('heading', { name: 'Account' })).toBeVisible({ timeout: 2000 })
      }).toPass({ timeout: 30_000 })
      expect(errors).toEqual([])
    } finally {
      await close()
    }
  })

  // ── toasts and the bar ────────────────────────────────────────────────────────────────────

  test('a toast sits above the floating bar, so a tab still takes the tap', async ({ browser }) => {
    const { page, errors, close } = await shell(browser, PHONE)
    try {
      await openWorkspace(page, `/e/${gathering.slug}/sessions/${sessionId}`)
      // The confirmation follows the save response, which can wait for a cold dev route.
      const saved = page.waitForResponse((response) =>
        response.url().endsWith(`/favorites/${sessionId}`) && response.request().method() === 'PUT',
      { timeout: 60_000 })
      await page.getByRole('button', { name: 'Save to my schedule' }).click()
      expect((await saved).ok()).toBe(true)

      const note = page.getByRole('region', { name: 'Notifications' }).getByRole('status')
      await expect(note).toContainText('Saved to my schedule')
      await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined))))
      // Above the bar, not over it.
      const toastBox = (await note.boundingBox())!
      const barBox = (await bar(page).boundingBox())!
      expect(toastBox.y + toastBox.height).toBeLessThanOrEqual(barBox.y)

      // And the tap really lands: Playwright refuses a click another element would intercept.
      await bar(page).getByRole('link', { name: 'Schedule' }).click()
      await expect(page).toHaveURL(new RegExp(`/e/${gathering.slug}/schedule`))
      expect(errors).toEqual([])
    } finally {
      await close()
    }
  })

  // ── content starts directly below the navigation ──────────────────────────────────────────

  test('attendee and organizer pages have no redundant context banner', async ({ browser }) => {
    for (const viewport of [PHONE, LAPTOP]) {
      const { page, close } = await shell(browser, viewport)
      try {
        for (const path of [`sessions/${sessionId}`, 'my-votes', 'admin', 'admin/setup']) {
          await openWorkspace(page, `/e/${gathering.slug}/${path}`)
          await expect(page.getByTestId('workspace-context')).toHaveCount(0)
          await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toHaveCount(0)
          const content = page.locator('#workspace-main > .workspace-content')
          await expect(content).toBeVisible()
          await expect(content.getByRole('heading').first()).toBeVisible({ timeout: 60_000 })
          expect((await content.boundingBox())!.y).toBe(viewport === PHONE ? 64 : 0)
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
          await page.screenshot({ path: `/tmp/unconference-no-banner-${path.replaceAll('/', '-')}-${viewport.width}.png` })
        }
      } finally {
        await close()
      }
    }
  })

  test('content keeps clear of the floating bar on a phone, and gives the room back on a laptop', async ({ browser }) => {
    const phone = await shell(browser, PHONE)
    try {
      await openWorkspace(phone.page, `/e/${gathering.slug}/sessions`)
      const padding = await phone.page.locator('#workspace-main').evaluate((el) => parseFloat(getComputedStyle(el).paddingBottom))
      expect(padding).toBeGreaterThanOrEqual(88)
    } finally {
      await phone.close()
    }

    const laptop = await shell(browser, LAPTOP)
    try {
      await openWorkspace(laptop.page, `/e/${gathering.slug}/sessions`)
      const padding = await laptop.page.locator('#workspace-main').evaluate((el) => parseFloat(getComputedStyle(el).paddingBottom))
      expect(padding).toBe(0)
    } finally {
      await laptop.close()
    }
  })

  test('account sections fit narrow screens and keep sharing and connections in their own tabs', async ({ browser }) => {
    for (const width of [320, 390, 1280]) {
      const { page, close } = await shell(browser, { width, height: 844 })
      try {
        await openWorkspace(page, `/e/${gathering.slug}/participants?settings=1`)
        const dialog = page.getByRole('dialog', { name: 'Account', exact: true })
        await expect(dialog).toBeVisible()
        for (const tab of ['Profile', 'Identity', 'Connections', 'Preferences']) {
          await dialog.getByRole('tab', { name: tab, exact: true }).click()
          const panel = dialog.getByRole('tabpanel')
          await expect(panel).toBeVisible()
          if (tab === 'Connections') {
            await expect(panel.getByRole('heading', { name: 'Connect an AI assistant' })).toBeVisible()
            await expect(panel.getByRole('heading', { name: 'Subscribe to your schedule' })).toBeVisible()
          }
          if (tab === 'Preferences') {
            await expect(panel.getByRole('switch', { name: 'Publicly list me as a host of this gathering', exact: false })).toBeVisible()
          }
          expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
          const box = (await dialog.boundingBox())!
          expect(box.x).toBeGreaterThanOrEqual(0)
          expect(box.x + box.width).toBeLessThanOrEqual(width)
          await page.screenshot({ path: `/tmp/unconference-account-${tab}-${width}.png` })
        }
        await dialog.getByRole('button', { name: 'Close', exact: true }).first().click()
        await expect(page.locator('#workspace-main').getByRole('checkbox')).toHaveCount(0)
      } finally { await close() }
    }
  })

  test('compact schedule actions create a usable, revocable personal subscription', async ({ browser }) => {
    const { page, close } = await shell(browser, { width: 320, height: 844 })
    try {
      await openWorkspace(page, `/e/${gathering.slug}/schedule?view=mine`)
      const heading = page.getByTestId('schedule-heading')
      const exportBox = (await heading.getByRole('button', { name: 'Export', exact: true }).boundingBox())!
      const subscribe = heading.getByRole('button', { name: 'Subscribe', exact: true })
      const subscribeBox = (await subscribe.boundingBox())!
      expect(exportBox.y).toBe(subscribeBox.y)
      expect(exportBox.width).toBe(subscribeBox.width)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: '/tmp/unconference-schedule-320.png' })
      await subscribe.click()
      const dialog = page.getByRole('dialog')
      const created = page.waitForResponse((r) => r.url().endsWith('/api/me/calendar-feed') && r.request().method() === 'POST')
      await dialog.getByRole('button', { name: 'Create subscription', exact: true }).click()
      const response = await created
      expect(response.status()).toBe(201)
      const data = await response.json()
      await expect(dialog.getByRole('link', { name: 'Open in my calendar app' })).toHaveAttribute('href', data.webcalUrl)
      const path = new URL(data.url).pathname
      const feed = await page.request.get(base + path)
      expect(feed.status()).toBe(200)
      expect(await feed.text()).toContain('BEGIN:VCALENDAR')
      const revoked = page.waitForResponse((r) => r.url().includes('/api/me/calendar-feed?id=') && r.request().method() === 'DELETE')
      await dialog.getByRole('button', { name: 'Revoke', exact: true }).click()
      expect((await revoked).ok()).toBe(true)
      expect((await page.request.get(base + path)).status()).toBe(404)
    } finally { await close() }
  })

  // ── accessibility ─────────────────────────────────────────────────────────────────────────

  test('the shell has no serious or critical accessibility violations', async ({ browser }) => {
    test.setTimeout(180_000)
    const failures: string[] = []

    for (const [label, viewport] of [['phone', PHONE], ['laptop', LAPTOP]] as const) {
      const { page, close } = await shell(browser, viewport)
      try {
        for (const path of [`/e/${gathering.slug}/sessions`, `/e/${gathering.slug}/sessions/${sessionId}`]) {
          await openWorkspace(page, path)
          await page.waitForLoadState('networkidle').catch(() => undefined)
          failures.push(...(await violations(page, `${label} ${path}`)))
        }
        // And with the expanded navigation open, which is the one surface the shell adds.
        if (label === 'phone') {
          await moreButton(page).click()
          await expect(page.getByTestId('more-navigation')).toBeVisible()
          failures.push(...(await violations(page, 'phone, expanded navigation open')))
        }
      } finally {
        await close()
      }
    }

    expect(failures, failures.join('\n')).toEqual([])
  })

  /**
   * Serious and critical only: the threshold `tests/a11y.spec.ts` set, for the same reason.
   * The sheet fades in over its backdrop, and a contrast reading taken mid-fade measures a
   * colour nobody ever sees, so every animation is let finish first.
   */
  async function violations(page: Page, where: string): Promise<string[]> {
    await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))))
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
    return results.violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => `${where}: ${v.id} [${v.impact}] — ${v.help} — ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`)
  }
})
