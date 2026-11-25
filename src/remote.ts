// Remote Config: model name, prompt version and feature flags, with in-code defaults.
// The app starts with the defaults and switches to the fetched values when they arrive (or keeps the defaults if
// Remote Config is unreachable). Callers read config() at the moment they need a value, never once at start.
import { fetchAndActivate, getRemoteConfig, getValue } from 'firebase/remote-config'
import { app } from './firebase'

export const DEFAULTS = {
  cloud_model: 'gemini-3.5-flash-lite', // documented default, pinned so results are reproducible
  cloud_model_fallback: 'gemini-3.8-flash', // tried once when cloud_model is still busy after its retries; '' turns it off
  prompt_version: 'v7',
  hindi_enabled: true,
  path3_enabled: false, // "send the full report" option: paused while the Gemini API is on the free tier
}
export type Config = { model: string; fallback: string | null; promptVersion: string; hindi: boolean; path3: boolean }

const rc = getRemoteConfig(app)
rc.defaultConfig = DEFAULTS
rc.settings.minimumFetchIntervalMillis = import.meta.env.DEV ? 60_000 : 3_600_000

let current: Config = read()
function read(): Config {
  return {
    model: getValue(rc, 'cloud_model').asString() || DEFAULTS.cloud_model,
    fallback: getValue(rc, 'cloud_model_fallback').asString() || null,
    promptVersion: getValue(rc, 'prompt_version').asString() || DEFAULTS.prompt_version,
    hindi: getValue(rc, 'hindi_enabled').asBoolean(),
    path3: getValue(rc, 'path3_enabled').asBoolean(),
  }
}
export const config = () => current

// Called once at start, not awaited: after 3 s the defaults (or the last cached values) stay.
export async function loadConfig(): Promise<Config> {
  try {
    await Promise.race([fetchAndActivate(rc), new Promise((_, no) => setTimeout(() => no(new Error('timeout')), 3000))])
  } catch (e) {
    console.info(`ClearReport Remote Config: using defaults (${String(e)})`)
  }
  return (current = read())
}
