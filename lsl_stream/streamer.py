from pylsl import resolve_streams, StreamInlet
import time

# Resolve all streams
streams = resolve_streams()
inlets = []

for s in streams:
    inlet = StreamInlet(s)
    inlets.append((s.name(), inlet))
    print(f"Connected to {s.name()}")

print("\n--- Streaming ---\n")

while True:
    for name, inlet in inlets:
        sample, timestamp = inlet.pull_sample(timeout=0.0)
        if sample is not None:
            print(f"{name:12s} | {sample[0]:>8.4f} | {timestamp:.3f}")
    time.sleep(0.01)
