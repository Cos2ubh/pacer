# Pacer

A browser extension that speeds up slow speakers on YouTube. It listens to how fast the person in the video is actually talking. If they're slower than your comfortable pace, it speeds the video up to match. If they already talk at a normal pace, it leaves the video alone. It never slows anything down.

Works without captions. Runs entirely in your browser and collects nothing.

## How it decides

1. **Listen.** Pacer reads the loudness of the video's sound in the speech band (around 1 kHz) 50 times a second. It doesn't record, store or send any audio.
2. **Count syllables.** Every vowel is a burst of loudness, so syllables show up as peaks. A peak counts when it stands at least 2 dB above the dips on either side and comes at least 0.1 s after the previous one.
3. **Ignore pauses.** Silences longer than 0.3 s don't count as talking time. That gives the *articulation rate*: syllables per second while actually speaking.
4. **Check that it's speech.** The reading is only trusted when there's enough speech, the volume swings the way speech does, there are real pauses, and the syllables come at irregular intervals rather than a steady musical beat.
5. **Set the speed once.** Speed = your target pace ÷ the speaker's pace, capped at your maximum. Anything under a 1.1x boost is left at 1x. After about 15 s of listening, the speed is set once and stays put.
6. **Remember the channel.** Each channel's average pace is saved, so its next video starts at the right speed immediately.

If you change the speed yourself, Pacer leaves that video alone.

## Controls

- **Everywhere**: popup checkbox, or <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd>
- **This channel**: e.g. turn it off for music channels
- **This video**: one-off skip
- **Comfortable pace**: raise it if Pacer leaves too many videos alone; lower it if it speeds things up too much
- **Fastest speed**: hard cap

## Build and install

```sh
npm install
npm run build
```

In Chrome, open `chrome://extensions`, turn on Developer mode, choose **Load unpacked** and pick the `dist` folder.

```sh
npm test          # estimator and decision tests
npm run typecheck
```

## Known limits

- Tuning comes from synthetic speech. Real-world thresholds will need adjusting against actual videos.
- Speech over loud background music may read as "unsure" and be left alone.
- The pace is measured in syllables, so the right target differs between languages.
- Another extension that processes YouTube's audio (equaliser, volume booster) blocks Pacer from listening. Channel memory still works.
- Watch pages only; Shorts and embedded players are skipped.

## License

MIT
