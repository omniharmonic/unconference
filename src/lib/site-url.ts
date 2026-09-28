/** The platform hub must leave a gathering subdomain when one is in use. */
export const PLATFORM_HOME = `${(process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/+$/, '')}/`
