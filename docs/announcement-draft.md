# Announcement Draft

## Short Discord Draft

Hi all. I built a small zero-build browser dashboard on top of the public FinalSpark live stream:

`<repo-or-pages-url>`

It is public-stream-only: no Neuroplatform credentials, no hardware booking, no private platform access. The goal is to make the existing public stream easier to read at a glance: 128-channel raster, firing-rate heatmap, activity timeline, Center of Activity, replay from a real captured frame, and a demo mode for offline inspection.

The marks are simple threshold crossings on the raw public voltage stream at about 3.75 kHz, so they should be read as coarse activity markers rather than assigned cell identities. Feedback on the mapping, explanation layer, or stream handling would be very welcome.

## GitHub Issue Draft

Title: Public LiveMEA dashboard experiment

I made a small static browser dashboard that consumes the public LiveMEA stream used by the live page:

`<repo-or-pages-url>`

Scope:

- Public stream only.
- No Neuroplatform credentials or booked hardware access.
- Zero-build static HTML/CSS/ES modules.
- Live, replay from a real captured frame, and synthetic demo modes.
- 128-channel threshold crossing raster, firing-rate heatmap, activity timeline, Center of Activity, and explanatory notes.

I verified the data contract against the public browser app and the open LiveMEA / LiveMEA_ts / Rust access layers before building. The implementation treats the stream as raw voltage and uses client-side threshold crossings as coarse activity markers. It does not assign cell identity or biological area labels.

I would appreciate feedback on whether this kind of high-level public dashboard is useful, and whether the mapping/explanation layer matches how you prefer the public stream to be presented.

