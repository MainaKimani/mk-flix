# Social stories

Instagram and WhatsApp stories, 1080 × 1920 PNG.

| File | Story |
|---|---|
| `1-launch.png` | Launch: what Blendy Play is and the link |
| `2a-break-the-glass.png` | "Break the glass", frame 1: a sealed case, "Tap to break the glass" |
| `2b-glass-broken.png` | "Break the glass", frame 2: the glass broken, early access to the new release |

Post 2a and 2b back to back: tapping a story moves to the next one, so the
viewer's tap on 2a is what breaks the glass in 2b. On Instagram, put a Link
sticker to `https://blendy.mainakimani.com` over the purple box (on 2b only
for the second story).

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
