# App icon

**Slack's manifest cannot set the app icon.** There is no field for it — the API that reads a
manifest does not accept one, and `users.setPhoto` is for human accounts, not bots. It is a manual
upload, once per app, and it is the only part of this app's configuration that is not in this repo.

## Where to upload it

    api.slack.com/apps → <the app> → Basic Information → Display Information → App icon

Do it on **both** apps. Dev (Socket Mode) and prod (HTTP) are two separate Slack apps, and display
information is per app — so an icon set on one leaves the other showing Slack's default grey
placeholder. If they end up with different icons, that is a useful thing rather than a mistake: in a
workspace where both are installed, the icon is the fastest way to tell which bot just posted.

## What the file has to be

- **Square.** A non-square image is centre-cropped, which usually eats the thing that made it read.
- **PNG or JPG**, 512–2000 px on a side. 512 is the floor Slack accepts; 1024 is a safe upload size.
- Readable at **20 px** — that is the size it actually renders at beside every message in the
  channel. Whatever the design is, check it small before uploading: a shutter blade or an aperture
  reads at that size; a camera body with a lens and a strap does not.

Keep the source here (`slack/icon/icon.png`, plus whatever it was made from) so the next person to
create an app from the manifest has the file to upload rather than a design decision to re-make.

## What it is *not*

`chat.postMessage` takes `icon_url` and `icon_emoji` with the `chat:write.customize` scope, which
changes how one message looks. It does not change the app's profile, it applies per call rather than
once, and a bot whose avatar differs between its own messages reads as two bots. Not worth it.
