/**
 * Audio Mixer Worklet Processor
 *
 * Runs on a dedicated audio rendering thread for glitch-free mixing of:
 * - Native microphone audio (mono, 48kHz)
 * - System audio (stereo, 48kHz)
 *
 * Uses ring buffers to handle timing differences between IPC callbacks
 * and the audio rendering loop.
 */

class RingBuffer {
    constructor(capacity) {
        this.capacity = capacity;
        this.buffer = new Float32Array(capacity);
        this.writeIndex = 0;
        this.readIndex = 0;
        this.availableSamples = 0;
    }

    /**
     * Write samples to the ring buffer
     * @param {Float32Array} samples - Samples to write
     * @returns {number} Number of samples actually written
     */
    write(samples) {
        const toWrite = Math.min(samples.length, this.capacity - this.availableSamples);

        for (let i = 0; i < toWrite; i++) {
            this.buffer[this.writeIndex] = samples[i];
            this.writeIndex = (this.writeIndex + 1) % this.capacity;
        }

        this.availableSamples += toWrite;
        return toWrite;
    }

    /**
     * Read samples from the ring buffer
     * @param {Float32Array} output - Buffer to read into
     * @param {number} count - Number of samples to read
     * @returns {number} Number of samples actually read
     */
    read(output, count) {
        const toRead = Math.min(count, this.availableSamples);

        for (let i = 0; i < toRead; i++) {
            output[i] = this.buffer[this.readIndex];
            this.readIndex = (this.readIndex + 1) % this.capacity;
        }

        // Fill remainder with silence
        for (let i = toRead; i < count; i++) {
            output[i] = 0;
        }

        this.availableSamples -= toRead;
        return toRead;
    }

    /**
     * Get number of available samples
     */
    available() {
        return this.availableSamples;
    }

    /**
     * Clear the buffer
     */
    clear() {
        this.writeIndex = 0;
        this.readIndex = 0;
        this.availableSamples = 0;
    }
}

class AudioMixerProcessor extends AudioWorkletProcessor {
    constructor() {
        super();

        // Ring buffers for ~500ms of audio at 48kHz (generous buffer for timing tolerance)
        // Mic is mono
        this.micBuffer = new RingBuffer(48000 * 0.5);
        // System audio is stereo (separate L/R buffers)
        this.sysBufferL = new RingBuffer(48000 * 0.5);
        this.sysBufferR = new RingBuffer(48000 * 0.5);

        // Temp buffers for reading
        this.tempMic = new Float32Array(128);
        this.tempSysL = new Float32Array(128);
        this.tempSysR = new Float32Array(128);

        // Stats for debugging
        this.processCallCount = 0;
        this.micSamplesReceived = 0;
        this.sysSamplesReceived = 0;
        this.lastLogTime = 0;

        // Listen for audio samples from main thread
        this.port.onmessage = (event) => {
            const { type, samples, channelCount } = event.data;

            if (type === 'mic') {
                // Mic audio is mono
                this.micBuffer.write(samples);
                this.micSamplesReceived += samples.length;
            } else if (type === 'system') {
                // System audio is stereo interleaved (L, R, L, R, ...)
                if (channelCount === 2) {
                    const halfLength = Math.floor(samples.length / 2);
                    const leftSamples = new Float32Array(halfLength);
                    const rightSamples = new Float32Array(halfLength);

                    for (let i = 0; i < halfLength; i++) {
                        leftSamples[i] = samples[i * 2];
                        rightSamples[i] = samples[i * 2 + 1];
                    }

                    this.sysBufferL.write(leftSamples);
                    this.sysBufferR.write(rightSamples);
                    this.sysSamplesReceived += halfLength;
                } else {
                    // Mono system audio - duplicate to both channels
                    this.sysBufferL.write(samples);
                    this.sysBufferR.write(samples);
                    this.sysSamplesReceived += samples.length;
                }
            } else if (type === 'clear') {
                // Clear buffers (e.g., when stopping recording)
                this.micBuffer.clear();
                this.sysBufferL.clear();
                this.sysBufferR.clear();
            }
        };
    }

    process(inputs, outputs, parameters) {
        this.processCallCount++;

        const output = outputs[0];
        if (!output || output.length === 0) {
            return true;
        }

        const outputL = output[0];
        const outputR = output.length > 1 ? output[1] : output[0];
        const frameCount = outputL.length;

        // Resize temp buffers if needed
        if (this.tempMic.length < frameCount) {
            this.tempMic = new Float32Array(frameCount);
            this.tempSysL = new Float32Array(frameCount);
            this.tempSysR = new Float32Array(frameCount);
        }

        // Read from ring buffers
        this.micBuffer.read(this.tempMic, frameCount);
        this.sysBufferL.read(this.tempSysL, frameCount);
        this.sysBufferR.read(this.tempSysR, frameCount);

        // Mix: mic (mono) goes to both channels + system audio (stereo)
        for (let i = 0; i < frameCount; i++) {
            // Mix mic and system audio
            // Mic is typically quieter, so we can add them directly
            // Clamp to prevent clipping
            const mixedL = this.tempMic[i] + this.tempSysL[i];
            const mixedR = this.tempMic[i] + this.tempSysR[i];

            outputL[i] = Math.max(-1, Math.min(1, mixedL));
            outputR[i] = Math.max(-1, Math.min(1, mixedR));
        }

        // Log stats every ~5 seconds (at 48kHz with 128 sample frames = ~375 calls/sec)
        if (this.processCallCount % 1875 === 0) {
            this.port.postMessage({
                type: 'stats',
                processCallCount: this.processCallCount,
                micSamplesReceived: this.micSamplesReceived,
                sysSamplesReceived: this.sysSamplesReceived,
                micBufferAvailable: this.micBuffer.available(),
                sysBufferAvailable: this.sysBufferL.available()
            });
        }

        // Keep processor alive
        return true;
    }
}

registerProcessor('audio-mixer-processor', AudioMixerProcessor);
