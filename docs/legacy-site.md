# Classic edition: iOS 9.3.5

This edition uses the existing rendered content and translations. It is generated
with the modern site, rather than maintained as another copy of the content.
Nothing in this document requires deploying it before testing on the iPad.

## Sources consulted

The compatibility baseline comes from these original references, checked on
October 19, 2026:

- [Apple: Safari 9.0 release notes](https://developer.apple.com/library/archive/releasenotes/General/WhatsNewInSafari/Articles/Safari_9_0.html).
  The iOS 9 viewport section documents `shrink-to-fit=no`. This edition uses
  `width=device-width, initial-scale=1.0, shrink-to-fit=no`, without disabling zoom.
- [Apple: Safari CSS Reference, Supported CSS Properties](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariCSSRef/Articles/StandardCSSProperties.html).
  The availability sections document `-webkit-box-sizing` from iOS 1.1,
  `-webkit-border-radius` from iOS 1.0, and `-webkit-box-shadow` from iOS 2.0.
  The box-sizing prefix and standard equivalent are emitted together. The
  classic design uses square borders without rounded corners or shadows.
- [Apple: Optimizing Web Content](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/OptimizingforSafarioniPhone/OptimizingforSafarioniPhone.html),
  updated December 12, 2016. This documents width media queries, including their
  use inside a CSS block in HTML. This edition embeds its stylesheet directly.
- [W3C: CSS Level 2, April 11, 2008](https://www.w3.org/TR/2008/REC-CSS2-20080411/css2.html).
  The layout uses its normal flow, float/clear, percentage widths, box model,
  inline-block navigation, and table layout, rather than modern layout engines.

The visual direction is a mid-2000s personal homepage: a framed blue masthead,
beveled navigation tabs, compact panels, a webmaster sidebar, dotted separators,
and 88 by 31 pixel web buttons.
The standards above specify the implementation baseline, not a mandated visual
style.

## Loading and rendering

- All reading and navigation work without JavaScript.
- CSS is embedded in the document, so a failed external stylesheet request
  cannot leave the page unstyled. There are no imported fonts or CSS bundles.
- There is no Vue runtime, Vite client, module loader, CSS custom property,
  CSS grid, flexbox dependency, filter, continuous animation, or WebGL scene.
- JPEG alternatives for WebP assets are stored in R2. Their committed URL map is
  `src/generated/legacy-media.json`. No image binaries are added to Git.
- Mapped JPEGs are delivered from the page's own host. Production reads only
  `legacy/images/<sha256>.jpg` and current JPEG/PNG covers under
  `now-playing/artwork/` through the `MEDIA` binding; the local server
  fetches those exact public R2 keys and uses a bounded 16 MB memory cache.
  The iPad needs no separate HTTPS connection to R2 during a local HTTP test.
- Optional live readings use a small ES5 script and XMLHttpRequest. They never
  block reading or styling, and are not needed for navigation.
- The admin, GitHub proxy, uploads, and private ingest routes are not available
  through the classic preview. Its API proxy allows public GET/HEAD routes only.

## Test on the iPad

Stop the previous Vite process on port 5176, then run:

```bash
npm run dev:old
```

The dedicated server rebuilds the classic pages and prints its LAN URLs. Open
`http://YOUR-COMPUTER-IP:5176/` on the same network. No `/_legacy/` suffix is needed.
If the port is occupied, use `LEGACY_PORT=5177 npm run dev:old`.

This is an ordinary HTTP server, separate from Vite. CSS edits appear on refresh.
Re-run `npm run build` after editing Vue content so the shared prerendered content
is refreshed, then restart the classic server. It does an initial full build
automatically when no existing build is present.

## Verification limits

Automated checks validate plain HTML delivery, embedded styling, payload sizes,
the read-only proxy, JPEG caching, and rendering with JavaScript disabled.
Modern Chromium with an iPad user-agent is **not** an iOS 9 WebKit emulator.
Real Safari 9 rendering and deployed certificate trust still require the iPad.
Production redirect activation remains disabled until the hostname and real
device have been verified. Nothing in this workflow changes DNS or deploys.
