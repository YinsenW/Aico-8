-- Public synthetic fixture for the bounded custom SFX-instrument diagnostic
-- path. It contains no third-party cart data and requires explicit host opt-in.
function _init()
 -- referenced SFX 1: builtin waveform 5, speed 2, no loop/filter
 poke(0x3244,88,31,92,25)
 poke(0x3284,1,2,0,0)
 -- outer SFX 8: two consecutive same-key custom notes referencing SFX 1
 poke(0x3420,97,142,97,222)
 poke(0x3460,1,1,0,0)
 sfx(8,0)
end
function _update()
 if btnp(4) then run() end
end
