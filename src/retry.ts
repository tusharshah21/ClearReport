// Plain code, no imports: how every cloud call handles a busy model. Used by extraction, the explanation, the Hindi
// translation and "What does this test mean?" (cloud side).
// Busy or rate-limited ("[500 ] This model is currently experiencing high demand", 503, 429): wait and retry with
// backoff on the main model; if it is still busy, try the fallback model once. Any other error is thrown at once.
// A free-tier DAILY quota error (429 "requests per day limit exceeded") is not "busy": waiting minutes or switching
// model would only spend more of the day's quota, so it is never retried and never sent to the fallback model.
export const RETRYABLE = /\[(429|500|503)\b|high demand|overloaded|resource.?exhausted/i
export const RETRY_DELAYS_MS = [1500, 4000, 10000]
export const isDailyLimit = (e: unknown) => /per[\s-]?day|PerDay/i.test(String(e)) && /\[429\b|quota|exhausted/i.test(String(e))
export const isBusy = (e: unknown) => RETRYABLE.test(String(e)) && !isDailyLimit(e)
// The free-tier daily quota resets at midnight Pacific time: 1:30 PM IST while the US is on standard time.
export const LIMIT_REACHED = "Today's free AI limit has been reached."
export const LIMIT_PLAIN = 'Your results are shown with plain-language checks only.'
export const LIMIT_AFTER = 'Try again after 1:30 PM IST.'

const wait = (ms: number) => new Promise((ok) => setTimeout(ok, ms * (0.75 + Math.random() / 2))) // jitter: parallel calls do not retry in lockstep

export async function retrying<T>(what: string, call: () => Promise<T>, delays = RETRY_DELAYS_MS): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await call()
    } catch (e) {
      console.info(`ClearReport ${what} failed (attempt ${attempt + 1}): ${String(e)}`)
      if (!isBusy(e) || attempt >= delays.length) throw e
      await wait(delays[attempt])
    }
  }
}

// The model that answered is returned with the value, so the page can say which one it was.
export async function withFallback<T>(what: string, models: { main: string; fallback: string | null }, call: (model: string) => Promise<T>, delays = RETRY_DELAYS_MS): Promise<{ value: T; model: string }> {
  try {
    return { value: await retrying(what, () => call(models.main), delays), model: models.main }
  } catch (e) {
    if (!isBusy(e) || !models.fallback || models.fallback === models.main) throw e
    console.info(`ClearReport ${what}: ${models.main} is still busy, trying ${models.fallback} once`)
    return { value: await call(models.fallback), model: models.fallback }
  }
}
