import { initializeApp } from 'firebase/app'
import { getToken, initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check'
import { getAuth, signInAnonymously } from 'firebase/auth'
import { getAI, GoogleAIBackend } from 'firebase/ai'

// Reference each variable directly. Never alias `import.meta.env` as a whole object: in a
// production build Vite inlines that object with EVERY VITE_ variable, debug token included.
const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}
const siteKey = import.meta.env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY
if (!config.apiKey || !config.projectId || !config.appId || !siteKey)
  throw new Error('Missing Firebase config in .env (see .env.example)')

export const app = initializeApp(config)

// App Check is enforced for AI Logic. Debug provider in dev only; this whole block is
// dropped from production builds, and scripts/check-dist.mjs fails the build if it is not.
if (import.meta.env.DEV) {
  ;(self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN: string | boolean }).FIREBASE_APPCHECK_DEBUG_TOKEN =
    import.meta.env.VITE_APPCHECK_DEBUG_TOKEN || true
}
const appCheck = initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(siteKey), isTokenAutoRefreshEnabled: true })

export const ai = getAI(app, { backend: new GoogleAIBackend() })

// Anonymous Auth on first load: no account, no personal data; the SDK keeps the same anonymous user in this browser.
// Checked together with App Check at start. Failures are logged, never shown with any report content.
export type Status = { auth: 'ok' | string; appCheck: 'ok' | string }
export async function startSession(): Promise<Status> {
  const [a, c] = await Promise.allSettled([signInAnonymously(getAuth(app)), getToken(appCheck)])
  const s: Status = { auth: a.status === 'fulfilled' ? 'ok' : String(a.reason), appCheck: c.status === 'fulfilled' ? 'ok' : String(c.reason) }
  console.info(`ClearReport start: anonymous auth ${s.auth}, App Check ${s.appCheck}`)
  return s
}
