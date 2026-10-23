// Pages' bundler imports JSON directly. No import attributes, so this also
// compiles with the older Functions compiler used by the Pages build image.
import nowData from '../../src/content/now.json'
import { nowResponse } from '../../lib/now-api.js'

export function onRequest({ request }) {
  return nowResponse(request, nowData)
}
