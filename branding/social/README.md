# Social stories

Instagram and WhatsApp stories, 1080 × 1920 PNG.

| File | Story |
|---|---|
| `1-launch.png` | Launch: what Blendy Play is and the link |
| `2a-break-the-glass.png` | "Break the glass", frame 1: a sealed case, "Tap to break the glass" |
| `2b-glass-broken.png` | "Break the glass", frame 2: the glass broken, early access to the new release |

Post 2a and 2b back to back: tapping a story moves to the next one, so the
viewer's tap on 2a is what cracks the glass in 2b. 2b then sends people to the
real glass on the site, where three film questions break it early. Post them
before the glass on the downloads breaks for everyone; after that, post 1.

On Instagram, put a Link sticker over the purple box:
`https://blendy.mainakimani.com/#download` on 2b (it opens the page at the
glass), and `https://blendy.mainakimani.com` on 1.

The images are drawn by `stories.html`. To change the wording or prices,
edit it and render each frame with headless Chrome, for example:

```sh
google-chrome --headless=new --hide-scrollbars --allow-file-access-from-files \
  --force-device-scale-factor=1 --window-size=1080,1920 --virtual-time-budget=3000 \
  --screenshot=1-launch.png "file://$PWD/stories.html#launch"
```

The frames are `#launch`, `#sealed` and `#broken`. The page uses the
Ubuntu Bold font from `branding/fonts/` and `mark.png` here, a copy of the
portal's `public/brand/mark.png`.

No film posters are used: that artwork belongs to the studios.
