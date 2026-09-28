import { test, expect, type Page } from '@playwright/test'
import postgres from 'postgres'
import AxeBuilder from '@axe-core/playwright'
import { createTestAccount, type TestAccount } from './helpers/gathering'
import { STEP_LABELS, WIZARD_STEPS } from '../src/app/create/useWizardState'

const base = 'http://localhost:3001'
const local = /^postgres(?:ql)?:\/\/[^/]+@(localhost|127\.0\.0\.1):/.test(process.env.DATABASE_URL || '')
let db: postgres.Sql
let account: TestAccount

test.beforeAll(async () => {
  test.skip(!local, 'Requires the local stack and mock PLC')
  db = postgres(process.env.DATABASE_MIGRATION_URL || process.env.DATABASE_URL!, { max: 2, onnotice: () => {} })
  account = await createTestAccount('wizard-navigation', { sql: db })
})
test.afterAll(async () => { await account?.cleanup(); await db?.end({ timeout: 5 }) })

async function expectControls(page: Page, first: boolean) {
  const actions = page.getByTestId('wizard-actions')
  const back = first ? actions.getByRole('link', { name: 'Back to My gatherings' }) : actions.getByRole('button', { name: 'Back', exact: true })
  await expect(back).toBeVisible()
  const box = await back.boundingBox()
  const viewport = page.viewportSize()!
  expect(box!.y).toBeGreaterThan(viewport.height - 110)
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height)
  expect(box!.height).toBeGreaterThanOrEqual(44)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width)
  return back
}

for (const width of [320, 390, 1280]) {
  test(`setup keeps navigation stable through every step at ${width}px`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width, height: 844 } })
    const [name, ...value] = account.cookie.split('=')
    await context.addCookies([{ name, value: value.join('='), url: base }])
    const page = await context.newPage()
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    try {
      await page.goto(`${base}/create`)
      await expect(page.getByTestId('wizard-intro')).toBeVisible()
      const back = await expectControls(page, true)
      await expect(back).toHaveAttribute('href', /\/#my-gatherings$/)
      await page.getByTestId('wizard-actions').getByRole('button', { name: 'Continue to Basics' }).click()
      await expect(page.locator('#wizard-validation')).toBeFocused()
      await expect(page.getByLabel('Gathering name', { exact: true })).toBeVisible()
      await page.screenshot({ path: `/tmp/unconference-wizard-first-${width}.png` })
      await page.getByLabel('Gathering name', { exact: true }).fill(`Neighbors ${width}`)
      await page.locator('#identity-ack').check()
      for (let step = 1; step < WIZARD_STEPS.length; step++) {
        await page.getByTestId('wizard-actions').getByRole('button', { name: `Continue to ${STEP_LABELS[WIZARD_STEPS[step]]}` }).click()
        await expect(page.getByTestId('wizard-step-content')).toHaveAttribute('aria-label', `${WIZARD_STEPS[step]} setup`)
        await expect(page.getByTestId('wizard-intro')).toHaveCount(0)
        await expectControls(page, false)
        if (step === 1) {
          await page.screenshot({ path: `/tmp/unconference-wizard-basics-${width}.png`, animations: 'disabled' })
          if (width === 390) {
            const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
            expect(audit.violations.filter(v => v.impact === 'serious' || v.impact === 'critical')).toEqual([])
            await page.setViewportSize({ width, height: 480 })
            await expectControls(page, false)
            await page.setViewportSize({ width, height: 844 })
          }
        }
        if (step === 2) {
          await page.getByLabel('Start date', { exact: true }).fill('2027-06-12')
          await page.getByLabel('End date', { exact: true }).fill('2027-06-13')
          await expect(page.getByRole('button', { name: 'Review with defaults' })).toBeEnabled()
        }
        // Long and short steps must leave the same controls fixed in the same place.
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
        await expectControls(page, false)
        const progress = await page.getByTestId('wizard-progress').boundingBox()
        expect(progress!.y).toBeGreaterThanOrEqual(76)
        expect(progress!.y).toBeLessThan(120)
      }
      const create = page.getByTestId('wizard-actions').getByRole('button', { name: 'Create gathering', exact: true })
      await expect(create).toBeDisabled()
      await page.locator('#terms-accepted').check()
      await expect(create).toBeEnabled()
      await page.screenshot({ path: `/tmp/unconference-wizard-review-${width}.png` })
      for (let step = WIZARD_STEPS.length - 2; step >= 0; step--) {
        await page.getByTestId('wizard-actions').getByRole('button', { name: 'Back', exact: true }).click()
        await expect(page.getByTestId('wizard-step-content')).toHaveAttribute('aria-label', `${WIZARD_STEPS[step]} setup`)
        await expectControls(page, step === 0)
      }
      await expect(page.getByTestId('wizard-intro')).toHaveCount(0)
      await expect(page.getByLabel('Gathering name', { exact: true })).toHaveValue(`Neighbors ${width}`)
      await page.getByTestId('wizard-actions').getByRole('link', { name: 'Back to My gatherings' }).click()
      await expect(page).toHaveURL(/\/#my-gatherings$/)
      await page.goto(`${base}/create`)
      await page.getByRole('button', { name: 'Resume draft', exact: true }).click()
      await expect(page.getByLabel('Gathering name', { exact: true })).toHaveValue(`Neighbors ${width}`)
      // Use the full progress map to return to Dates, then take the short route to Review.
      if (width < 1024) await page.getByLabel('Setup step').selectOption('2')
      else await page.getByRole('navigation', { name: 'Wizard steps' }).getByRole('button', { name: 'Dates', exact: true }).click()
      await page.getByRole('button', { name: 'Review with defaults' }).click()
      await expect(page.getByTestId('wizard-step-content')).toHaveAttribute('aria-label', 'review setup')
      await expect(create).toBeDisabled() // consent is never restored from a saved draft
      if (width === 390) {
        await page.locator('#terms-accepted').check()
        let finishRequest!: () => void
        let received!: () => void
        const receivedRequest = new Promise<void>(resolve => { received = resolve })
        const pending = new Promise<void>(resolve => { finishRequest = resolve })
        let requests = 0
        await page.route('**/api/events/create', async route => {
          requests++
          expect(route.request().postDataJSON().wizardState.basics.name).toBe(`Neighbors ${width}`)
          received()
          await pending
          await route.fulfill({ status: 503, json: { error: 'Please retry creation.' } })
        })
        await create.click()
        await receivedRequest
        try {
          await expect(page.getByTestId('wizard-actions').getByRole('button', { name: 'Creating…' })).toBeDisabled()
          await expect(page.getByTestId('wizard-actions').getByRole('button', { name: 'Back', exact: true })).toBeDisabled()
          await expect(page.getByLabel('Setup step')).toBeDisabled()
        } finally { finishRequest() }
        await expect(page.locator('#create-submit-error')).toContainText('Please retry creation.')
        await expect(create).toBeEnabled()
        expect(requests).toBe(1)
      }
      expect(errors).toEqual([])
    } finally { await context.close() }
  })
}
