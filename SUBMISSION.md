# Submission Checklist

This package is ready to submit once the manual chaos recording is added or linked.

## Required Deliverables

- [x] Next.js app builds with `npm install && npm run build && npm run start`.
- [x] `README.md` includes architecture summary, run instructions, state machine, and screenshots.
- [x] `DECISIONS.md` documents ordering, deduplication, layout stability, reconnection recovery, scale-up notes, and the observed ACK race.
- [x] Normal-mode screenshots are in `docs/screenshots/`.
- [ ] Chaos mode recording is still required.

## Recording Slot

Either upload an unlisted Loom/YouTube recording and paste the link in the submission email, or save the MP4 here:

```text
docs/recordings/chaos-mode-proof.mp4
```

Use `docs/manual-live-proof.md` for the exact live checklist.

## Email

To: `anuran@getalchemystai.com`

CC: `vedanta@getalchemystai.com`, `khushi@getalchemystai.com`

Subject:

```text
Full Stack AI Engineer Assignment  <Your Name>
```

Body:

```text
Hi Anuran,

Here is my Full Stack AI Engineer assignment submission:

Repository/tarball: <link or attached tarball>
Chaos mode recording: <Loom/YouTube link or note that MP4 is included in docs/recordings/>

I included README.md, DECISIONS.md, normal-mode screenshots, and the provided agent-server instructions.

Thanks,
<Your Name>
```
