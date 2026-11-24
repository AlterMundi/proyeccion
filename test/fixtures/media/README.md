# Synthetic playback fixtures

These original generated fixtures require no external media service. They are
excluded from the renderer package. Regenerate with FFmpeg:

```sh
ffmpeg -f lavfi -i 'sine=frequency=440:sample_rate=8000:duration=0.7' -c:a pcm_s16le -fflags +bitexact tone.wav
ffmpeg -f lavfi -i 'testsrc2=size=48x32:rate=15:duration=0.7' -c:v libvpx -b:v 70k -an -threads 1 -fflags +bitexact pattern.webm
```
