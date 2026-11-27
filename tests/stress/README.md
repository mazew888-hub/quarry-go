# Stress tests

Longer checks, run on purpose rather than with every change:

    tests/stress/make_clips.sh                      # makes the clips (each frame shows its own number)
    node --test tests/stress/*.test.mjs             # frame rate + count for every format; random warps
    python3 -m pytest tests/stress -q -p no:cacheprovider   # every frame decoded in order; warp round trip vs Maya

The test browser can't play MPEG-4 Part 2, ProRes or Motion JPEG, so those decode on the iPhone only:
the "Quarry Go frame-rate check" pack is for opening there by hand.
