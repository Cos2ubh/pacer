# 🐢➡️🐇 Pacer

**Some people talk slow. Your time doesn't have to.**

Pacer is a browser extension that listens to whoever's talking in your YouTube video and asks one question: *is this person slower than you'd like?*

- Slow lecturer, drawn-out tutorial? **Sped up**, just enough to match your comfortable pace.
- Normal speaker? **Left alone at 1x.**
- Fast talker? **Also left alone.** Pacer never slows anything down.

No captions needed. No servers. No tracking. It all happens in your browser, and Pacer forgets the sound as soon as it has measured it.

---

## 🎧 How it knows

It doesn't understand a word anyone says, and it doesn't need to. It just counts **syllables**.

Every vowel you speak is a little burst of loudness: *ba-NA-na* is three bumps. Pacer watches the volume of the speech band (around 1 kHz) 50 times a second and counts the bumps:

```
loudness
   ▲      ▄█▄     ▄█▄  ▄█▄            ▄█▄    ▄█▄
   │    ▄█████▄ ▄██████████▄        ▄█████▄██████▄
   │▁▁▄█████████████████████▄▁▁▁▁▁▁▄██████████████▄▁▁
   └──────────────────────────────────────────────────▶ time
         syl     syl   syl    (pause,          syl    syl
                               not counted)
```

1. **Find the bumps.** A peak counts when it rises at least 2 dB above the dips on both sides.
2. **Skip the "ummm… pause."** Silences longer than 0.3 s don't count as talking time.
3. **Divide.** Syllables ÷ talking time = how fast this person *really* speaks.
4. **Sanity-check.** Is it actually speech? Music has a steady beat and never pauses. Speech is irregular and takes breaths. If it smells like music or noise, Pacer shrugs and touches nothing.
5. **Kick in fast.** After about **4 seconds of actual speech** (usually 5–6 seconds into the video), the speed gets set: *your pace ÷ their pace*.
6. **One correction, max.** Pacer keeps listening until it has heard about 12 seconds of speech. It adjusts only if the first guess was off by 0.15x or more. No constant speeding up and slowing down mid-video.
7. **Remember the channel.** Next time you open that channel, Pacer starts at the right speed in the very first second.

> Your target is **4.5 syllables/second** by default. Someone talking at 3 gets bumped to **1.5x**. Someone at 4.4 stays at **1x**.

**No idea what "5 syllables a second" sounds like?** Nobody does. Hit **▶ Hear this pace** in the popup and your browser's built-in voice reads a sample sentence at exactly that pace. Slide, listen, repeat until it feels right. 🎚️

As a sanity check, Pacer's estimator was run on a synthesized voice at four speeds. Between 3.9 and 6 syllables/s it landed within about **6%** of the true count, which is the range where it decides what to speed up.

## 🕹️ You're the boss

| Want to… | Do this |
|---|---|
| Switch it on/off for this video | Click the **speedometer button** in the player's control bar |
| Make it re-check the speaker | Click the button off, then on again |
| Turn it all off | Popup toggle, or <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd> |
| Never touch a channel (music, ASMR…) | Untick **This channel** |
| Speed up more videos | Slide **Comfortable pace** up |
| Never go crazy fast | Set **Fastest speed** |

And if you change the speed yourself, Pacer takes the hint: it switches off for that video and keeps your speed. 🫡 Click the button whenever you want it back.

A small label on the video always tells you what Pacer just did, and screen readers announce it too.

## 🚀 Install (developer mode for now)

```sh
git clone https://github.com/Cos2ubh/pacer.git
cd pacer
npm install
npm run build
```

Then open `chrome://extensions`, flip on **Developer mode**, hit **Load unpacked** and choose the `dist` folder. Open a slow talker and watch the magic.

## 🔬 Under the hood

```
src/
  estimator.ts   loudness → syllables/sec + confidence (pure, tested)
  decide.ts      syllables/sec → playback speed
  audio.ts       taps the video's sound without changing what you hear
  youtube.ts     every YouTube-specific selector, quarantined in one file
  content.ts     the per-video brain
  popup.ts       the knobs
```

```sh
npm test           # the estimator vs. synthetic speech from 2.5 to 6.5 syl/s
npm run typecheck
```

On synthetic speech the estimator lands within about **6%** of the true rate. Real humans are messier, which is why the next section exists.

## 🚧 Honest limits

- **Early days.** The thresholds come from synthetic speech and still need tuning on real videos.
- **Talking over loud music** may confuse it. When it isn't sure, it does nothing rather than guessing.
- **Languages differ.** Spanish and Japanese pack more syllables per second than English, so you may want a different target for them.
- **Audio extensions clash.** If an equaliser or volume booster already owns the video's sound, Pacer can't listen. Channel memory still works.
- **Watch pages only.** No Shorts, no embeds.

Found a speaker Pacer gets wrong? [Open an issue](https://github.com/Cos2ubh/pacer/issues) with the link. Those are the best test cases.

## 🔒 Privacy

Pacer only runs on youtube.com and only asks for storage. It makes no network requests, and nothing about your viewing leaves your machine. The only thing it saves is a number per channel: how fast they talk.

## 📜 License

MIT. Take it, fork it, make your own slow people go fast.
