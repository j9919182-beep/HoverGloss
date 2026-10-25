/* Only PCM resampling and transfer; no network, storage, microphone or recognition. */
class HoverGlossPCM extends AudioWorkletProcessor {
  constructor() {
    super(); this.ratio = sampleRate / 16000; this.sum = 0; this.weight = 0;
    this.frame = new Float32Array(1600); this.offset = 0;
  }
  process(inputs, outputs) {
    for (const channels of outputs) for (const channel of channels) channel.fill(0);
    const channels = inputs[0];
    if (!channels?.length) return true;
    for (let i = 0; i < channels[0].length; i++) {
      let value = 0;
      for (const channel of channels) value += channel[i] || 0;
      value /= channels.length;
      let remaining = 1;
      while (remaining > 1e-8) {
        const take = Math.min(remaining, this.ratio - this.weight);
        this.sum += value * take; this.weight += take; remaining -= take;
        if (this.weight >= this.ratio - 1e-8) {
          this.frame[this.offset++] = this.sum / this.ratio; this.sum = 0; this.weight = 0;
          if (this.offset === this.frame.length) {
            this.port.postMessage({ type: "pcm", samples: this.frame }, [this.frame.buffer]);
            this.frame = new Float32Array(1600); this.offset = 0;
          }
        }
      }
    }
    return true;
  }
}
registerProcessor("hovergloss-pcm", HoverGlossPCM);
